import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 窗口是团队展示配置，独立版本避免与日期目录和标语无关的并发冲突。 */
export class PeriodWindow1793318400000 implements MigrationInterface {
  name = 'PeriodWindow1793318400000';

  async up(runner: QueryRunner): Promise<void> {
    if (!await runner.hasColumn('v2_team_settings', 'period_window_before')) await runner.query("ALTER TABLE v2_team_settings ADD period_window_before SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '日期弹窗在当前区间之前展示的区间数，0至520，默认1'");
    if (!await runner.hasColumn('v2_team_settings', 'period_window_after')) await runner.query("ALTER TABLE v2_team_settings ADD period_window_after SMALLINT UNSIGNED NOT NULL DEFAULT 6 COMMENT '日期弹窗在当前区间之后展示的区间数，0至520，默认6'");
    if (!await runner.hasColumn('v2_team_settings', 'period_window_version')) await runner.query("ALTER TABLE v2_team_settings ADD period_window_version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '团队日期展示窗口的独立并发版本，每次保存递增'");
  }

  async down(): Promise<void> { throw new Error('团队窗口配置已保存，请使用前向迁移调整。'); }
}
