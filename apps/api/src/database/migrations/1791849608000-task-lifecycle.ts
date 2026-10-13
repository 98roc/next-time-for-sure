import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 团队整体时间不复用成员执行时间，进度由主负责人明确维护。 */
export class TaskLifecycle1791849608000 implements MigrationInterface {
  name = 'TaskLifecycle1791849608000';
  /** 已有任务不补造历史开始结束时间。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE team_tasks
      ADD COLUMN started_at DATETIME(3) NULL COMMENT '团队任务首次实际开始时间，不从关联对象传播',
      ADD COLUMN ended_at DATETIME(3) NULL COMMENT '本任务整体完成时间，重开后清空，历史另存',
      ADD COLUMN progress TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '主负责人维护的累计进度百分比，不自动改变完成状态'`);
  }
  /** 保留历史事实，结构调整使用前向迁移。 */
  async down(): Promise<void> { throw new Error('Use a reviewed forward migration'); }
}
