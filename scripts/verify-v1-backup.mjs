import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { withMysqlSandbox, withClientConfig, run, manifest } from './migration/mysql-sandbox.mjs';
import { createDataSource } from '../apps/api/dist/database/data-source.js';
import { readSource } from '../apps/api/dist/database/v2-transition/source.js';
import { conversionSourceHash } from '../apps/api/dist/database/v2-transition/convert.js';
import { cutoverInputSchema } from '../apps/api/dist/database/v2-transition/cutover.js';

/** 恢复正式停写备份到独立实例，核对其业务来源与已批准转换材料；不连接生产。 */
async function main() {
  const { values } = parseArgs({ options: { backup: { type: 'string' }, input: { type: 'string' }, 'mysql-bin': { type: 'string' }, evidence: { type: 'string' } }, strict: true });
  for (const key of ['backup', 'input', 'mysql-bin', 'evidence']) if (!values[key]) throw new Error('MISSING_ARGUMENT');
  const input = cutoverInputSchema.parse(JSON.parse(await readFile(resolve(values.input), 'utf8')));
  const backup = resolve(values.backup), mysqlBin = resolve(values['mysql-bin']);
  const hash = createHash('sha256'); for await (const chunk of createReadStream(backup)) hash.update(chunk);
  let tables;
  await withMysqlSandbox(resolve('.'), mysqlBin, async ({ connection, options, directory }) => {
    const sql = join(directory, 'restore.sql');
    await pipeline(createReadStream(backup), createGunzip(), createWriteStream(sql, { flags: 'wx', mode: 0o600 }));
    await withClientConfig(directory, options, path => run(join(mysqlBin, 'mysql.exe'), [`--defaults-file=${path}`], { input: sql }));
    await connection.query('USE next_time_for_sure');
    const source = createDataSource({ DB_HOST: options.host, DB_PORT: options.port, DB_USERNAME: options.user, DB_PASSWORD: options.password, DB_DATABASE: 'next_time_for_sure', API_HOST: '127.0.0.1', API_PORT: 3100 });
    await source.initialize();
    try { assert.equal(conversionSourceHash(await readSource(source.manager), input.decisions), input.sourceHash); } finally { await source.destroy(); }
    tables = await manifest(connection);
    assert.equal(tables.length, 35);
    const [[baseline]] = await connection.query("SELECT metadata_value FROM platform_metadata WHERE metadata_key='schema_baseline'");
    assert.equal(baseline.metadata_value, 'foundation-v1');
  });
  await writeFile(resolve(values.evidence), JSON.stringify({ backupSha256: hash.digest('hex'), reviewedSourceMatches: true, restoredTables: tables }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('PASS: actual pre-deployment backup restored into isolated MySQL; 35 tables and reviewed business source verified. Sandbox cleaned.');
}
await main().catch(() => { console.error('BACKUP_RESTORE_VERIFICATION_FAILED'); process.exitCode = 1; });
