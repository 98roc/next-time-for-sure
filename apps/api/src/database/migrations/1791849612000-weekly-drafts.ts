import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 一个团队每周只保留一份共享草稿，分工安排不复制个人执行记录。 */
export class WeeklyDrafts1791849612000 implements MigrationInterface {
  name = 'WeeklyDrafts1791849612000';
  /** 所有业务字段均明确中文含义，投入用精确小数保存。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE weekly_drafts (
      id CHAR(36) NOT NULL COMMENT '共享周计划草稿标识',
      team_id CHAR(36) NOT NULL COMMENT '所属团队标识',
      week DATE NOT NULL COMMENT '归属周的周一日期',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '草稿变更版本，用于发布确认',
      PRIMARY KEY(id), UNIQUE KEY uq_weekly_team(team_id, week),
      FOREIGN KEY(team_id) REFERENCES teams(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='团队每周唯一的共享计划草稿'`);
    await runner.query(`CREATE TABLE weekly_arrangements (
      id CHAR(36) NOT NULL COMMENT '人员周安排标识',
      draft_id CHAR(36) NOT NULL COMMENT '所属共享周计划草稿',
      assignment_id CHAR(36) NOT NULL COMMENT '人员分工标识，跟随原分工拆分迁移',
      goal VARCHAR(2000) NOT NULL DEFAULT '' COMMENT '本周工作目标，允许空',
      expected_progress TINYINT UNSIGNED NULL COMMENT '本周预计新增进度百分比，允许空，不是累计进度',
      planned_days DECIMAL(6,2) NULL COMMENT '本周预计投入天数，允许空，不代表实际工时',
      source_week DATE NULL COMMENT '自动结转来源周，手动安排为空',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '安排并发版本',
      PRIMARY KEY(id), UNIQUE KEY uq_weekly_assignment(draft_id, assignment_id),
      FOREIGN KEY(draft_id) REFERENCES weekly_drafts(id),
      FOREIGN KEY(assignment_id) REFERENCES task_assignments(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='每人每周具体分工的目标及预计投入'`);
  }
  /** 业务数据通过审核后的前向迁移处理。 */
  async down(): Promise<void> { throw new Error('Use a reviewed forward migration'); }
}
