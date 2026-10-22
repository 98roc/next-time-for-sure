import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 私人清单和日报独立于正式任务聚合，历史快照不随任务改派或逻辑删除清理。 */
export class PersonalSubtasksDaily1792627201000 implements MigrationInterface {
  name = 'PersonalSubtasksDaily1792627201000';
  async up(runner: QueryRunner): Promise<void> {
    const suffix = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    await runner.query(`CREATE TABLE IF NOT EXISTS v2_personal_preferences (
      owner_id CHAR(36) NOT NULL PRIMARY KEY COMMENT '唯一所属账号，仅本人读取和维护',
      completed_mode VARCHAR(16) NOT NULL DEFAULT 'day' COMMENT '完成列查看模式，day按日期，period按团队日期区间',
      project_order_json JSON NULL COMMENT '本人日报项目标识顺序，空表示跟随项目页共享顺序',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '个人偏好并发版本',
      FOREIGN KEY(owner_id) REFERENCES accounts(id)
    ) ${suffix} COMMENT='跨设备共用的本人查看偏好与日报项目顺序'`);
    await runner.query(`CREATE TABLE IF NOT EXISTS v2_personal_subtasks (
      owner_id CHAR(36) NOT NULL COMMENT '私人子任务所有者，不随主任务改派转移',
      task_id CHAR(36) NOT NULL COMMENT '所属主任务标识，不改变主任务状态及投入',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '本人该任务清单的并发版本',
      items_json JSON NOT NULL COMMENT '有序一层子任务，包含标识名称完成状态及本次完成时间，最多二百条',
      updated_at DATETIME(3) NOT NULL COMMENT '最近清单保存时间，协调世界时',
      PRIMARY KEY(owner_id,task_id), FOREIGN KEY(owner_id) REFERENCES accounts(id), FOREIGN KEY(task_id) REFERENCES v2_tasks(id)
    ) ${suffix} COMMENT='仅当前执行人可管理的个人子任务清单聚合'`);
    await runner.query(`CREATE TABLE IF NOT EXISTS v2_personal_subtask_events (
      owner_id CHAR(36) NOT NULL COMMENT '不可变私人历史所属账号',
      task_id CHAR(36) NOT NULL COMMENT '所属主任务标识',
      sequence INT UNSIGNED NOT NULL COMMENT '清单版本，同一毫秒按版本排序',
      snapshot_json JSON NOT NULL COMMENT '保存时的主任务名称项目名称及完整有序子任务快照',
      occurred_at DATETIME(3) NOT NULL COMMENT '实际保存时间，协调世界时，用于历史日末回看',
      PRIMARY KEY(owner_id,task_id,sequence), KEY idx_personal_subtask_time(owner_id,occurred_at),
      FOREIGN KEY(owner_id) REFERENCES accounts(id), FOREIGN KEY(task_id) REFERENCES v2_tasks(id)
    ) ${suffix} COMMENT='私人子任务不可变历史，后续改名删除和重开不回写过去日期'`);
    await runner.query(`CREATE TABLE IF NOT EXISTS v2_daily_reports (
      owner_id CHAR(36) NOT NULL COMMENT '私人日报唯一所有者',
      report_on DATE NOT NULL COMMENT '日报所属上海自然日',
      body MEDIUMTEXT NOT NULL COMMENT '本人保存或确认的日报文字',
      manual TINYINT UNSIGNED NOT NULL COMMENT '是否为手工文字，自动稿按事实重新生成',
      source_hash CHAR(64) NOT NULL COMMENT '编辑开始或预览确认时的来源摘要',
      version INT UNSIGNED NOT NULL COMMENT '同一账号同一天文字稿并发版本',
      PRIMARY KEY(owner_id,report_on), FOREIGN KEY(owner_id) REFERENCES accounts(id)
    ) ${suffix} COMMENT='本人按日期保存的日报文字与手工修改保护'`);
  }
  async down(): Promise<void> { throw new Error('私人执行历史和日报不能自动回滚删除，请使用经核验的备份恢复。'); }
}
