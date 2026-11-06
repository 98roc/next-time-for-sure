import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 页面排序改为账号独立；旧共享顺序只作为首次读取的初值，保留原表供核对。 */
export class ViewOrders1793923200000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE v2_view_orders (
      owner_id CHAR(36) NOT NULL COMMENT '排序所属账号，仅本人可修改',
      team_id CHAR(36) NOT NULL COMMENT '所属团队，超管跨团队排序相互隔离',
      scope_key VARCHAR(120) NOT NULL COMMENT '页面及项目或日期区间的排序作用域',
      ordered_ids JSON NOT NULL COMMENT '对象标识顺序，读取时按当前权限裁剪',
      version INT NOT NULL DEFAULT 0 COMMENT '排序并发版本，恢复默认仍递增',
      manual_order TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否采用手动顺序，零为动态默认排序',
      PRIMARY KEY (owner_id,team_id,scope_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='账号独立的项目与周计划页面排序'`);
  }

  /** 不删除用户已经保存的顺序，回退采用前向迁移。 */
  async down(): Promise<void> { throw new Error('Use a forward migration.'); }
}
