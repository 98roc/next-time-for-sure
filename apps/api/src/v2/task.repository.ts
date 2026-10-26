import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { v2ArrangementSchema, v2TaskEventSchema, v2TaskSchema, type V2Task, type V2TaskEvent } from '@ntfs/contracts';
import { dbTime, decodeJson, instantColumn } from './repository-utils.js';

const taskSelect = `SELECT id,kind,team_id AS teamId,project_id AS projectId,creator_id AS creatorId,executor_id AS executorId,milestone_id AS milestoneId,title,priority,status,version,actual_days + 0e0 AS actualDays,ai_contribution AS aiContribution,${instantColumn('started_at','startedAt')},${instantColumn('completed_at','completedAt')},${instantColumn('deleted_at','deletedAt')},${instantColumn('created_at','createdAt')},${instantColumn('updated_at','updatedAt')} FROM v2_tasks`;

/** 任务与安排集中访问；调用者必须在同一身份及组织事务内完成规则检查。 */
export class V2TaskRepository {
  constructor(private readonly manager: EntityManager) {}

  /** 只从数据库返回已授权项目及本人私人任务，历史对象由单独接口授权。 */
  async visible(ownerId: string, projectIds: string[]): Promise<V2Task[]> {
    const projectClause = projectIds.length ? ` OR (kind='project' AND project_id IN (${projectIds.map(() => '?').join(',')}))` : '';
    return z.array(v2TaskSchema).parse(await this.manager.query(`${taskSelect} WHERE deleted_at IS NULL AND ((kind='private' AND executor_id=?)${projectClause}) ORDER BY priority,created_at,id`, [ownerId, ...projectIds]));
  }

  /** 同一组织锁内读取聚合；逻辑删除记录可用于幂等及历史权限判断。 */
  async get(id: string): Promise<V2Task | undefined> { return z.array(v2TaskSchema).parse(await this.manager.query(`${taskSelect} WHERE id=?`, [id]))[0]; }

