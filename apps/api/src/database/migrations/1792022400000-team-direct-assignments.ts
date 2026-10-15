import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 分工允许团队直属；保留现有小组归属和外键，NULL 明确由团队负责人统筹。 */
export class TeamDirectAssignments1792022400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE task_assignments MODIFY group_id CHAR(36) NULL COMMENT '负责小组标识；空表示由团队负责人统筹的团队直属分工'");
  }

  /** 存在直属分工时拒绝回退，避免丢失责任归属或隐式加入小组。 */
  async down(queryRunner: QueryRunner): Promise<void> {
    const rows: unknown = await queryRunner.query('SELECT id FROM task_assignments WHERE group_id IS NULL LIMIT 1');
    if (!Array.isArray(rows) || rows.length > 0) throw new Error('存在团队直属分工，不能回退为必填小组。');
    await queryRunner.query("ALTER TABLE task_assignments MODIFY group_id CHAR(36) NOT NULL COMMENT '本条分工唯一负责小组标识'");
  }
}
