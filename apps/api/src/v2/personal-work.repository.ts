import { z } from 'zod';
import type { EntityManager } from 'typeorm';
import { v2PersonalPreferencesSchema, v2SubtasksSchema, v2SubtaskSchema, type V2PersonalPreferences, type V2Subtasks } from '@ntfs/contracts';
import { dbTime, decodeJson } from './repository-utils.js';
import type { V2ReportText } from './shared-report.js';
import { V2TaskRepository } from './task.repository.js';

export const subtaskSnapshotSchema = z.object({ taskId: z.string().uuid(), taskTitle: z.string(), projectId: z.string().uuid().nullable(), projectName: z.string(), items: z.array(v2SubtaskSchema), version: z.number().int().nonnegative() });
export type SubtaskSnapshot = z.infer<typeof subtaskSnapshotSchema>;

/** 私人数据所有查询显式绑定账号；调用方须先建立身份及组织事务。 */
export class PersonalWorkRepository {
  constructor(private readonly manager: EntityManager) {}

  /** 未保存偏好的账号默认按天，并跟随共享项目顺序。 */
  async preferences(ownerId: string): Promise<V2PersonalPreferences> {
    const rows = z.array(z.object({ completedMode: z.string(), projectOrder: z.unknown(), version: z.number() })).parse(await this.manager.query('SELECT completed_mode AS completedMode,project_order_json AS projectOrder,version FROM v2_personal_preferences WHERE owner_id=?', [ownerId]));
    const row = rows[0];
    return row ? v2PersonalPreferencesSchema.parse({ ...row, projectOrder: decodeJson(row.projectOrder) }) : { completedMode: 'day', projectOrder: null, version: 0 };
  }

  /** 调用方核对版本后整体保存，查看模式与个人项目顺序互不重置。 */
  async savePreferences(ownerId: string, value: V2PersonalPreferences): Promise<void> {
    await this.manager.query('INSERT INTO v2_personal_preferences(owner_id,completed_mode,project_order_json,version) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE completed_mode=VALUES(completed_mode),project_order_json=VALUES(project_order_json),version=VALUES(version)', [ownerId, value.completedMode, value.projectOrder === null ? null : JSON.stringify(value.projectOrder), value.version]);
  }

  /** 清单版本独立于主任务；新执行人只能读到自己的空清单。 */
  async subtasks(ownerId: string, taskId: string): Promise<V2Subtasks> {
    const rows = z.array(z.object({ version: z.number(), items: z.unknown() })).parse(await this.manager.query('SELECT version,items_json AS items FROM v2_personal_subtasks WHERE owner_id=? AND task_id=?', [ownerId, taskId]));
    const row = rows[0];
    return v2SubtasksSchema.parse({ taskId, version: row?.version ?? 0, items: row ? decodeJson(row.items) : [] });
  }

  /** 当前清单及历史快照同事务写入，删除仅从当前清单移除，不清理历史。 */
  async saveSubtasks(ownerId: string, snapshot: SubtaskSnapshot, now: string): Promise<void> {
    await this.manager.query('INSERT INTO v2_personal_subtasks(owner_id,task_id,version,items_json,updated_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE version=VALUES(version),items_json=VALUES(items_json),updated_at=VALUES(updated_at)', [ownerId, snapshot.taskId, snapshot.version, JSON.stringify(snapshot.items), dbTime(now)]);
    await this.manager.query('INSERT INTO v2_personal_subtask_events(owner_id,task_id,sequence,snapshot_json,occurred_at) VALUES (?,?,?,?,?)', [ownerId, snapshot.taskId, snapshot.version, JSON.stringify(snapshot), dbTime(now)]);
  }

  /** 只取本人各清单在所选日末的最后快照，之后的删除、改名及改派不回写。 */
  async subtaskHistory(ownerId: string, endExclusive: string): Promise<SubtaskSnapshot[]> {
    const rows = z.array(z.object({ snapshot: z.unknown() })).parse(await this.manager.query(`SELECT e.snapshot_json AS snapshot FROM v2_personal_subtask_events e WHERE e.owner_id=? AND e.occurred_at<? AND NOT EXISTS (SELECT 1 FROM v2_personal_subtask_events n WHERE n.owner_id=e.owner_id AND n.task_id=e.task_id AND n.sequence>e.sequence AND n.occurred_at<?)`, [ownerId, dbTime(endExclusive), dbTime(endExclusive)]));
    return rows.map((row) => subtaskSnapshotSchema.parse(decodeJson(row.snapshot)));
  }

  /** 仅定位曾由本人执行且在当天完成的任务，再用历史状态核实，兼容旧快照封装。 */
  async completedTaskHistory(ownerId: string, start: string, endExclusive: string, additionalIds: string[] = []) {
    const rows = z.array(z.object({ id: z.string() })).parse(await this.manager.query(`SELECT DISTINCT task_id AS id FROM v2_task_events WHERE occurred_at<? AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(snapshot_json,'$.task.executorId')),JSON_UNQUOTE(JSON_EXTRACT(snapshot_json,'$.executorId')))=? AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(snapshot_json,'$.task.completedAt')),JSON_UNQUOTE(JSON_EXTRACT(snapshot_json,'$.completedAt')))>=? AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(snapshot_json,'$.task.completedAt')),JSON_UNQUOTE(JSON_EXTRACT(snapshot_json,'$.completedAt')))<?`, [dbTime(endExclusive), ownerId, start, endExclusive]));
    return (await new V2TaskRepository(this.manager).history([...new Set([...rows.map((row) => row.id), ...additionalIds])])).filter((event) => event.snapshot.executorId === ownerId && event.occurredAt < endExclusive);
  }

  /** 账号及日期共同定位文字，不存在跨账号共享稿。 */
  async report(ownerId: string, on: string): Promise<V2ReportText | null> {
    const rows = z.array(z.object({ body: z.string(), manual: z.coerce.boolean(), sourceHash: z.string(), version: z.number() })).parse(await this.manager.query('SELECT body,manual,source_hash AS sourceHash,version FROM v2_daily_reports WHERE owner_id=? AND report_on=?', [ownerId, on]));
    return rows[0] ?? null;
  }

  /** 文字写入与来源核验在同一个组织事务下完成。 */
  async saveReport(ownerId: string, on: string, report: V2ReportText): Promise<void> {
    await this.manager.query('INSERT INTO v2_daily_reports(owner_id,report_on,body,manual,source_hash,version) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE body=VALUES(body),manual=VALUES(manual),source_hash=VALUES(source_hash),version=VALUES(version)', [ownerId, on, report.body, Number(report.manual), report.sourceHash, report.version]);
  }
}
