import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { weeklyArrangementSchema } from '@ntfs/contracts';
import type { WeeklyArrangement } from '@ntfs/contracts';

/** 周计划持久化集中入口，调用方须已取得组织事务锁并校验权限。 */
export class WeeklyPlansRepository {
  constructor(private readonly manager: EntityManager) {}
  /** 主动移出形成阻断点，避免刷新或跨周自动重新加入。 */
  async exclude(draft: string, object: string, kind: 'assignment' | 'task') {
    await this.manager.query('INSERT IGNORE INTO weekly_carry_exclusions (draft_id,object_id,object_kind) VALUES (?,?,?)', [draft, object, kind]);
  }
  /** 人工重新安排解除当前周阻断，后续周从新的安排继续延续。 */
  async include(draft: string, object: string, kind: 'assignment' | 'task') {
    await this.manager.query('DELETE FROM weekly_carry_exclusions WHERE draft_id=? AND object_id=? AND object_kind=?', [draft, object, kind]);
  }
  /** 读取目标周之前的有效来源；中间缺周无需创建历史草稿，主动移出优先。 */
  async carrySources(team: string, week: string, kind: 'assignment' | 'task') {
    const table = kind === 'assignment' ? 'weekly_arrangements' : 'weekly_pending';
    const column = kind === 'assignment' ? 'assignment_id' : 'task_id';
    const rows: unknown = await this.manager.query(`
      SELECT a.${column} AS objectId,DATE_FORMAT(MAX(d.week),'%Y-%m-%d') AS sourceWeek
      FROM ${table} a JOIN weekly_drafts d ON d.id=a.draft_id
      WHERE d.team_id=? AND d.week<? AND NOT EXISTS (
        SELECT 1 FROM weekly_carry_exclusions e JOIN weekly_drafts x ON x.id=e.draft_id
        WHERE x.team_id=d.team_id AND x.week>=d.week AND x.week<=? AND e.object_id=a.${column} AND e.object_kind=?
      ) GROUP BY a.${column}`, [team, week, week, kind]);
    return z.array(z.object({ objectId: z.string(), sourceWeek: z.string() })).parse(rows);
  }
  /** 父任务拆分后草稿待分配项展开到子任务，正式发布副本保持不变。 */
  async splitPending(parent: string, children: string[]) {
    const rows: unknown = await this.manager.query('SELECT id,draft_id AS draftId FROM weekly_pending WHERE task_id=?', [parent]);
    for (const row of z.array(z.object({ id: z.string(), draftId: z.string() })).parse(rows)) {
      await this.remove(row.draftId, row.id, true);
      for (const child of children) await this.addPending(row.draftId, child);
    }
  }
  /** 待分配项与人员安排分开，不能伪造执行人。 */
  async pending(draft: string) { return z.array(z.object({ id: z.string(), taskId: z.string(), version: z.number(), sourceWeek: z.string().nullable() })).parse(await this.manager.query("SELECT id,task_id AS taskId,version,DATE_FORMAT(source_week,'%Y-%m-%d') AS sourceWeek FROM weekly_pending WHERE draft_id=?", [draft])); }
  /** 添加待分配事项，重复加入返回原条目。 */
  async addPending(draft: string, task: string, sourceWeek: string | null = null) {
    const previous = (await this.pending(draft)).find((entry) => entry.taskId === task); if (previous) return previous.id;
    const id = randomUUID(); await this.manager.query('INSERT INTO weekly_pending (id,draft_id,task_id,source_week) VALUES (?,?,?,?)', [id, draft, task, sourceWeek]); await this.touch(draft); return id;
  }
  /** 移出仅影响草稿，发布副本保持不变，操作历史由服务记录。 */
  async remove(draft: string, id: string, pending: boolean) { await this.manager.query(`DELETE FROM ${pending ? 'weekly_pending' : 'weekly_arrangements'} WHERE id=? AND draft_id=?`, [id, draft]); await this.touch(draft); }
  /** 草稿范围变化使发布确认失效。 */
  async touch(id: string) { await this.manager.query('UPDATE weekly_drafts SET version=version+1 WHERE id=?', [id]); }
  /** 查询共享草稿；只读请求不会创建数据。 */
  async draft(teamId: string, week: string) {
    const rows: unknown = await this.manager.query("SELECT id, team_id AS teamId, DATE_FORMAT(week, '%Y-%m-%d') AS week, version FROM weekly_drafts WHERE team_id = ? AND week = ?", [teamId, week]);
    return z.array(z.object({ id: z.string(), teamId: z.string(), week: z.string(), version: z.number() })).parse(rows)[0];
  }
  /** 并发初始化始终复用团队周次唯一记录。 */
  async ensure(teamId: string, week: string): Promise<string> {
    const existing = await this.draft(teamId, week);
    if (existing) return existing.id;
    const id = randomUUID();
    await this.manager.query('INSERT INTO weekly_drafts (id, team_id, week) VALUES (?, ?, ?)', [id, teamId, week]);
    return id;
  }
  /** 小数以字符串读取，保持十进制精度。 */
  async arrangements(draftId: string): Promise<WeeklyArrangement[]> {
    const rows: unknown = await this.manager.query("SELECT id, assignment_id AS assignmentId, goal, expected_progress AS expectedProgress, CAST(planned_days AS CHAR) AS plannedDays, DATE_FORMAT(source_week, '%Y-%m-%d') AS sourceWeek, version FROM weekly_arrangements WHERE draft_id = ? ORDER BY id", [draftId]);
    return z.array(weeklyArrangementSchema).parse(rows);
  }
  /** 保存安排只影响周目标和投入，不写分工内容或个人事实。 */
  async save(draftId: string, assignmentId: string, fields: { goal: string; expectedProgress: number | null; plannedDays: string | null }, previous?: WeeklyArrangement, sourceWeek: string | null = null): Promise<string> {
    const id = previous?.id ?? randomUUID();
    if (previous) await this.manager.query('UPDATE weekly_arrangements SET goal = ?, expected_progress = ?, planned_days = ?, version = version + 1 WHERE id = ?', [fields.goal, fields.expectedProgress, fields.plannedDays, id]);
    else await this.manager.query('INSERT INTO weekly_arrangements (id, draft_id, assignment_id, goal, expected_progress, planned_days, source_week) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, draftId, assignmentId, fields.goal, fields.expectedProgress, fields.plannedDays, sourceWeek]);
    await this.manager.query('UPDATE weekly_drafts SET version = version + 1 WHERE id = ?', [draftId]);
    return id;
  }
}
