import type { MigrationInterface, QueryRunner } from 'typeorm';
/** 发布快照与可编辑草稿独立存储，删除源记录也不损失历史文字。 */
export class WeeklyPublications1791849613000 implements MigrationInterface {
  name = 'WeeklyPublications1791849613000';
  /** 建立发布、待分配规划、周报来源映射、人工标签和变更历史。 */
  async up(runner: QueryRunner): Promise<void> {
    const suffix = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    await runner.query(`CREATE TABLE weekly_publications (
      id CHAR(36) PRIMARY KEY COMMENT '发布版本标识', team_id CHAR(36) NOT NULL COMMENT '发布所属团队',
      week DATE NOT NULL COMMENT '归属周周一', kind VARCHAR(16) NOT NULL COMMENT '发布种类：计划或周报',
      revision INT NOT NULL COMMENT '同周同种类的递增修订号', payload_json JSON NOT NULL COMMENT '发布时完整内容快照，不跟随源记录修改',
      created_at DATETIME(3) NOT NULL COMMENT '发布时间，协调世界时',
      UNIQUE KEY uq_week_publication(team_id,week,kind,revision), FOREIGN KEY(team_id) REFERENCES teams(id)
    ) ${suffix} COMMENT='不可变周计划及周报发布版本'`);
    await runner.query(`CREATE TABLE weekly_pending (
      id CHAR(36) PRIMARY KEY COMMENT '待分配周事项标识', draft_id CHAR(36) NOT NULL COMMENT '所属共享草稿',
      task_id CHAR(36) NOT NULL COMMENT '待落实执行人员的团队任务', version INT NOT NULL DEFAULT 0 COMMENT '并发修改版本',
      UNIQUE KEY uq_pending_task(draft_id,task_id), FOREIGN KEY(draft_id) REFERENCES weekly_drafts(id), FOREIGN KEY(task_id) REFERENCES team_tasks(id)
    ) ${suffix} COMMENT='允许随周计划发布的待分配事项'`);
    await runner.query(`CREATE TABLE report_drafts (
      id CHAR(36) PRIMARY KEY COMMENT '共享周报草稿标识', team_id CHAR(36) NOT NULL COMMENT '所属团队', week DATE NOT NULL COMMENT '周报归属周周一',
      version INT NOT NULL DEFAULT 0 COMMENT '草稿并发版本', entries_json JSON NOT NULL COMMENT '人工整理条目及完整来源映射，排除项保留',
      UNIQUE KEY uq_report_draft(team_id,week), FOREIGN KEY(team_id) REFERENCES teams(id)
    ) ${suffix} COMMENT='团队共享周报草稿与增量整理结果'`);
    await runner.query(`CREATE TABLE work_tags (
      id CHAR(36) PRIMARY KEY COMMENT '人工标签标识', object_id CHAR(36) NOT NULL COMMENT '团队任务或个人工作标识',
      object_kind VARCHAR(16) NOT NULL COMMENT '对象类型：任务或个人工作', dimension VARCHAR(16) NOT NULL COMMENT '标签维度：里程碑外或周计划外',
      week_key VARCHAR(10) NOT NULL DEFAULT '' COMMENT '周计划外标签的周一日期，里程碑外为空', marked TINYINT NOT NULL COMMENT '是否人工标记，零表示人工清除',
      version INT NOT NULL DEFAULT 0 COMMENT '标签并发版本', UNIQUE KEY uq_work_tag(object_id,object_kind,dimension,week_key)
    ) ${suffix} COMMENT='工作事项人工计划外标签，不根据日期自动推断'`);
    await runner.query(`CREATE TABLE weekly_events (
      id CHAR(36) PRIMARY KEY COMMENT '周业务变更记录标识', team_id CHAR(36) NOT NULL COMMENT '所属团队', actor_id CHAR(36) NOT NULL COMMENT '操作账号',
      action VARCHAR(80) NOT NULL COMMENT '操作类型', payload_json JSON NOT NULL COMMENT '变更前后及原因，不覆盖历史',
      created_at DATETIME(3) NOT NULL COMMENT '发生时间，协调世界时', FOREIGN KEY(team_id) REFERENCES teams(id)
    ) ${suffix} COMMENT='周安排、周报及人工标签的变更历史'`);
  }
  /** 不提供破坏历史的自动降级。 */
  async down(): Promise<void> { throw new Error('Use a reviewed forward migration'); }
}