  /** 创建任务和其事件，首个区间及个人位置由上层在同事务建立。 */
  async insert(task: V2Task, actorId: string): Promise<void> {
    await this.manager.query(`INSERT INTO v2_tasks(id,kind,team_id,project_id,creator_id,executor_id,milestone_id,title,priority,status,actual_days,ai_contribution,started_at,completed_at,history_known_from,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [task.id, task.kind, task.teamId, task.projectId, task.creatorId, task.executorId, task.milestoneId, task.title, task.priority, task.status, task.actualDays ?? null, task.aiContribution ?? null, dbTime(task.startedAt ?? null), dbTime(task.completedAt), dbTime(task.createdAt), task.version, dbTime(task.createdAt), dbTime(task.updatedAt)]);
    await this.event(task, actorId, 'created', null);
  }

  /** 每次聚合更新只追加一个对应版本事件，执行人代改由实际 actorId 留痕。 */
  async update(previous: V2Task, task: V2Task, actorId: string | null, action: V2TaskEvent['action'] = 'updated'): Promise<void> {
    await this.manager.query('UPDATE v2_tasks SET title=?,executor_id=?,milestone_id=?,priority=?,status=?,started_at=?,completed_at=?,actual_days=?,ai_contribution=?,deleted_at=?,version=?,updated_at=? WHERE id=?', [task.title, task.executorId, task.milestoneId, task.priority, task.status, dbTime(task.startedAt ?? null), dbTime(task.completedAt), task.actualDays ?? null, task.aiContribution ?? null, dbTime(task.deletedAt), task.version, dbTime(task.updatedAt), task.id]);
    await this.event(task, actorId, action, previous.status);
  }

  /** 事件快照保留当前业务字段而不保存认证或旧说明内容。 */
  async event(task: V2Task, actorId: string | null, action: V2TaskEvent['action'], beforeStatus: V2TaskEvent['beforeStatus']): Promise<void> {
    const names = z.array(z.object({ id: z.string(), name: z.string() })).parse(await this.manager.query('SELECT id,display_name AS name FROM accounts WHERE id IN (?,?)', [task.executorId, actorId]));
    const projects = task.projectId ? z.array(z.object({ name: z.string() })).parse(await this.manager.query('SELECT name FROM projects WHERE id=?', [task.projectId])) : [];
    const snapshot = { task, projectName: projects[0]?.name ?? null, executorName: names.find((row) => row.id === task.executorId)?.name ?? null, actorName: names.find((row) => row.id === actorId)?.name ?? null };
    await this.manager.query('INSERT INTO v2_task_events(id,task_id,sequence,actor_id,action,before_status,snapshot_json,occurred_at) VALUES (?,?,?,?,?,?,?,?)', [randomUUID(), task.id, task.version, actorId, action, beforeStatus, JSON.stringify(snapshot), dbTime(task.updatedAt)]);
  }

  /** 读取已授权任务的不可变事件；排序在相同毫秒下仍以版本稳定。 */
  async history(taskIds: string[]): Promise<V2TaskEvent[]> {
    if (!taskIds.length) return [];
    const rows = z.array(z.object({ snapshot_json: z.unknown(), id: z.string(), taskId: z.string(), sequence: z.number(), actorId: z.string().nullable(), action: z.string(), beforeStatus: z.string().nullable(), occurredAt: z.string() })).parse(await this.manager.query(`SELECT id,task_id AS taskId,sequence,actor_id AS actorId,action,before_status AS beforeStatus,snapshot_json,${instantColumn('occurred_at','occurredAt')} FROM v2_task_events WHERE task_id IN (${taskIds.map(() => '?').join(',')}) ORDER BY occurred_at,sequence`, taskIds));
    const converted = z.array(z.object({ taskId: z.string() })).parse(await this.manager.query(`SELECT converted_task_id AS taskId FROM v2_backlog WHERE converted_task_id IN (${taskIds.map(() => '?').join(',')})`, taskIds));
    return rows.map(({ snapshot_json, ...row }) => {
      const decoded = decodeJson(snapshot_json);
      const envelope = z.object({ task: v2TaskSchema, projectName: z.string().nullable().optional(), executorName: z.string().nullable(), actorName: z.string().nullable() }).safeParse(decoded);
      // 早期或迁移缺证据的快照明确保留空姓名，不拿现有账号姓名伪造历史。
      return v2TaskEventSchema.parse({ ...row, fromBacklog: converted.some((item) => item.taskId === row.taskId), snapshot: envelope.success ? envelope.data.task : decoded, projectName: envelope.success ? envelope.data.projectName ?? null : null, executorName: envelope.success ? envelope.data.executorName : null, actorName: envelope.success ? envelope.data.actorName : null });
    });
  }

  /** 历史总结也需已删除项目任务，但不能因历史而读取他人私人内容。 */
  async projectTaskIds(projectIds: string[]): Promise<string[]> {
    if (!projectIds.length) return [];
    return z.array(z.object({ id: z.string() })).parse(await this.manager.query(`SELECT id FROM v2_tasks WHERE kind='project' AND project_id IN (${projectIds.map(() => '?').join(',')})`, projectIds)).map((row) => row.id);
  }

  /** 项目排序保留历史任务位置，不向该项目权限之外暴露任何对象。 */
  async projectOrderTasks(projectIds: string[]): Promise<V2Task[]> {
    if (!projectIds.length) return [];
    return z.array(v2TaskSchema).parse(await this.manager.query(`${taskSelect} WHERE kind='project' AND project_id IN (${projectIds.map(() => '?').join(',')}) ORDER BY priority,created_at,id`, projectIds));
  }

  /** 当前安排供编辑使用，历史总结不能用此查询替代有效时间片。 */
  async arrangements(taskIds: string[]) {
    if (!taskIds.length) return [];
    return z.array(v2ArrangementSchema.extend({ plannedDays: z.coerce.number().nullable() })).parse(await this.manager.query(`SELECT task_id AS taskId,period_id AS periodId,planned_days AS plannedDays,work_note AS workNote,carried_from_period_id AS carriedFromPeriodId,position,version FROM v2_arrangements WHERE task_id IN (${taskIds.map(() => '?').join(',')}) ORDER BY position,task_id`, taskIds));
  }

  /** 新安排保留内容和来源；系统顺延复制预计值，但不复制人工工作文本。 */
  async addArrangement(task: V2Task, periodId: string, plannedDays: number | null, actorId: string | null, now: string, workNote = '', carriedFromPeriodId: string | null = null): Promise<void> {
    await this.manager.query('INSERT INTO v2_arrangements(task_id,period_id,team_id,planned_days,work_note,carried_from_period_id,position) SELECT ?,?,?,?,?,?,COALESCE(MAX(position),-1)+1 FROM v2_arrangements WHERE period_id=?', [task.id, periodId, task.teamId, plannedDays, workNote, carriedFromPeriodId, periodId]);
    await this.arrangementEvent(task.id, periodId, plannedDays, actorId, now, workNote, carriedFromPeriodId);
  }

  /** 关闭片段后删除当前关系；补录完成只作废未经人工修改的系统顺延。 */
  async removeArrangement(taskId: string, periodId: string, now: string, voided = false): Promise<void> {
    await this.manager.query('UPDATE v2_arrangement_history SET valid_until=? WHERE task_id=? AND period_id=? AND valid_until IS NULL', [dbTime(now), taskId, periodId]);
    if (voided) await this.manager.query('UPDATE v2_arrangement_history SET voided=1 WHERE task_id=? AND period_id=?', [taskId, periodId]);
    await this.manager.query('DELETE FROM v2_arrangements WHERE task_id=? AND period_id=?', [taskId, periodId]);
  }

  /** 内容或估算变更保留历史及顺延来源；省略工作内容时不清空旧值。 */
  async estimate(task: V2Task, periodId: string, plannedDays: number | null, actorId: string, now: string, workNote?: string): Promise<void> {
    const old = (await this.arrangements([task.id])).find((row) => row.periodId === periodId);
    if (!old) throw new Error('周期安排已不存在');
    const note = workNote ?? old.workNote ?? '';
    await this.manager.query('UPDATE v2_arrangements SET planned_days=?,work_note=?,version=version+1 WHERE task_id=? AND period_id=?', [plannedDays, note, task.id, periodId]);
    await this.manager.query('UPDATE v2_arrangement_history SET valid_until=? WHERE task_id=? AND period_id=? AND valid_until IS NULL', [dbTime(now), task.id, periodId]);
    await this.arrangementEvent(task.id, periodId, plannedDays, actorId, now, note, old.carriedFromPeriodId ?? null);
  }

  /** 同一来源的实际写入时刻用于审计；自动操作以空操作者明确标识。 */
  private async arrangementEvent(taskId: string, periodId: string, plannedDays: number | null, actorId: string | null, now: string, workNote: string, carriedFromPeriodId: string | null): Promise<void> {
    await this.manager.query('INSERT INTO v2_arrangement_history(id,task_id,period_id,actor_id,planned_days,work_note,carried_from_period_id,provenance,valid_from) VALUES (?,?,?,?,?,?,?,?,?)', [randomUUID(), taskId, periodId, actorId, plannedDays, workNote, carriedFromPeriodId, actorId === null ? 'carried' : 'scheduled', dbTime(now)]);
  }
}
