import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 团队与人员分工分别保存阻塞，不从状态或依赖完成推导。 */
export class Blockers1791849611000 implements MigrationInterface {
  name = 'Blockers1791849611000';
  /** 等待对象可仅填写文字，关联任务可选；通知由后续通知阶段接入。 */
  async up(runner: QueryRunner): Promise<void> {
    for (const table of ['team_tasks', 'task_assignments']) {
      await runner.query(`ALTER TABLE ${table}
        ADD COLUMN blocked_reason VARCHAR(2000) NOT NULL DEFAULT '' COMMENT '阻塞原因，空表示未阻塞或已人工解除',
        ADD COLUMN waiting_for VARCHAR(200) NOT NULL DEFAULT '' COMMENT '等待对象说明，可空，不自动限制开工',
        ADD COLUMN waiting_task_id CHAR(36) NULL COMMENT '等待的同项目团队任务，完成不会自动解除阻塞',
        ADD CONSTRAINT fk_${table}_waiting FOREIGN KEY (waiting_task_id) REFERENCES team_tasks(id)`);
    }
  }
  /** 历史字段通过前向迁移调整。 */
  async down(): Promise<void> { throw new Error('Use a reviewed forward migration'); }
}
