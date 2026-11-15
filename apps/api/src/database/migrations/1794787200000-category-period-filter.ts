import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 为个人分类保存周期筛选开关，已有分类和新分类默认关闭。 */
export class CategoryPeriodFilter1794787200000 implements MigrationInterface {
  name = 'CategoryPeriodFilter1794787200000';

  async up(runner: QueryRunner): Promise<void> {
    if (!await runner.hasColumn('v2_categories', 'period_filter_enabled')) {
      await runner.query("ALTER TABLE v2_categories ADD period_filter_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '未开始分类是否启用周期筛选，0关闭，1启用'");
    }
  }

  async down(): Promise<void> { throw new Error('分类筛选偏好已持久化，请使用备份恢复。'); }
}
