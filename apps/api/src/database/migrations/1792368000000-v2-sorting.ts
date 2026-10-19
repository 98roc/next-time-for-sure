import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 已有共享顺序保留为手动；已有个人顺序同样保留；新分类使用统一默认规则。 */
export class V2Sorting1792368000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query("ALTER TABLE v2_shared_orders ADD COLUMN manual_order TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否手动排序，零为按业务默认规则动态排列'");
    await runner.query("ALTER TABLE v2_categories ADD COLUMN manual_order TINYINT(1) NOT NULL DEFAULT 0 COMMENT '本人分类是否手动排序，手动后新进入任务置顶'");
    await runner.query("INSERT INTO v2_shared_orders(team_id,scope_key,ordered_ids,version,manual_order) SELECT o.team_id,CONCAT('projects:',p.id),o.ordered_ids,o.version,o.manual_order FROM v2_shared_orders o JOIN v2_periods p ON p.team_id=o.team_id WHERE o.scope_key='projects'");
    await runner.query('UPDATE v2_categories SET manual_order=1 WHERE id IN (SELECT category_id FROM v2_placements)');
  }

  /** 保留已经保存的顺序；结构调整只通过前向迁移执行。 */
  async down(): Promise<void> { throw new Error('Use a forward migration.'); }
}
