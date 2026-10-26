import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../database/database.service.js';
import { OrganizationRepository } from '../organization/organization.repository.js';
import { rolloverTeam } from './task-rollover.js';

/** 启动及每分钟补齐当前排期；关闭时停止调度，多实例共用组织锁防止重复追加。 */
@Injectable()
export class TaskRolloverService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  constructor(private readonly database: DatabaseService) {}
  onModuleInit(): void { if (!this.stopped) this.schedule(0); }
  private schedule(delay = 60_000): void { this.timer = setTimeout(() => { void this.run(); }, delay); this.timer.unref(); }
  private async run(): Promise<void> {
    try {
      await this.database.transaction(async (manager) => {
        await new OrganizationRepository(manager).lock();
        const teams = z.array(z.object({ id: z.string() })).parse(await manager.query('SELECT id FROM teams'));
        for (const team of teams) await rolloverTeam(manager, team.id);
      });
    } catch { console.warn('任务自动顺延暂不可用，将在下次重试。'); }
    finally { if (!this.stopped) this.schedule(); }
  }
  onModuleDestroy(): void { this.stopped = true; clearTimeout(this.timer); }
}
