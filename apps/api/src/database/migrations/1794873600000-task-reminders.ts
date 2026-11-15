import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 每个任务只有一条定时提醒配置，索引按下一次发送时间扫描。 */
export class TaskReminders1794873600000 implements MigrationInterface {
  name = 'TaskReminders1794873600000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE IF NOT EXISTS v2_task_reminders (
      task_id CHAR(36) NOT NULL PRIMARY KEY COMMENT '对应的任务，最多一条提醒配置',
      plan_json JSON NOT NULL COMMENT '北京时间的提醒模式、日期、钟点以及每日模式的提前天数',
      next_at DATETIME(3) NULL COMMENT '下一次待处理时刻，UTC，NULL表示计划已结束',
      KEY ix_v2_task_reminder_due(next_at,task_id),
      FOREIGN KEY(task_id) REFERENCES v2_tasks(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目及私人任务定时提醒配置'`);
  }

  async down(): Promise<void> { throw new Error('提醒配置已持久化，请使用备份恢复。'); }
}
