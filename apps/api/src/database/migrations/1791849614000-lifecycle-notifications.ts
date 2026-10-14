import type { MigrationInterface, QueryRunner } from 'typeorm';
/** 生命周期与通知采用追加迁移，历史业务数据不重写。 */
export class LifecycleNotifications1791849614000 implements MigrationInterface {
  name = 'LifecycleNotifications1791849614000';
  /** 归档保留原项目，事件与收件记录分开保证失败可重试。 */
  async up(runner: QueryRunner) {
    await runner.query("ALTER TABLE projects ADD archived TINYINT NOT NULL DEFAULT 0 COMMENT '项目是否归档，归档后禁止新增执行工作'");
    await runner.query(`CREATE TABLE lifecycle_events (
      id CHAR(36) PRIMARY KEY COMMENT '生命周期历史标识', team_id CHAR(36) NOT NULL COMMENT '变更所属原团队',
      actor_id CHAR(36) NOT NULL COMMENT '操作账号', object_id CHAR(36) NOT NULL COMMENT '对象标识，删除后保留引用',
      action VARCHAR(40) NOT NULL COMMENT '删除转移归档或移出操作', payload_json JSON NOT NULL COMMENT '原因及操作前后影响范围快照',
      created_at DATETIME(3) NOT NULL COMMENT '发生时间，协调世界时', FOREIGN KEY(team_id) REFERENCES teams(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生命周期及人员交接历史，不提供恢复删除'`);
    await runner.query(`CREATE TABLE notification_outbox (
      id CHAR(36) PRIMARY KEY COMMENT '业务通知事件标识，同一事件重复投递复用', team_id CHAR(36) NOT NULL COMMENT '事件所属团队',
      project_id CHAR(36) NULL COMMENT '关联项目，可空表示团队事件', payload_json JSON NOT NULL COMMENT '收件人及最小业务提示，不含私人事项',
      delivered TINYINT NOT NULL DEFAULT 0 COMMENT '是否完成站内投递，失败时保留待重试', attempts INT NOT NULL DEFAULT 0 COMMENT '投递尝试次数',
      created_at DATETIME(3) NOT NULL COMMENT '事件发生时间，协调世界时', FOREIGN KEY(team_id) REFERENCES teams(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='与业务同事务写入的可靠通知事件箱'`);
    await runner.query(`CREATE TABLE notifications (
      id CHAR(36) PRIMARY KEY COMMENT '用户通知标识', event_id CHAR(36) NOT NULL COMMENT '来源业务事件', account_id CHAR(36) NOT NULL COMMENT '接收账号',
      read_at DATETIME(3) NULL COMMENT '用户主动阅读时间，系统展示不写入', created_at DATETIME(3) NOT NULL COMMENT '投递时间，协调世界时',
      UNIQUE KEY uq_notification_recipient(event_id,account_id), FOREIGN KEY(event_id) REFERENCES notification_outbox(id), FOREIGN KEY(account_id) REFERENCES accounts(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='多端共用站内通知和已读状态，同事件同用户唯一'`);
  }
  /** 历史通知和归档记录不能自动破坏性回退。 */
  async down(): Promise<void> { throw new Error('Use a reviewed forward migration'); }
}
