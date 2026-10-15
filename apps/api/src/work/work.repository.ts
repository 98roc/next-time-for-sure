import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { workRequestSchema, workSnapshotSchema } from '@ntfs/contracts';
import type { WorkSnapshot } from '@ntfs/contracts';
import { MilestoneRepository } from './milestone.repository.js';
import { notifyWork } from '../notifications/work-notifications.js';

const requestSelect = 'SELECT id, project_id AS projectId, submitter_id AS submitterId, title, description, acceptance, status, version FROM work_requests';

/** 需求与任务数据访问；调用前由服务统一建立事务、身份和作用域。 */
export class WorkRepository {
  constructor(private readonly manager: EntityManager) {}

  /** 按项目读取对象及其历史，不读取个人或私人事项。 */
  async snapshot(project: string): Promise<WorkSnapshot> {
    const requests: unknown = await this.manager.query(`${requestSelect} WHERE project_id = ? ORDER BY created_at`, [project]);
    const tasks: unknown = await this.manager.query(`SELECT id, project_id AS projectId, request_id AS requestId, parent_id AS parentId, owner_id AS ownerId, title, description, acceptance, status, version, milestone_id AS milestoneId, in_milestone AS inMilestone, DATE_FORMAT(expected_on, '%Y-%m-%d') AS expectedOn, DATE_FORMAT(started_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS startedAt, DATE_FORMAT(ended_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS endedAt, progress, position, blocked_reason AS blockedReason, waiting_for AS waitingFor, waiting_task_id AS waitingTaskId FROM team_tasks WHERE project_id = ? ORDER BY position, created_at, id`, [project]);
    const events: unknown = await this.manager.query("SELECT id, object_id AS objectId, actor_id AS actorId, action, payload_json, DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt FROM work_events WHERE project_id = ? ORDER BY created_at, id", [project]);
    const rows = z.array(z.object({ id: z.string(), objectId: z.string(), actorId: z.string(), action: z.string(), payload_json: z.unknown(), createdAt: z.string() })).parse(events);
    return workSnapshotSchema.parse({ requests, tasks, milestones: await new MilestoneRepository(this.manager).list(project), events: rows.map(({ payload_json, ...row }) => ({ ...row, payload: typeof payload_json === 'string' ? JSON.parse(payload_json) : payload_json })) });
  }

  /** 锁定需求，使编辑、撤回及接收竞争在同一版本上裁决。 */
  async request(id: string) {
    const rows: unknown = await this.manager.query(`${requestSelect} WHERE id = ? FOR UPDATE`, [id]);
    return z.array(workRequestSchema).parse(rows)[0];
  }

  /** 插入新需求，初始待处理，不自动创建任务或排期。 */
  async createRequest(project: string, actor: string, title: string, description: string, acceptance: string): Promise<string> {
    const id = randomUUID();
    await this.manager.query('INSERT INTO work_requests (id, project_id, submitter_id, title, description, acceptance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))', [id, project, actor, title, description, acceptance]);
    return id;
  }

  /** 修改原始需求内容，不改动已记录历史。 */
  async editRequest(id: string, title: string, description: string, acceptance: string): Promise<void> {
    await this.manager.query('UPDATE work_requests SET title = ?, description = ?, acceptance = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [title, description, acceptance, id]);
  }

  /** 处理与补充均递增版本，接收方只能基于最新内容操作。 */
  async setRequestStatus(id: string, status: string): Promise<void> {
    await this.manager.query('UPDATE work_requests SET status = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [status, id]);
  }

  /** 一条来源需求至多一条任务；创建不生成执行分工或周安排。 */
  async createTask(project: string, request: string | null, owner: string, title: string, description: string, acceptance: string): Promise<string> {
    const id = randomUUID();
    await this.manager.query('INSERT INTO team_tasks (id, project_id, request_id, owner_id, title, description, acceptance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))', [id, project, request, owner, title, description, acceptance]);
    return id;
  }

  /** 内容修改与规划共用任务版本，避免两个视图静默覆盖。 */
  async editTask(id: string, title: string, description: string, acceptance: string): Promise<void> {
    await this.manager.query('UPDATE team_tasks SET title = ?, description = ?, acceptance = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [title, description, acceptance, id]);
  }

  /** 业务历史保存输入快照，追加说明不会隐式改写团队任务。 */
  async event(project: string, object: string, actor: string, action: string, payload: unknown): Promise<void> {
    const id = randomUUID();
    await this.manager.query('INSERT INTO work_events (id, project_id, object_id, actor_id, action, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))', [id, project, object, actor, action, JSON.stringify(payload)]);
    await notifyWork(this.manager, id, project, object, action, payload);
  }

  /** 幂等键仅在当前身份内有效，匹配内容由服务验证。 */
  async operation(actor: string, operation: string) {
    const rows: unknown = await this.manager.query('SELECT payload_hash AS hash, object_id AS objectId FROM work_operations WHERE actor_id = ? AND operation_id = ?', [actor, operation]);
    return z.array(z.object({ hash: z.string(), objectId: z.string() })).parse(rows)[0];
  }

  /** 与业务写入同事务记录成功结果，失败操作不占用幂等键。 */
  async recordOperation(actor: string, operation: string, hash: string, object: string): Promise<void> {
    await this.manager.query('INSERT INTO work_operations (actor_id, operation_id, payload_hash, object_id, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))', [actor, operation, hash, object]);
  }
}
