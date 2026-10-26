import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 实际开始时间独立保存；旧任务与旧历史缺少可靠事实时保持为空。 */
export class TaskStartedAt1792987200000 implements MigrationInterface {
  name = 'TaskStartedAt1792987200000';

  async up(runner: QueryRunner): Promise<void> {
    if (!await runner.hasColumn('v2_tasks', 'started_at')) await runner.query("ALTER TABLE v2_tasks ADD started_at DATETIME(3) NULL COMMENT '本轮实际开始时间，UTC，可补录或清空，未知历史为空，不能晚于实际完成时间' AFTER completed_at");
  }

  async down(): Promise<void> { throw new Error('实际开始时间已保存业务事实，请使用备份恢复。'); }
}
