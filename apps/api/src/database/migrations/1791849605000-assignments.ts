import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 保存人员责任、本人执行事实及逐条进展，保留转交和退出的原分工。 */
export class Assignments1791849605000 implements MigrationInterface {
  name = 'Assignments1791849605000';

  /** 有效分工唯一约束允许退出或转交后建立新分工，不覆盖历史。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE task_assignments (
      id CHAR(36) NOT NULL PRIMARY KEY COMMENT '人员分工唯一标识',
      task_id CHAR(36) NOT NULL COMMENT '所属可执行团队任务标识',
      account_id CHAR(36) NOT NULL COMMENT '执行人账号标识',
      group_id CHAR(36) NOT NULL COMMENT '本条分工唯一负责小组标识',
      content TEXT NOT NULL COMMENT '分工内容，允许为空',
      source VARCHAR(16) NOT NULL COMMENT '分工来源编码：管理分配或自行认领',
      status VARCHAR(24) NOT NULL DEFAULT 'not_started' COMMENT '执行状态编码：待开始、进行中、完成、退出、转交',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '并发编辑版本号',
      started_at DATETIME(3) NULL COMMENT '本人实际开始时间（协调世界时）',
      ended_at DATETIME(3) NULL COMMENT '本人实际结束时间（协调世界时），转交不伪造此时间',
      transferred_at DATETIME(3) NULL COMMENT '分工转交时间（协调世界时）',
      created_at DATETIME(3) NOT NULL COMMENT '创建时间（协调世界时）',
      updated_at DATETIME(3) NOT NULL COMMENT '最后更新时间（协调世界时）',
      active_account CHAR(36) GENERATED ALWAYS AS (CASE WHEN status IN ('exited', 'transferred') THEN NULL ELSE account_id END) STORED COMMENT '有效执行人标识，退出或转交为空，用于防重复有效分工',
      UNIQUE KEY uq_assignment_active (task_id, active_account),
      CONSTRAINT fk_assignment_task FOREIGN KEY (task_id) REFERENCES team_tasks(id),
      CONSTRAINT fk_assignment_account FOREIGN KEY (account_id) REFERENCES accounts(id),
      CONSTRAINT fk_assignment_group FOREIGN KEY (group_id) REFERENCES work_groups(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='团队任务人员分工及本人执行状态'`);
    await runner.query(`CREATE TABLE assignment_progress (
      id CHAR(36) NOT NULL PRIMARY KEY COMMENT '进展记录唯一标识',
      assignment_id CHAR(36) NOT NULL COMMENT '来源人员分工标识，用于去重归集',
      occurred_on DATE NOT NULL COMMENT '实际发生日期，不随汇报周期修改',
      report_week DATE NOT NULL COMMENT '汇报归属周的周一日期',
      content TEXT NOT NULL COMMENT '本条实际进展内容',
      created_at DATETIME(3) NOT NULL COMMENT '记录创建时间（协调世界时）',
      CONSTRAINT fk_progress_assignment FOREIGN KEY (assignment_id) REFERENCES task_assignments(id),
      KEY idx_progress_week (report_week, assignment_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='人员分工逐条进展及汇报归属'`);
  }

  /** 执行历史不支持自动删除降级。 */
  async down(): Promise<void> { throw new Error('Use a reviewed forward migration'); }
}
