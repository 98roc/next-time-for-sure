import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 仅增加可空结果字段，不补造历史完成任务的人工投入或AI贡献。 */
export class TaskEffort1792627200000 implements MigrationInterface {
  name = 'TaskEffort1792627200000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query("ALTER TABLE v2_tasks ADD COLUMN actual_days DECIMAL(6,2) NULL COMMENT '整条项目任务累计实际人工投入人天，八小时为一天，可为零，空表示未填写' AFTER completed_at, ADD COLUMN ai_contribution VARCHAR(10) NULL COMMENT '项目任务AI贡献档位：none为0，low大于0小于30，medium为30至60，high大于60至100百分比；空为未填写' AFTER actual_days");
  }
  async down(runner: QueryRunner): Promise<void> { await runner.query('ALTER TABLE v2_tasks DROP COLUMN ai_contribution, DROP COLUMN actual_days'); }
}
