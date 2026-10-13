import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { assignmentSchema, assignmentSnapshotSchema, teamTaskSchema } from '@ntfs/contracts';
import type { AssignmentSnapshot } from '@ntfs/contracts';

const selectAssignments = `SELECT a.id, a.task_id AS taskId, a.origin_task_id AS originTaskId, a.account_id AS accountId, a.group_id AS groupId, a.content, a.source, a.status, a.version,
  DATE_FORMAT(a.started_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS startedAt,
  DATE_FORMAT(a.ended_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS endedAt,
  DATE_FORMAT(a.transferred_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS transferredAt FROM task_assignments a`;

/** 分工及进展SQL集中管理，不提供可任意代改个人事实的通用更新入口。 */
export class AssignmentRepository {
  constructor(private readonly manager: EntityManager) {}
  /** 原地迁移有效责任，进展和个人关联保留原标识，首次来源仅写一次。 */
  async moveToChild(id: string, task: string): Promise<void> {
    await this.manager.query('UPDATE task_assignments SET origin_task_id = COALESCE(origin_task_id, task_id), task_id = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [task, id]);
  }

  /** 指定项目的团队侧分工和进展，返回前由服务校验项目访问权。 */
  async snapshot(projectId: string): Promise<AssignmentSnapshot> {
    const assignments: unknown = await this.manager.query(`${selectAssignments} JOIN team_tasks t ON t.id = a.task_id WHERE t.project_id = ? ORDER BY a.created_at`, [projectId]);
    const progress: unknown = await this.manager.query(`SELECT p.id, p.assignment_id AS assignmentId, DATE_FORMAT(p.occurred_on, '%Y-%m-%d') AS occurredOn, DATE_FORMAT(p.report_week, '%Y-%m-%d') AS reportWeek, p.content, DATE_FORMAT(p.created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt FROM assignment_progress p JOIN task_assignments a ON a.id = p.assignment_id JOIN team_tasks t ON t.id = a.task_id WHERE t.project_id = ? ORDER BY p.created_at`, [projectId]);
    return assignmentSnapshotSchema.parse({ assignments, progress });
  }

  /** 锁定分工，版本检查在服务完成。 */
  async assignment(id: string) {
    const rows: unknown = await this.manager.query(`${selectAssignments} WHERE a.id = ? FOR UPDATE`, [id]);
    return z.array(assignmentSchema).parse(rows)[0];
  }

  /** 读取当前团队任务，执行限制不信任客户端状态。 */
  async task(id: string) {
    const rows: unknown = await this.manager.query(`SELECT id, project_id AS projectId, request_id AS requestId, parent_id AS parentId, owner_id AS ownerId, title, description, acceptance, status, version, in_milestone AS inMilestone, DATE_FORMAT(expected_on, '%Y-%m-%d') AS expectedOn, DATE_FORMAT(started_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS startedAt, DATE_FORMAT(ended_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS endedAt, progress, position FROM team_tasks WHERE id = ? FOR UPDATE`, [id]);
    return z.array(teamTaskSchema).parse(rows)[0];
  }

  /** 拆分后的父任务不能继续承接分工。 */
  async hasChildren(task: string): Promise<boolean> {
    const rows: unknown = await this.manager.query('SELECT id FROM team_tasks WHERE parent_id = ? LIMIT 1', [task]);
    return z.array(z.object({ id: z.string() })).parse(rows).length > 0;
  }

  /** 有效分工包含已完成责任，退出或转交后方可建立新责任。 */
  async hasActive(task: string, account: string): Promise<boolean> {
    const rows: unknown = await this.manager.query("SELECT id FROM task_assignments WHERE task_id = ? AND account_id = ? AND status NOT IN ('exited', 'transferred')", [task, account]);
    return z.array(z.object({ id: z.string() })).parse(rows).length > 0;
  }

  /** 管理分配或认领只生成分工，不生成个人任务及周安排。 */
  async create(task: string, account: string, group: string, content: string, source: 'assigned' | 'claimed'): Promise<string> {
    const id = randomUUID();
    await this.manager.query('INSERT INTO task_assignments (id, task_id, account_id, group_id, content, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))', [id, task, account, group, content, source]);
    return id;
  }

  /** 只调整责任归属和内容，不修改执行人状态或时间。 */
  async adjust(id: string, group: string, content: string): Promise<void> {
    await this.manager.query('UPDATE task_assignments SET group_id = ?, content = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [group, content, id]);
  }

  /** 记录本人状态或责任终止；转交时间与实际完成时间分别保存。 */
  async transition(id: string, status: 'in_progress' | 'completed' | 'exited' | 'transferred'): Promise<void> {
    const times = status === 'in_progress' ? ', started_at = COALESCE(started_at, UTC_TIMESTAMP(3)), ended_at = NULL' : status === 'completed' ? ', ended_at = UTC_TIMESTAMP(3)' : status === 'transferred' ? ', transferred_at = UTC_TIMESTAMP(3)' : '';
    await this.manager.query(`UPDATE task_assignments SET status = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)${times} WHERE id = ?`, [status, id]);
  }

  /** 进展逐条新增，发生日期和归属周分开保存。 */
  async progress(id: string, occurred: string, week: string, content: string): Promise<string> {
    const progressId = randomUUID();
    await this.manager.query('INSERT INTO assignment_progress (id, assignment_id, occurred_on, report_week, content, created_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))', [progressId, id, occurred, week, content]);
    await this.manager.query('UPDATE task_assignments SET version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [id]);
    return progressId;
  }

  /** 仅由服务校验过的本人补录时间，不自动传播到其他对象。 */
  async correctTimes(id: string, started: string | null, ended: string | null): Promise<void> {
    await this.manager.query('UPDATE task_assignments SET started_at = ?, ended_at = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [started ? new Date(started) : null, ended ? new Date(ended) : null, id]);
  }

  /** 恢复责任状态时保留开始时间、清空当前结束时间，不填充个人任务的时间。 */
  async restoreUnfinished(id: string): Promise<void> {
    await this.manager.query("UPDATE task_assignments SET status = IF(started_at IS NULL, 'not_started', 'in_progress'), ended_at = NULL, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?", [id]);
  }
}
