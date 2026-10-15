import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { publicationSchema, reportEntrySchema, tagSchema } from '@ntfs/contracts';
import type { PublicationRow, ReportEntry, ReportSource, TagCommand } from '@ntfs/contracts';

/** 周业务JSON一律校验后使用，SQL仅在仓储内执行。 */
export class ReportingRepository {
  constructor(private readonly manager: EntityManager) {}
  /** 已发布的任务跨组及明确交付日期变化须由团队负责人确认。 */
  async publishedTask(team: string, task: string) {
    const rows: unknown = await this.manager.query("SELECT id FROM weekly_publications WHERE team_id=? AND kind='plan' AND JSON_SEARCH(payload_json,'one',?,NULL,'$.rows[*].taskId') IS NOT NULL LIMIT 1", [team, task]);
    return z.array(z.object({ id: z.string() })).parse(rows).length > 0;
  }
  /** 草稿旧来源按当前责任归属授权，不能凭历史小组继续编辑。 */
  async authority(source: ReportSource) {
    const schema = z.array(z.object({ teamId: z.string(), groupId: z.string().nullable(), ownerId: z.string().nullable(), taskId: z.string().nullable() }));
    let rows: unknown;
    if (source.sourceKind === 'personal') rows = await this.manager.query("SELECT p.team_id AS teamId,a.group_id AS groupId,i.owner_id AS ownerId,a.task_id AS taskId FROM personal_progress r JOIN personal_items i ON i.id=r.item_id JOIN projects p ON p.id=i.project_id LEFT JOIN task_assignments a ON a.id=i.assignment_id WHERE r.id=? AND i.kind='work'", [source.sourceId]);
    else if (source.sourceKind === 'assignment') rows = await this.manager.query('SELECT p.team_id AS teamId,a.group_id AS groupId,a.account_id AS ownerId,a.task_id AS taskId FROM assignment_progress r JOIN task_assignments a ON a.id=r.assignment_id JOIN team_tasks t ON t.id=a.task_id JOIN projects p ON p.id=t.project_id WHERE r.id=?', [source.sourceId]);
    else if (source.accountId) rows = await this.manager.query('SELECT p.team_id AS teamId,a.group_id AS groupId,a.account_id AS ownerId,a.task_id AS taskId FROM task_assignments a JOIN team_tasks t ON t.id=a.task_id JOIN projects p ON p.id=t.project_id WHERE a.id=?', [source.sourceId]);
    else rows = await this.manager.query('SELECT p.team_id AS teamId,NULL AS groupId,NULL AS ownerId,t.id AS taskId FROM team_tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?', [source.taskId]);
    return schema.parse(rows)[0];
  }
  /** 读取发布副本，后续不提供更新或覆盖接口。 */
  async publications(team: string, week: string, kind: 'plan' | 'report') {
    const rows: unknown = await this.manager.query('SELECT payload_json FROM weekly_publications WHERE team_id=? AND week=? AND kind=? ORDER BY revision DESC', [team, week, kind]);
    return z.array(z.object({ payload_json: z.unknown() })).parse(rows).map((row) => publicationSchema.parse(decode(row.payload_json)));
  }
  /** 发布序号在共用组织事务锁下递增。 */
  async publish(team: string, week: string, kind: 'plan' | 'report', rows: PublicationRow[], next: PublicationRow[], reason: string, confirmation: string) {
    const versions = await this.publications(team, week, kind);
    const previous = versions.find((entry) => entry.confirmation === confirmation);
    if (previous) return previous.id;
    const value = { id: randomUUID(), kind, confirmation, revision: (versions[0]?.revision ?? 0) + 1, createdAt: new Date().toISOString(), reason, rows, next };
    await this.manager.query('INSERT INTO weekly_publications (id,team_id,week,kind,revision,payload_json,created_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3))', [value.id, team, week, kind, value.revision, JSON.stringify(value)]);
    return value.id;
  }
  /** 草稿保留全部来源，按权限裁剪在业务层完成。 */
  async report(team: string, week: string) {
    const rows: unknown = await this.manager.query('SELECT id,version,entries_json FROM report_drafts WHERE team_id=? AND week=?', [team, week]);
    const row = z.array(z.object({ id: z.string(), version: z.number(), entries_json: z.unknown() })).parse(rows)[0];
    return row ? { id: row.id, version: row.version, entries: z.array(reportEntrySchema).parse(decode(row.entries_json)) } : null;
  }
  /** 保存整个共享草稿由外层版本及组织锁串行保护。 */
  async saveReport(team: string, week: string, entries: ReportEntry[]) {
    const current = await this.report(team, week); const id = current?.id ?? randomUUID();
    if (current) await this.manager.query('UPDATE report_drafts SET entries_json=?,version=version+1 WHERE id=?', [JSON.stringify(entries), id]);
    else await this.manager.query('INSERT INTO report_drafts (id,team_id,week,entries_json) VALUES (?,?,?,?)', [id, team, week, JSON.stringify(entries)]);
    return id;
  }
  /** 人工标签只读原值，不基于日期计算。 */
  async tags(object: string, kind: 'task' | 'personal') {
    const rows: unknown = await this.manager.query('SELECT id,object_id AS objectId,object_kind AS objectKind,dimension,week_key AS week,marked,version FROM work_tags WHERE object_id=? AND object_kind=?', [object, kind]);
    return z.array(tagSchema.extend({ marked: z.union([z.number(), z.boolean()]).transform(Boolean) })).parse(rows);
  }
  /** 标签清除保留记录及版本，不删除历史。 */
  async tag(command: TagCommand, previousId?: string) {
    const id = previousId ?? randomUUID();
    if (previousId) await this.manager.query('UPDATE work_tags SET marked=?,version=version+1 WHERE id=?', [command.marked, id]);
    else await this.manager.query('INSERT INTO work_tags (id,object_id,object_kind,dimension,week_key,marked) VALUES (?,?,?,?,?,?)', [id, command.objectId, command.objectKind, command.dimension, command.week ?? '', command.marked]);
    return id;
  }
  /** 记录精确前后快照，仅业务服务可写入。 */
  async event(team: string, actor: string, action: string, payload: unknown) {
    await this.manager.query('INSERT INTO weekly_events (id,team_id,actor_id,action,payload_json,created_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), team, actor, action, JSON.stringify(payload)]);
  }
  /** 管理归属周只修改归属，不改实际日期及内容。 */
  async reassign(kind: 'personal' | 'assignment', id: string, week: string) {
    const table = kind === 'personal' ? 'personal_progress' : 'assignment_progress';
    await this.manager.query(`UPDATE ${table} SET report_week=? WHERE id=?`, [week, id]);
    if (kind === 'personal') await this.manager.query('UPDATE personal_items i JOIN personal_progress p ON p.item_id=i.id SET i.version=i.version+1 WHERE p.id=?', [id]);
    else await this.manager.query('UPDATE task_assignments a JOIN assignment_progress p ON p.assignment_id=a.id SET a.version=a.version+1 WHERE p.id=?', [id]);
  }
}
/** MySQL5.7驱动可能返回字符串或已解码JSON。 */
function decode(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : value; }
