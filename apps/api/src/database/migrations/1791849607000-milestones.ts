import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 里程碑直接使用团队任务，日期为空表示未规划，不建立副本。 */
export class Milestones1791849607000 implements MigrationInterface {
  name = 'Milestones1791849607000';
  /** 规划字段与任务并发版本共用，所有变更记录进入团队历史。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE team_tasks
      ADD COLUMN in_milestone TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '是否列入项目里程碑，移出不删除任务',
      ADD COLUMN expected_on DATE NULL COMMENT '里程碑预计完成日期，空表示尚未规划日期',
      ADD INDEX idx_task_milestone (project_id, in_milestone, expected_on)`);
  }
  /** 回退只移除规划字段，不删除任何团队任务。 */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE team_tasks DROP INDEX idx_task_milestone, DROP COLUMN expected_on, DROP COLUMN in_milestone');
  }
}
