import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { weeklyArrangementSchema } from '@ntfs/contracts';
import type { WeeklyArrangement } from '@ntfs/contracts';

/** 周计划持久化集中入口，调用方须已取得组织事务锁并校验权限。 */
export class WeeklyPlansRepository {
  constructor(private readonly manager: EntityManager) {}
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
