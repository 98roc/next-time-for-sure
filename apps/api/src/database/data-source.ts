import 'reflect-metadata';
import { DataSource } from 'typeorm';
import type { Environment } from '../config/environment.js';
import { Foundation1791849600000 } from './migrations/1791849600000-foundation.js';

/** 已知迁移顺序，用于只读就绪检查，避免检查过程创建迁移表。 */
export const requiredMigrationNames = ['Foundation1791849600000'];

/** API与迁移工具使用同一配置；关闭结构同步、自动迁移及SQL日志。 */
export function createDataSource(environment: Environment): DataSource {
  return new DataSource({
    type: 'mysql',
    host: environment.DB_HOST,
    port: environment.DB_PORT,
    username: environment.DB_USERNAME,
    password: environment.DB_PASSWORD,
    database: environment.DB_DATABASE,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
    synchronize: false,
    migrationsRun: false,
    migrationsTransactionMode: 'none',
    migrationsTableName: 'schema_migrations',
    migrations: [Foundation1791849600000],
    entities: [],
    logging: false,
    extra: { connectionLimit: 5, connectTimeout: 5000 },
  });
}
