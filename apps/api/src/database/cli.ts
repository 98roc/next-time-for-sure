import { createConnection } from 'mysql2/promise';
import { z } from 'zod';
import { loadEnvironment } from '../config/environment.js';
import { createDataSource, requiredMigrationNames } from './data-source.js';

/** 显式执行独立库迁移；迁移前核对目标与版本，并串行化并发执行。 */
async function main(): Promise<void> {
  const action = z.enum(['migrate', 'status']).parse(process.argv[2]);
  const environment = loadEnvironment();
  const connection = await createConnection({
    host: environment.DB_HOST, port: environment.DB_PORT,
    user: environment.DB_USERNAME, password: environment.DB_PASSWORD,
    connectTimeout: 5000,
  });

  try {
    // 独立连接持有命名锁直到整个迁移流程结束，避免多进程重复执行DDL。
    const [versions] = await connection.query('SELECT VERSION() AS version');
    const version = z.array(z.object({ version: z.string() })).parse(versions)[0]?.version;
    if (!version?.startsWith('5.7.')) throw new Error('This baseline requires MySQL 5.7 verification');
    console.log(`Target: ${environment.DB_HOST}:${environment.DB_PORT}/${environment.DB_DATABASE}; MySQL ${version}`);
    if (action === 'migrate') {
      const [locks] = await connection.query("SELECT GET_LOCK('next_time_for_sure:migration', 10) AS acquired");
      if (z.array(z.object({ acquired: z.number() })).parse(locks)[0]?.acquired !== 1) throw new Error('Migration lock unavailable');
      await connection.query('CREATE DATABASE IF NOT EXISTS `next_time_for_sure` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    }

    const source = createDataSource(environment);
    try {
      await source.initialize();
      if (action === 'migrate') {
        const applied = await source.runMigrations();
        console.log(`Applied migrations: ${applied.length}`);
      }
      const rows: unknown = await source.query('SELECT name FROM schema_migrations ORDER BY id');
      const appliedNames = z.array(z.object({ name: z.string() })).parse(rows).map((row) => row.name);
      console.log(`Pending migrations: ${requiredMigrationNames.some((name) => !appliedNames.includes(name))}`);

      // 从实际数据库核验注释，覆盖框架迁移表及未来新增表、字段。
      const comments: unknown = await source.query(`
        SELECT TABLE_NAME AS object_name, TABLE_COMMENT AS comment_text
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
        UNION ALL
        SELECT CONCAT(TABLE_NAME, '.', COLUMN_NAME), COLUMN_COMMENT
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`);
      const entries = z.array(z.object({ object_name: z.string(), comment_text: z.string() })).parse(comments);
      const missing = entries.filter((entry) => !/[\u4e00-\u9fff]/u.test(entry.comment_text));
      console.log(`Chinese schema comments: ${entries.length - missing.length}/${entries.length}`);
      if (missing.length > 0) {
        console.error(`Missing Chinese comments: ${missing.map((entry) => entry.object_name).join(', ')}`);
        throw new Error('Schema comments incomplete');
      }
    } finally {
      if (source.isInitialized) await source.destroy();
    }
  } finally {
    // 关闭连接自动释放命名锁，包括失败路径。
    await connection.end();
  }
}

void main().catch((error: unknown) => {
  const details = z.object({ code: z.string().regex(/^[A-Z0-9_]+$/) }).safeParse(error);
  const code = details.success ? details.data.code : 'CONFIGURATION_OR_MIGRATION_ERROR';
  console.error(`Database operation failed (${code}). Check local configuration, server version, privileges and migration history; credentials are not logged.`);
  process.exitCode = 1;
});
