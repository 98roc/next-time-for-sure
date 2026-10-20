import type { MigrationInterface, QueryRunner } from 'typeorm';

/** V2 消息独立于已退役的旧通知表，不回填历史通知。 */
export class V2Notifications1792454400000 implements MigrationInterface {
  name = 'V2Notifications1792454400000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE v2_notifications (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '消息递增游标',
      operation_id CHAR(36) NOT NULL COMMENT '业务操作标识，用于合并同次操作',
      account_id CHAR(36) NOT NULL COMMENT '接收账号，不含实际操作者',
      items_json JSON NOT NULL COMMENT '按任务合并的项目消息内容，不保存凭据',
      created_at DATETIME(3) NOT NULL COMMENT '消息发生时间，UTC，保留七天',
      UNIQUE KEY uq_v2_message_operation(account_id,operation_id),
      KEY ix_v2_message_expiry(created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V2业务消息，无已读未读状态'`);
  }
  async down(): Promise<void> { throw new Error('Use a reviewed forward migration'); }
}
