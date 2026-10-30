import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 按账号持久化里程碑展示方式；既有账号与新账号统一默认换行。 */
export class MilestoneMode1793404800000 implements MigrationInterface {
  name = 'MilestoneMode1793404800000';

  async up(runner: QueryRunner): Promise<void> {
    if (!await runner.hasColumn('v2_personal_preferences', 'milestone_mode')) {
      await runner.query("ALTER TABLE v2_personal_preferences ADD milestone_mode VARCHAR(16) NOT NULL DEFAULT 'wrap' COMMENT '里程碑展示模式：wrap换行时间轴，horizontal横向时间轴，账号所有入口共用' AFTER completed_mode");
    }
  }

  async down(): Promise<void> { throw new Error('账号展示偏好已持久化，请使用备份恢复。'); }
}
