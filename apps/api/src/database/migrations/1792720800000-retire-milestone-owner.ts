import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 停用里程碑人员归属，保留旧值供历史核对，新建目标不再写入该字段。 */
export class RetireMilestoneOwner1792720800000 implements MigrationInterface {
  name = 'RetireMilestoneOwner1792720800000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query("ALTER TABLE v2_milestones MODIFY COLUMN owner_id CHAR(36) NULL DEFAULT NULL COMMENT '已停用的历史责任归属，仅保留旧值，新建为空，不参与权限或成员移出检查'");
  }

  async down(): Promise<void> {
    throw new Error('新建里程碑已无责任归属，不能自动回填；回退请使用迁移前备份。');
  }
}
