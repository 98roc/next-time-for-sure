import { ConflictException } from '@nestjs/common';
import { upcomingTaskReminders, v2TaskReminderSchema, type V2Task, type V2TaskReminderPlan } from '@ntfs/contracts';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { decodeJson, instantColumn } from './repository-utils.js';

const select = `SELECT task_id AS taskId,plan_json AS plan,${instantColumn('next_at', 'nextAt')} FROM v2_task_reminders`;
const scheduleRows = z.array(v2TaskReminderSchema.extend({ plan: z.preprocess(decodeJson, v2TaskReminderSchema.shape.plan) }));

/** 任务配置和发送进度都在组织锁内写入，与完成、删除及改派串行。 */
export class V2TaskReminderRepository {
  constructor(private readonly manager: EntityManager) {}

  /** 调用方传入已鉴权且可维护的任务。 */
  async read(taskIds: string[]) {
    if (!taskIds.length) return [];
    return scheduleRows.parse(await this.manager.query(`${select} WHERE task_id IN (${taskIds.map(() => '?').join(',')})`, taskIds));
  }

  /** null 清除配置；有配置时至少保留一个未来触发点。 */
  async save(task: V2Task, plan: V2TaskReminderPlan | null, now: number): Promise<void> {
    if (!plan) return this.clear(task.id);
    if (task.status === 'completed' || task.deletedAt) throw new ConflictException('仅未完成的任务可以设置定时提醒。');
    const { first } = upcomingTaskReminders(plan, now);
    if (first === null) throw new ConflictException('请选择未来的提醒时间。');
    await this.manager.query(
      'INSERT INTO v2_task_reminders(task_id,plan_json,next_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE plan_json=VALUES(plan_json),next_at=VALUES(next_at)',
      [task.id, JSON.stringify(plan), new Date(first)],
    );
  }

  /** 完成或删除时清除配置，重开任务需要重新设置。 */
  async clear(taskId: string): Promise<void> {
    await this.manager.query('DELETE FROM v2_task_reminders WHERE task_id=?', [taskId]);
  }

  /** 空闲检查走索引，不占用组织锁。 */
  async hasDue(now: Date): Promise<boolean> {
    const rows: unknown[] = await this.manager.query('SELECT task_id FROM v2_task_reminders WHERE next_at<=? LIMIT 1', [now]);
    return rows.length > 0;
  }

  /** 获取有界批次，锁内按最早提醒优先处理。 */
  async due(now: Date) {
    return scheduleRows.parse(await this.manager.query(`${select} WHERE next_at<=? ORDER BY next_at,task_id LIMIT 50`, [now]));
  }

  /** 消息与下一次时间一起提交，无后续发送时保留已结束的设置供编辑。 */
  async advance(taskId: string, next: number | null): Promise<void> {
    await this.manager.query('UPDATE v2_task_reminders SET next_at=? WHERE task_id=?', [next === null ? null : new Date(next), taskId]);
  }
}
