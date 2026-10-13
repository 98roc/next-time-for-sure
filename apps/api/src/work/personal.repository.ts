import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { personalItemSchema, personalCategorySchema, personalProgressSchema, workEventSchema } from '@ntfs/contracts';
import type { PersonalCommand, PersonalItem } from '@ntfs/contracts';

const selection = `SELECT i.id, i.owner_id AS ownerId, i.kind, i.project_id AS projectId, i.assignment_id AS assignmentId, i.title, i.description, i.acceptance, i.status, i.checklist_json, i.category_id AS categoryId, i.position, DATE_FORMAT(i.planned_on, '%Y-%m-%d') AS plannedOn, i.blocked_reason AS blockedReason, i.version, DATE_FORMAT(i.started_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS startedAt, DATE_FORMAT(i.ended_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS endedAt FROM personal_items i`;

/** 个人内容访问集中于仓储，私人数据不进入团队事件表。 */
export class PersonalRepository {
  constructor(private readonly manager: EntityManager) {}

  /** 数据库先排除他人的私人事项，工作事项再由服务按角色裁剪。 */
  async candidates(owner: string, team: string | null): Promise<PersonalItem[]> {
    return decodeItems(await this.manager.query(`${selection} LEFT JOIN projects p ON p.id = i.project_id WHERE i.owner_id = ? OR (i.kind = 'work' AND p.team_id = ?) ORDER BY i.position, i.created_at`, [owner, team]));
  }
  /** 锁定单条事项用于本人编辑及版本检查。 */
  async item(id: string): Promise<PersonalItem | undefined> { return decodeItems(await this.manager.query(`${selection} WHERE i.id = ? FOR UPDATE`, [id]))[0]; }
  /** 分类只返回本人内容，避免分类名称泄露私人安排。 */
  async categories(owner: string) { return z.array(personalCategorySchema).parse(await this.manager.query('SELECT id, owner_id AS ownerId, name, version FROM personal_categories WHERE owner_id = ? ORDER BY name', [owner])); }
  /** 仅读取已通过服务授权的事项进展。 */
  async progressFor(ids: string[]) {
    if (!ids.length) return [];
    return z.array(personalProgressSchema).parse(await this.manager.query(`SELECT id, item_id AS itemId, DATE_FORMAT(occurred_on, '%Y-%m-%d') AS occurredOn, DATE_FORMAT(report_week, '%Y-%m-%d') AS reportWeek, content, DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt FROM personal_progress WHERE item_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at`, ids));
  }
  /** 新任务不复制团队任务内容，保留本人独立标题与排序。 */
  async create(owner: string, command: Extract<PersonalCommand, { action: 'create_personal' }>): Promise<string> {
    const id = randomUUID();
    await this.manager.query("INSERT INTO personal_items (id, owner_id, kind, project_id, assignment_id, title, description, acceptance, checklist_json, category_id, blocked_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, '', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [id, owner, command.kind, command.projectId, command.assignmentId, command.title, command.description, command.acceptance, command.categoryId]);
    return id;
  }
  /** 修改本人内容及一层清单，不产生团队状态联动。 */
  async edit(command: Extract<PersonalCommand, { action: 'edit_personal' }>): Promise<void> {
    await this.manager.query('UPDATE personal_items SET title = ?, description = ?, acceptance = ?, checklist_json = ?, planned_on = ?, blocked_reason = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [command.title, command.description, command.acceptance, JSON.stringify(command.checklist), command.plannedOn, command.blockedReason, command.itemId]);
  }
  /** 关联归属独立于本人执行时间及状态。 */
  async link(id: string, assignment: string | null): Promise<void> { await this.manager.query('UPDATE personal_items SET assignment_id = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [assignment, id]); }
  /** 本人开始保留首次时间，完成只记录本人结束，不自动完成分工。 */
  async transition(id: string, status: 'in_progress' | 'completed'): Promise<void> {
    const times = status === 'in_progress' ? 'started_at = COALESCE(started_at, UTC_TIMESTAMP(3)), ended_at = NULL' : 'ended_at = UTC_TIMESTAMP(3)';
    await this.manager.query(`UPDATE personal_items SET status = ?, ${times}, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [status, id]);
  }
  /** 分类移动不修改执行状态。 */
  async move(id: string, category: string | null, position: number): Promise<void> { await this.manager.query('UPDATE personal_items SET category_id = ?, position = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [category, position, id]); }
  /** 本人修正实际时间，不传播到关联分工或团队任务。 */
  async times(id: string, started: string | null, ended: string | null): Promise<void> { await this.manager.query('UPDATE personal_items SET started_at = ?, ended_at = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [started ? new Date(started) : null, ended ? new Date(ended) : null, id]); }
  /** 逐条记录来源事项与归属周，避免仅保留最新进展。 */
  async addProgress(command: Extract<PersonalCommand, { action: 'personal_progress' }>): Promise<string> {
    const id = randomUUID();
    await this.manager.query('INSERT INTO personal_progress (id, item_id, occurred_on, report_week, content, created_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))', [id, command.itemId, command.occurredOn, command.reportWeek, command.content]);
    await this.manager.query('UPDATE personal_items SET version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [command.itemId]);
    return id;
  }
  /** 创建本人的独立分类。 */
  async createCategory(owner: string, name: string): Promise<string> { const id = randomUUID(); await this.manager.query('INSERT INTO personal_categories (id, owner_id, name) VALUES (?, ?, ?)', [id, owner, name]); return id; }
  /** 分类改名使用服务校验的版本。 */
  async renameCategory(id: string, name: string): Promise<void> { await this.manager.query('UPDATE personal_categories SET name = ?, version = version + 1 WHERE id = ?', [name, id]); }
  /** 删除分类只将原事项移至未分类，不删除事项或改变状态。 */
  async deleteCategory(id: string): Promise<void> {
    await this.manager.query('UPDATE personal_items SET category_id = NULL, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE category_id = ?', [id]);
    await this.manager.query('DELETE FROM personal_categories WHERE id = ?', [id]);
  }
  /** 保存个人操作的精确前后快照，私人内容不写团队事件。 */
  async event(owner: string, object: string, action: string, payload: unknown): Promise<void> { await this.manager.query('INSERT INTO personal_events (id, owner_id, object_id, action, payload_json, created_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))', [randomUUID(), owner, object, action, JSON.stringify(payload)]); }
  /** 历史只由本人入口读取，保留完成与恢复的事实。 */
  async history(owner: string, object: string) {
    const rows: unknown = await this.manager.query("SELECT id, owner_id AS actorId, object_id AS objectId, action, payload_json, DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt FROM personal_events WHERE owner_id = ? AND object_id = ? ORDER BY created_at", [owner, object]);
    return z.array(z.object({ payload_json: z.unknown() }).passthrough()).parse(rows).map(({ payload_json, ...row }) => workEventSchema.parse({ ...row, payload: typeof payload_json === 'string' ? JSON.parse(payload_json) : payload_json }));
  }
  /** 完成本人分工前列出仍未完成的关联工作，确认绑定每项当前版本。 */
  async unfinished(assignment: string) { return decodeItems(await this.manager.query(`${selection} WHERE i.assignment_id = ? AND i.status <> 'completed' ORDER BY i.id`, [assignment])); }
}

/** JSON列统一解码后再验证，不能把数据库驱动返回值直接断言成业务对象。 */
function decodeItems(rows: unknown): PersonalItem[] {
  return z.array(z.object({ checklist_json: z.unknown() }).passthrough()).parse(rows).map(({ checklist_json, ...row }) => personalItemSchema.parse({ ...row, checklist: typeof checklist_json === 'string' ? JSON.parse(checklist_json) : checklist_json }));
}
