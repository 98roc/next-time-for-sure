import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 团队列内顺序独立于状态、进度和时间。 */
export class BoardOrder1791849610000 implements MigrationInterface {
  name = 'BoardOrder1791849610000';
  /** 既有任务以创建时间和标识打破初始相同顺序，首次移动后连续编号。 */
  async up(runner: QueryRunner): Promise<void> { await runner.query("ALTER TABLE team_tasks ADD COLUMN position INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '团队状态列内排序位置，不表达优先级或执行状态'"); }
  /** 持久化排序通过前向迁移维护。 */
  async down(): Promise<void> { throw new Error('Use a reviewed forward migration'); }
}
