import type { EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { MilestoneRepository } from './milestone.repository.js';
import { z } from 'zod';
import type { SplitCommand, WorkSnapshot } from '@ntfs/contracts';

/** 团队状态写入集中管理，不更新分工和个人事项的执行字段。 */
export class TaskRepository {
  constructor(private readonly manager: EntityManager) {}
  /** 主负责人补记整体时间，允许结束后修正，不联动状态或成员时间。 */
  async times(id: string, startedAt: string | null, endedAt: string | null): Promise<void> {
    await this.manager.query('UPDATE team_tasks SET started_at = ?, ended_at = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [startedAt ? new Date(startedAt) : null, endedAt ? new Date(endedAt) : null, id]);
  }
  /** 人工维护阻塞标记，清空原因同步清空等待信息，不改状态。 */
  async blocker(id: string, reason: string, waiting: string, waitingId: string | null): Promise<void> { await this.manager.query('UPDATE team_tasks SET blocked_reason = ?, waiting_for = ?, waiting_task_id = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [reason, reason ? waiting : '', reason ? waitingId : null, id]); }
  /** 仅修改列内顺序，递增版本让旧确认和并发排序显式冲突。 */
  async position(id: string, position: number): Promise<void> { await this.manager.query('UPDATE team_tasks SET position = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [position, id]); }
  /** 子任务继承当前父任务主负责人，初始状态和时间独立，不继承规划日期。 */
  async child(parent: WorkSnapshot['tasks'][number], content: SplitCommand['children'][number]): Promise<string> {
    const id = randomUUID();
    await this.manager.query('INSERT INTO team_tasks (id, project_id, parent_id, owner_id, title, description, acceptance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))', [id, parent.projectId, parent.id, parent.ownerId, content.title, content.description, content.acceptance]);
    if (parent.milestoneId) await new MilestoneRepository(this.manager).link(id, parent.milestoneId);
    return id;
  }
  /** 关联结构改变使旧父任务确认失效，不改写整体状态和进度。 */
  async touch(id: string): Promise<void> { await this.manager.query('UPDATE team_tasks SET version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [id]); }
  /** 仅撤销一次从无开始时间进入进行中的操作，后续时间修正、完成或重开不能被清空。 */
  async hasUndoableStart(id: string): Promise<boolean> {
    const rows: unknown = await this.manager.query(`SELECT action, JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.before.startedAt')) AS previousStart
      FROM work_events WHERE object_id = ? AND action IN ('task.start_task', 'task.undo_start_task', 'task.task_times', 'task.complete_task', 'task.cancel_task', 'task.reopen_task')
      ORDER BY CAST(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.after.version')) AS UNSIGNED) DESC LIMIT 1`, [id]);
    const latest = z.array(z.object({ action: z.string(), previousStart: z.string().nullable() })).parse(rows)[0];
    return latest?.action === 'task.start_task' && latest.previousStart === 'null';
  }

  /** 只返回执行事实是否存在，不向调用者暴露关联个人事项内容；任务锁与组织锁由服务事务持有。 */
  async hasExecutionFacts(id: string): Promise<boolean> {
    const rows: unknown = await this.manager.query(`SELECT t.id FROM team_tasks t WHERE (t.id = ? OR t.parent_id = ?) AND (
      (t.id <> ? AND (t.status <> 'not_started' OR t.started_at IS NOT NULL OR t.ended_at IS NOT NULL OR t.progress > 0))
      OR EXISTS (SELECT 1 FROM work_events e WHERE e.object_id = t.id AND (e.action IN ('task.complete_task', 'task.reopen_task') OR (e.action = 'task.task_progress' AND JSON_EXTRACT(e.payload_json, '$.progress') > 0)))
      OR EXISTS (SELECT 1 FROM task_assignments a WHERE a.task_id = t.id AND (a.status <> 'not_started' OR a.started_at IS NOT NULL OR a.ended_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM assignment_progress p WHERE p.assignment_id = a.id)
        OR EXISTS (SELECT 1 FROM personal_items i WHERE i.assignment_id = a.id AND (i.status <> 'not_started' OR i.started_at IS NOT NULL OR i.ended_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM personal_progress p WHERE p.item_id = i.id)))
        OR EXISTS (SELECT 1 FROM personal_events e WHERE (JSON_UNQUOTE(JSON_EXTRACT(e.payload_json, '$.before.assignmentId')) = a.id OR JSON_UNQUOTE(JSON_EXTRACT(e.payload_json, '$.after.assignmentId')) = a.id)
          AND e.action IN ('personal_progress', 'start_personal', 'complete_personal', 'personal_times'))))
      ) LIMIT 1`, [id, id, id]);
    return z.array(z.object({ id: z.string() })).parse(rows).length > 0;
  }

  /** 清除误点产生的团队开始时间，执行历史、子任务、分工和个人事项均保留。 */
  async undoStart(id: string): Promise<void> {
    await this.manager.query("UPDATE team_tasks SET status = 'not_started', started_at = NULL, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?", [id]);
  }
  /** 首次开始保留原时间；重开不会自动开始，不伪造开始时间。 */
  async transition(id: string, action: 'start_task' | 'complete_task' | 'cancel_task' | 'reopen_task', inherited = false): Promise<void> {
    const status = action === 'start_task' ? "'in_progress'" : action === 'complete_task' ? "'completed'" : action === 'cancel_task' ? "'cancelled'" : "IF(started_at IS NULL, 'not_started', 'in_progress')";
    const times = action === 'start_task' ? ', started_at = COALESCE(started_at, UTC_TIMESTAMP(3))' : action === 'reopen_task' ? ', ended_at = NULL' : action === 'complete_task' && !inherited ? ', ended_at = UTC_TIMESTAMP(3)' : '';
    await this.manager.query(`UPDATE team_tasks SET status = ${status}${times}, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [id]);
  }
  /** 更换责任身份不创建分工，不调整当前执行事实。 */
  async owner(id: string, owner: string): Promise<void> { await this.manager.query('UPDATE team_tasks SET owner_id = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [owner, id]); }
  /** 累计进度不按子任务数量推算，100也不自动整体结束。 */
  async progress(id: string, value: number): Promise<void> { await this.manager.query('UPDATE team_tasks SET progress = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [value, id]); }
}
