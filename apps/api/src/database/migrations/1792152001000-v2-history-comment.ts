import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 基础迁移在开发库执行后补充历史未知语义，保持已执行迁移不变。 */
export class V2HistoryComment1792152001000 implements MigrationInterface {
  name = 'V2HistoryComment1792152001000';

  /** 旧安排缺乏创建时刻时只能标未知，不能误报为提前计划或迁移补录。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query("ALTER TABLE v2_arrangement_history MODIFY provenance VARCHAR(32) NOT NULL COMMENT 'scheduled真实安排、migration_supplement迁移补录或migration_unknown历史计划性未知'");
  }

  /** 注释随契约前向维护，不回退为遗漏未知状态的说明。 */
  async down(): Promise<void> { throw new Error('Use a reviewed forward migration'); }
}
