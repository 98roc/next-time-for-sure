import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomBytes, createHash } from 'node:crypto';
import { withMysqlSandbox, withClientConfig, run, manifest } from './migration/mysql-sandbox.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireApi = createRequire(join(root, 'apps/api/package.json'));
const { z } = requireApi('zod');

/** 只读备份指定来源；所有恢复、迁移和删除只发生在本次独立 mysqld 实例。 */
async function main() {
  const { values } = parseArgs({ options: { config: { type: 'string', default: '.env.local' }, 'mysql-bin': { type: 'string' }, decisions: { type: 'string' } }, strict: true });
  if (!values['mysql-bin']) throw new Error('MYSQL_BIN_REQUIRED');
  const config = z.object({ DB_HOST: z.string().min(1), DB_PORT: z.coerce.number().int().positive().default(3306), DB_USERNAME: z.string().min(1), DB_PASSWORD: z.string().min(1), DB_DATABASE: z.literal('next_time_for_sure') }).parse(requireApi('dotenv').parse(await readFile(resolve(root, values.config))));
  const mysqlBin = resolve(values['mysql-bin']);
  const output = join(root, '.cache', 'v2-rehearsal', `${new Date().toISOString().replaceAll(':', '-')}-${randomBytes(3).toString('hex')}`);
  await mkdir(output, { recursive: true });
  const backup = join(output, 'source.sql');

  // mysqldump 的事务快照不写来源库，也不锁业务表；凭据文件在进程结束后立即删除。
  await withClientConfig(output, { host: config.DB_HOST, port: config.DB_PORT, user: config.DB_USERNAME, password: config.DB_PASSWORD }, async (path) => {
    await run(join(mysqlBin, 'mysqldump.exe'), [`--defaults-file=${path}`, '--single-transaction', '--skip-lock-tables', '--set-gtid-purged=OFF', '--hex-blob', '--routines', '--events', '--triggers', '--databases', config.DB_DATABASE], { output: backup });
  });
  console.log('Read-only source backup created in ignored cache; credentials were not logged.');
  const { createDataSource, requiredMigrationNames } = await import('../apps/api/dist/database/data-source.js');
  let result;
  await withMysqlSandbox(root, mysqlBin, async ({ connection, options, directory }) => {
    const environment = { DB_HOST: options.host, DB_PORT: options.port, DB_USERNAME: options.user, DB_PASSWORD: options.password, DB_DATABASE: 'next_time_for_sure', API_HOST: '127.0.0.1', API_PORT: 3100 };
    const migrate = async () => {
      const source = createDataSource(environment); await source.initialize();
      try { return (await source.runMigrations()).map((row) => row.name); } finally { await source.destroy(); }
    };
    const restore = async () => {
      // 连接由 withMysqlSandbox 创建并核对端口与数据目录，不使用来源环境执行此 DDL。
      await connection.query('DROP DATABASE IF EXISTS next_time_for_sure');
      await withClientConfig(directory, options, (path) => run(join(mysqlBin, 'mysql.exe'), [`--defaults-file=${path}`], { input: backup }));
      await connection.query('USE next_time_for_sure');
    };
    await connection.query('CREATE DATABASE next_time_for_sure CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    assert.deepEqual(await migrate(), requiredMigrationNames);
    assert.deepEqual(await migrate(), []);
    console.log(`Empty-database replay passed: ${requiredMigrationNames.length} migrations; repeat applied zero.`);
    await restore();
    const before = await manifest(connection);
    const applied = await migrate();
    assert.deepEqual(await migrate(), []);
    let conversion;
    let retired;
    if (values.decisions) {
      const decisions = JSON.parse(await readFile(resolve(root, values.decisions), 'utf8'));
      const { convertLegacy } = await import('../apps/api/dist/database/v2-transition/convert.js');
      const source = createDataSource(environment); await source.initialize();
      try {
        const untouched = await manifest(connection);
        if (decisions.supplements.length) {
          await assert.rejects(() => convertLegacy(source, { ...decisions, supplements: [] }), /REVIEW_MISSING_PERIOD/);
          assert.deepEqual(await manifest(connection), untouched);
        }
        // 模拟后段落库失败，确认已写的任务、事件和安排与迁移标记一起回滚。
        await connection.query("CREATE TRIGGER v2_rehearsal_fail BEFORE INSERT ON v2_placements FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='REHEARSAL_FAIL'");
        try { await assert.rejects(() => convertLegacy(source, decisions)); } finally { await connection.query('DROP TRIGGER v2_rehearsal_fail'); }
        assert.deepEqual(await manifest(connection), untouched);
        conversion = await convertLegacy(source, decisions);
        assert.equal(conversion.repeated, false);
        const converted = await manifest(connection);
        assert.equal((await convertLegacy(source, decisions)).repeated, true);
        assert.deepEqual(await manifest(connection), converted);
        for (const [table, expected] of [['team_tasks', 'SOURCE_CHANGED_AFTER_CONVERSION'], ['v2_tasks', 'TARGET_CHANGED_AFTER_CONVERSION']]) {
          const [[row]] = await connection.query(`SELECT id,title FROM ${table} ORDER BY id LIMIT 1`);
          if (!row) continue;
          await connection.query(`UPDATE ${table} SET title='rehearsal-tamper' WHERE id=?`, [row.id]);
          try { await assert.rejects(() => convertLegacy(source, decisions), new RegExp(expected)); } finally { await connection.query(`UPDATE ${table} SET title=? WHERE id=?`, [row.title, row.id]); }
        }
        assert.deepEqual(await manifest(connection), converted);
        const { verifyConverted } = await import('../apps/api/dist/database/v2-transition/verify.js');
        await verifyConverted(source);
        console.log('Converted HTTP API readback, missing-approval rejection and transaction rollback passed.');
        const { readSource } = await import('../apps/api/dist/database/v2-transition/source.js');
        const legacy = await readSource(source.manager);
        const { prepareRetirement } = await import('../apps/api/dist/database/v2-transition/retire.js');
        await prepareRetirement(source, decisions, createHash('sha256').update(await readFile(backup)).digest('hex'));
        const cutover = createDataSource(environment, true); await cutover.initialize();
        try { retired = (await cutover.runMigrations()).map((row) => row.name); assert.deepEqual(retired, ['V2RetireLegacy1792281600000']); assert.deepEqual(await cutover.runMigrations(), []); } finally { await cutover.destroy(); }
        await verifyConverted(source, legacy);
        const { OrganizationRepository } = await import('../apps/api/dist/organization/organization.repository.js');
        assert.equal(await new OrganizationRepository(source.manager).accountInUse('00000000-0000-4000-a000-000000000000'), false);
        const [oldTables] = await connection.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('team_tasks','task_assignments','personal_items','work_requests','notifications','work_groups','weekly_publications')");
        assert.equal(oldTables.length, 0);
        console.log('Legacy-table retirement, repeat execution and post-retirement HTTP readiness/workspace readback passed.');
        console.log('Business conversion and idempotent replay passed:', JSON.stringify({ counts: conversion.counts, warnings: conversion.warnings }));
      } finally { await source.destroy(); }
    }
    const [missing] = await connection.query("SELECT TABLE_NAME object_name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_COMMENT NOT REGEXP '[一-龥]' UNION ALL SELECT CONCAT(TABLE_NAME,'.',COLUMN_NAME) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_COMMENT NOT REGEXP '[一-龥]'");
    assert.equal(missing.length, 0);
    const migrated = await manifest(connection);
    await restore();
    assert.deepEqual(await manifest(connection), before);
    result = { sourceReadOnly: true, emptyReplay: requiredMigrationNames.length, applied, conversion, retired, repeatApplied: 0, restoredExactly: true, baseline: before, migrated, backupSha256: createHash('sha256').update(await readFile(backup)).digest('hex') };
    console.log(`Backup restoration passed: ${before.length} tables match all row and schema hashes; schema upgrade applied ${applied.length}.`);
  });
  await writeFile(join(output, 'evidence.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(`Sandbox process and data directory cleaned. Business conversion ${values.decisions ? 'included' : 'not included'}.`);
}

await main().catch((error) => {
  const known = typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : typeof error.message === 'string' && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'REHEARSAL_FAILED';
  console.error(`V2 rehearsal failed: ${known}. Source remains unchanged; inspect ignored local evidence.`); process.exitCode = 1;
});
