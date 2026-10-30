import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { v2PlanningLabelSchema, type V2Period, type V2PlanningChange, type V2PlanningLabel, type V2Task } from '@ntfs/contracts';
import { dbTime } from './repository-utils.js';

/** 标签独立于有效安排保存，调用方须持有任务授权、聚合版本及事务锁。 */
export class V2PlanningLabelsRepository {
  constructor(private readonly manager: EntityManager) {}

  /** 只接收已授权任务；同时返回取消过的周期，便于重新加入时恢复人工选择。 */
  async read(taskIds: string[]): Promise<V2PlanningLabel[]> {
    if (!taskIds.length) return [];
    return z.array(v2PlanningLabelSchema.extend({ unplanned: z.coerce.boolean().nullable() })).parse(await this.manager.query(
      `SELECT task_id AS taskId,period_id AS periodId,unplanned FROM v2_task_planning_labels WHERE task_id IN (${taskIds.map(() => '?').join(',')})`, taskIds));
  }

  /** 省略保留既有标签；无记录的新周期默认不标记，显式 true/false 可纠正不可还原数据。 */
  async save(task: V2Task, period: V2Period, requested: boolean | undefined, actorId: string | null, now: string): Promise<V2PlanningChange | undefined> {
    const previous = (await this.read([task.id])).find((row) => row.periodId === period.id);
    if (previous && (requested === undefined || previous.unplanned === requested)) return undefined;
    const value = requested ?? false;
    await this.manager.query(`INSERT INTO v2_task_planning_labels(task_id,period_id,team_id,unplanned,updated_by,updated_at) VALUES (?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE unplanned=VALUES(unplanned),updated_by=VALUES(updated_by),updated_at=VALUES(updated_at)`, [task.id, period.id, task.teamId, Number(value), actorId, dbTime(now)]);
    // 标签也是人工调整，补录完成时间时不能静默撤销已修改的自动顺延。
    if (previous && actorId !== null) await this.manager.query('UPDATE v2_arrangements SET version=version+1 WHERE task_id=? AND period_id=?', [task.id, period.id]);
    return { periodId: period.id, startOn: period.startOn, endOn: period.endOn, before: previous?.unplanned ?? null, after: value };
  }

  /** 当前周期首次勾选才占用通知标识；在同一业务事务内处理，回滚不吞通知。 */
  async claimNotification(taskId: string, periodId: string, now: string): Promise<boolean> {
    const result = z.object({ affectedRows: z.number() }).parse(await this.manager.query(
      'UPDATE v2_task_planning_labels SET notified_at=? WHERE task_id=? AND period_id=? AND unplanned=1 AND notified_at IS NULL', [dbTime(now), taskId, periodId]));
    return result.affectedRows === 1;
  }
}
