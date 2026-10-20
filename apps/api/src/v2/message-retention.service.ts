import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

/** 即使无人查询也定期清理过期消息；查询端同时严格执行七天可见窗口。 */
@Injectable()
export class MessageRetentionService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  constructor(private readonly database: DatabaseService) {}
  onModuleInit(): void { this.schedule(); }
  private schedule(): void {
    this.timer = setTimeout(() => { void this.clean(); }, 60 * 60 * 1000);
    this.timer.unref();
  }
  private async clean(): Promise<void> {
    try {
      await this.database.transaction(async (manager) => { await manager.query('DELETE FROM v2_notifications WHERE created_at<=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 7 DAY)'); });
    } catch { console.warn('过期消息清理暂不可用，将在下次重试。'); }
    finally { if (!this.stopped) this.schedule(); }
  }
  onModuleDestroy(): void { this.stopped = true; clearTimeout(this.timer); }
}
