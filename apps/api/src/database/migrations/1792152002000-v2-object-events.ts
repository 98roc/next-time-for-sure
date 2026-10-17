import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 非任务业务历史独立记录，确保里程碑完成、重开与日期调整可追溯。 */
export class V2ObjectEvents1792152002000 implements MigrationInterface {
  name = 'V2ObjectEvents1792152002000';
  /** 只承载团队可见对象，私人任务历史仍在任务事件内按所有者裁剪。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE v2_object_events (
      id CHAR(36) NOT NULL PRIMARY KEY COMMENT '团队对象历史事件标识',
      team_id CHAR(36) NOT NULL COMMENT '所属团队标识，查询须重新鉴权',
      project_id CHAR(36) NULL COMMENT '项目范围，空表示团队日期或配置',
      object_id CHAR(36) NOT NULL COMMENT '目标对象标识',
      actor_id CHAR(36) NOT NULL COMMENT '实际操作者账号',
      action VARCHAR(64) NOT NULL COMMENT '业务操作类型',
      payload_json JSON NOT NULL COMMENT '变更前后及来源快照，不包含私人任务或凭据',
      occurred_at DATETIME(3) NOT NULL COMMENT '发生时间，协调世界时',
      KEY idx_v2_object_history(object_id,occurred_at),
      FOREIGN KEY(team_id) REFERENCES teams(id), FOREIGN KEY(actor_id) REFERENCES accounts(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='新版团队对象不可变变更历史'`);
  }
  /** 历史保留，禁止通过自动降级清空。 */
  async down(): Promise<void> { throw new Error('Use a reviewed forward migration'); }
}
