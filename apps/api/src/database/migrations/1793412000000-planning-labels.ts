import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 固化旧判定结果；后续仅由显式写入修改，取消安排不清除标签及通知去重依据。 */
export class PlanningLabels1793412000000 implements MigrationInterface {
  name = 'PlanningLabels1793412000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE IF NOT EXISTS v2_task_planning_labels (
      task_id CHAR(36) NOT NULL COMMENT '来源项目任务，取消安排后仍保留标签',
      period_id CHAR(36) NOT NULL COMMENT '标签所属日期区间，不跨周期继承',
      team_id CHAR(36) NOT NULL COMMENT '任务和区间共用团队，外键阻止跨团队标记',
      unplanned TINYINT NULL COMMENT '一为计划外，零为未标记，空为历史来源不可还原',
      notified_at DATETIME(3) NULL COMMENT '本任务本周期首次计划外通知处理时刻，反复勾选不重发',
      updated_by CHAR(36) NULL COMMENT '最近修改人，历史初始化和系统追加为空',
      updated_at DATETIME(3) NOT NULL COMMENT '最近实际写入时刻，协调世界时',
      PRIMARY KEY(task_id,period_id),
      FOREIGN KEY(task_id,team_id) REFERENCES v2_tasks(id,team_id) ON DELETE CASCADE,
      FOREIGN KEY(period_id,team_id) REFERENCES v2_periods(id,team_id),
      FOREIGN KEY(updated_by) REFERENCES accounts(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='按任务和周期保存的计划外标签及首次通知记录'`);

    // 使用与旧实现相同的事件/安排排序固定一次；不发送迁移通知，也不覆盖重跑前已保存的选择。
    await runner.query(`INSERT IGNORE INTO v2_task_planning_labels(task_id,period_id,team_id,unplanned,notified_at,updated_by,updated_at)
      SELECT baseline.task_id,baseline.period_id,baseline.team_id,baseline.marked,CASE WHEN baseline.marked=1 THEN UTC_TIMESTAMP(3) ELSE NULL END,NULL,UTC_TIMESTAMP(3) FROM (
        SELECT pairs.task_id,pairs.period_id,t.team_id,
          CASE WHEN e.action IS NULL OR e.action<>'created' THEN NULL
            WHEN b.converted_task_id IS NOT NULL THEN 0 WHEN initial.id IS NULL THEN NULL
            WHEN initial.period_id=p.id AND e.occurred_at>=DATE_SUB(TIMESTAMP(p.start_on),INTERVAL 8 HOUR)
              AND e.occurred_at<DATE_SUB(TIMESTAMP(DATE_ADD(p.end_on,INTERVAL 1 DAY)),INTERVAL 8 HOUR) THEN 1 ELSE 0 END AS marked
        FROM (SELECT task_id,period_id FROM v2_arrangements UNION SELECT task_id,period_id FROM v2_arrangement_history) pairs
        JOIN v2_tasks t ON t.id=pairs.task_id AND t.kind='project'
        JOIN v2_periods p ON p.id=pairs.period_id AND p.team_id=t.team_id
        LEFT JOIN v2_task_events e ON e.task_id=t.id AND e.sequence=(SELECT MIN(first_event.sequence) FROM v2_task_events first_event WHERE first_event.task_id=t.id)
        LEFT JOIN v2_backlog b ON b.converted_task_id=t.id
        LEFT JOIN v2_arrangement_history initial ON initial.id=(SELECT first_arrangement.id FROM v2_arrangement_history first_arrangement
          WHERE first_arrangement.task_id=t.id AND first_arrangement.provenance='scheduled' ORDER BY first_arrangement.valid_from,first_arrangement.id LIMIT 1)
      ) baseline`);
  }

  async down(): Promise<void> { throw new Error('人工标签及通知记录不可丢弃，请通过备份恢复。'); }
}
