import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 原分工原地迁移，保留首次拆分来源，不复制进展或投入。 */
export class SplitOrigin1791849609000 implements MigrationInterface {
  name = 'SplitOrigin1791849609000';
  /** 未拆分分工保持空来源，已有执行事实无需回填改写。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE task_assignments ADD COLUMN origin_task_id CHAR(36) NULL COMMENT '首次拆分前所属团队任务，空表示未发生拆分迁移', ADD CONSTRAINT fk_assignment_origin FOREIGN KEY (origin_task_id) REFERENCES team_tasks(id)`);
  }
  /** 历史来源只允许经过审查的前向调整。 */
  async down(): Promise<void> { throw new Error('Use a reviewed forward migration'); }
}
