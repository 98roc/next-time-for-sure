import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 独立里程碑与任务单向关联；旧节点保留任务、分工和历史。 */
export class IndependentMilestones1791936000000 implements MigrationInterface {
  name = 'IndependentMilestones1791936000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE project_milestones (
      id CHAR(36) NOT NULL COMMENT '里程碑标识',
      project_id CHAR(36) NOT NULL COMMENT '所属项目标识',
      owner_id CHAR(36) NOT NULL COMMENT '里程碑负责人，负责确认目标达成',
      title VARCHAR(200) NOT NULL COMMENT '阶段目标名称',
      expected_on DATE NULL COMMENT '预计达成日期，空表示未规划日期',
      status VARCHAR(16) NOT NULL DEFAULT 'open' COMMENT '目标状态：open未完成、completed已确认完成、removed已移出',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '并发版本',
      created_at DATETIME(3) NOT NULL COMMENT '创建时间，协调世界时',
      updated_at DATETIME(3) NOT NULL COMMENT '最后更新时间，协调世界时',
      PRIMARY KEY(id), KEY idx_milestone_project(project_id),
      FOREIGN KEY(project_id) REFERENCES projects(id), FOREIGN KEY(owner_id) REFERENCES accounts(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='独立项目里程碑，不自动产生团队任务'`);
    await runner.query(`ALTER TABLE team_tasks ADD COLUMN milestone_id CHAR(36) NULL COMMENT '关联里程碑，一条任务最多关联一个，同项目', ADD KEY idx_task_milestone_id(milestone_id), ADD CONSTRAINT fk_task_milestone FOREIGN KEY(milestone_id) REFERENCES project_milestones(id)`);

    // 使用旧任务标识迁移节点，原任务保持不变；旧完成状态保留为历史基线。
    await runner.query(`INSERT INTO project_milestones (id,project_id,owner_id,title,expected_on,status,created_at,updated_at)
      SELECT id,project_id,owner_id,title,expected_on,IF(status='completed','completed','open'),created_at,updated_at FROM team_tasks WHERE in_milestone=1`);
    await runner.query('UPDATE team_tasks SET milestone_id=id WHERE in_milestone=1');
    await runner.query(`CREATE TABLE weekly_carry_exclusions (
      draft_id CHAR(36) NOT NULL COMMENT '主动移出工作所在周草稿',
      object_id CHAR(36) NOT NULL COMMENT '分工或待分配任务标识',
      object_kind VARCHAR(16) NOT NULL COMMENT '对象类型：assignment分工或task待分配任务',
      PRIMARY KEY(draft_id,object_id,object_kind), FOREIGN KEY(draft_id) REFERENCES weekly_drafts(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='阻止主动移出工作被自动重新结转，重新安排后恢复延续'`);
    await runner.query("ALTER TABLE weekly_pending ADD COLUMN source_week DATE NULL COMMENT '自动延续来源周，手动加入为空'");
  }
  async down(): Promise<void> { throw new Error('Use a reviewed forward migration'); }
}
