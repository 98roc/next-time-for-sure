import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { v2BacklogSchema, v2MilestoneSchema, type V2Backlog, type V2Milestone } from '@ntfs/contracts';
import { instantColumn } from './repository-utils.js';

const milestoneSelect = "SELECT id,project_id AS projectId,owner_id AS ownerId,title,DATE_FORMAT(expected_on,'%Y-%m-%d') AS expectedOn,status,needs_review AS needsReview,version FROM v2_milestones";
const backlogSelect = `SELECT id,project_id AS projectId,creator_id AS creatorId,title,priority,version,converted_task_id AS convertedTaskId,${instantColumn('deleted_at', 'deletedAt')} FROM v2_backlog`;
const milestones = z.array(v2MilestoneSchema.extend({ needsReview: z.union([z.boolean(), z.number()]).transform(Boolean) }));

/** 待建和里程碑的持久化层，不复制任务或跨入口状态。 */
export class V2ProjectRepository {
  constructor(private readonly manager: EntityManager) {}

  /** 项目列表已经过当前权限裁剪，查询不扩散到其他项目。 */
  async milestones(projectIds: string[]): Promise<V2Milestone[]> { return projectIds.length ? milestones.parse(await this.manager.query(`${milestoneSelect} WHERE deleted_at IS NULL AND project_id IN (${projectIds.map(() => '?').join(',')}) ORDER BY expected_on,id`, projectIds)) : []; }
  /** 目标读取后由服务检查项目权限及版本。 */
  async milestone(id: string): Promise<V2Milestone | undefined> { return milestones.parse(await this.manager.query(`${milestoneSelect} WHERE id=? AND deleted_at IS NULL`, [id]))[0]; }
  /** 转换后记录保留用于幂等，但不再出现在待建列表。 */
  async backlog(projectIds: string[]): Promise<V2Backlog[]> { return projectIds.length ? z.array(v2BacklogSchema).parse(await this.manager.query(`${backlogSelect} WHERE deleted_at IS NULL AND converted_task_id IS NULL AND project_id IN (${projectIds.map(() => '?').join(',')}) ORDER BY priority,created_at,id`, projectIds)) : []; }
  /** 删除记录不对外暴露，但同一次删除幂等仍可核对来源。 */
  async backlogItem(id: string): Promise<V2Backlog | undefined> { return z.array(v2BacklogSchema).parse(await this.manager.query(`${backlogSelect} WHERE id=?`, [id]))[0]; }
  /** 新增待建只有名称与优先级，创建人来自当前身份。 */
  async createBacklog(row: V2Backlog): Promise<void> { await this.manager.query('INSERT INTO v2_backlog(id,project_id,creator_id,title,priority,created_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))', [row.id, row.projectId, row.creatorId, row.title, row.priority]); }
  /** 修改不会改变创建人或生成审批状态。 */
  async editBacklog(id: string, title: string, priority: number): Promise<void> { await this.manager.query('UPDATE v2_backlog SET title=?,priority=?,version=version+1 WHERE id=?', [title, priority, id]); }
  /** 删除保留必要来源关系与版本。 */
  async deleteBacklog(id: string): Promise<void> { await this.manager.query('UPDATE v2_backlog SET deleted_at=UTC_TIMESTAMP(3),version=version+1 WHERE id=?', [id]); }
  /** 转换由上层同事务创建任务并记实际转换人。 */
  async convertBacklog(id: string, taskId: string, actorId: string): Promise<void> { await this.manager.query('UPDATE v2_backlog SET converted_task_id=?,converted_by=?,version=version+1 WHERE id=?', [taskId, actorId, id]); }
  /** 里程碑归属只用于移出检查，完成权限不绑定该字段。 */
  async saveMilestone(row: V2Milestone, create: boolean, actorId: string): Promise<void> {
    const previous = create ? null : await this.milestone(row.id);
    if (create) await this.manager.query('INSERT INTO v2_milestones(id,project_id,owner_id,title,expected_on,status,needs_review,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))', [row.id, row.projectId, row.ownerId, row.title, row.expectedOn, row.status, Number(row.needsReview), row.version]);
    else await this.manager.query('UPDATE v2_milestones SET owner_id=?,title=?,expected_on=?,status=?,needs_review=?,version=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?', [row.ownerId, row.title, row.expectedOn, row.status, Number(row.needsReview), row.version, row.id]);
    await this.manager.query("INSERT INTO v2_object_events(id,team_id,project_id,object_id,actor_id,action,payload_json,occurred_at) SELECT ?,team_id,id,?,?,'milestone.saved',?,UTC_TIMESTAMP(3) FROM projects WHERE id=?", [randomUUID(), row.id, actorId, JSON.stringify({ before: previous, after: row }), row.projectId]);
  }
}
