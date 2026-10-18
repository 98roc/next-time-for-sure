import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { z } from 'zod';
import { loadEnvironment } from '../config/environment.js';
import { createDataSource, requiredMigrationNames } from './data-source.js';
import type { Readiness } from '@ntfs/contracts';
import type { EntityManager } from 'typeorm';

/** 管理单一连接池；数据库不可用时进程仍能报告存活，但就绪返回503。 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly source = createDataSource(loadEnvironment());
  private initializing: Promise<void> | undefined;

  /** 合并并发初始化，失败后允许下一次就绪检查重试。 */
  private async connect(): Promise<void> {
    if (this.source.isInitialized) return;
    this.initializing ??= this.source.initialize().then(() => undefined).finally(() => { this.initializing = undefined; });
    await this.initializing;
  }

  /** 使用单事务连接完成身份校验与业务写入，异常时回滚。 */
  async transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    await this.connect();
    return this.source.transaction('READ COMMITTED', work);
  }

  /** 验证基线及待执行迁移，不在HTTP请求中自动迁移。 */
  async readiness(): Promise<Readiness> {
    try {
      await this.connect();
      const rows: unknown = await this.source.query("SELECT metadata_value FROM platform_metadata WHERE metadata_key = 'schema_baseline'");
      const metadata = z.array(z.object({ metadata_value: z.enum(['foundation-v1', 'v2']) })).parse(rows);
      const migrationRows: unknown = await this.source.query('SELECT name FROM schema_migrations ORDER BY id');
      const names = z.array(z.object({ name: z.string() })).parse(migrationRows).map((row) => row.name);
      const retired = metadata[0]?.metadata_value === 'v2';
      const expected = retired ? [...requiredMigrationNames, 'V2RetireLegacy1792281600000'] : requiredMigrationNames;
      const pending = z.array(z.object({ metadata_key: z.string() })).parse(await this.source.query("SELECT metadata_key FROM platform_metadata WHERE metadata_key='v2_retirement_ready'"));
      if (metadata.length !== 1 || names.join(',') !== expected.join(',') || (!retired && pending.length > 0)) throw new Error('Schema not current');
      return { status: 'ready', database: 'connected', migrations: 'current' };
    } catch {
      throw new ServiceUnavailableException('数据库尚未就绪，请检查连接配置并执行迁移。');
    }
  }

  /** 关闭时释放连接池，不留下调试连接。 */
  async onModuleDestroy(): Promise<void> {
    await this.initializing?.catch(() => undefined);
    if (this.source.isInitialized) await this.source.destroy();
  }
}
