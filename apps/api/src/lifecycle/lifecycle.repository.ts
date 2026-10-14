import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { lifecycleHistorySchema } from '@ntfs/contracts';

/** 生命周期SQL集中管理，调用方持有组织锁且已验证影响范围。 */
export class LifecycleRepository {
  constructor(private readonly manager: EntityManager) {}
  /** 独立事件记录使删除源对象后仍可查询操作原因与影响摘要。 */
  async history(team: string) {
    return lifecycleHistorySchema.parse(await this.manager.query("SELECT id,action,actor_id AS actorId,object_id AS objectId,JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.review.title')) AS title,JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.reason')) AS reason,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt FROM lifecycle_events WHERE team_id=? ORDER BY created_at DESC LIMIT 200", [team]));
  }
  /** 移出项目解除角色，保留原执行及主责记录供手动交接。 */
  async removeProjectMember(project: string, account: string) {
    await this.manager.query('DELETE FROM project_members WHERE project_id=? AND account_id=?', [project, account]);
    await this.manager.query('UPDATE projects SET version=version+1 WHERE id=?', [project]);
  }
  /** 当前时间被修正为空也不能抹去曾经执行的事实。 */
  async executed(task: string) {
    const rows: unknown = await this.manager.query("SELECT id FROM work_events WHERE (object_id=? OR JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.before.taskId'))=? OR JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.after.taskId'))=?) AND action IN ('task.start_task','task.complete_task','task.cancel_task','task.reopen_task','task.task_progress','task.task_times','assignment.start','assignment.complete','assignment.record_progress','assignment.correct_times','assignment.transfer','assignment.exit') LIMIT 1", [task, task, task]);
    if (z.array(z.object({ id: z.string() })).parse(rows).length) return true;
    // 本人删除关联事项后，执行历史仍限制团队任务删除，不能借删除来源抹去执行事实。
    const personalRows: unknown = await this.manager.query("SELECT e.id FROM personal_events e JOIN task_assignments a ON a.id=JSON_UNQUOTE(JSON_EXTRACT(e.payload_json,'$.before.assignmentId')) OR a.id=JSON_UNQUOTE(JSON_EXTRACT(e.payload_json,'$.after.assignmentId')) WHERE a.task_id=? AND e.action IN ('personal_progress','start_personal','complete_personal','personal_times') LIMIT 1", [task]);
    return z.array(z.object({ id: z.string() })).parse(personalRows).length > 0;
  }
  /** 任意历史发布引用均阻止任务删除，覆盖计划、本周及下周安排。 */
  async published(task: string) {
    const rows: unknown = await this.manager.query("SELECT id FROM weekly_publications WHERE JSON_SEARCH(payload_json,'one',?,NULL,'$.rows[*].taskId','$.next[*].taskId') IS NOT NULL LIMIT 1", [task]);
    return z.array(z.object({ id: z.string() })).parse(rows).length > 0;
  }
  /** 归档状态与目录版本同步更新。 */
  async archive(project: string, archived: boolean) { await this.manager.query('UPDATE projects SET archived=?,version=version+1 WHERE id=?', [archived, project]); }
  /** 移出只解除当前团队，原角色、负责人和分工保留供交接清单追溯。 */
  async removeMember(account: string) { await this.manager.query('UPDATE accounts SET team_id=NULL,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?', [account]); }
  /** 转移不改本人内容及执行时间，递增版本使旧页面不能覆盖归属。 */
  async moveTask(task: string, project: string) {
    await this.manager.query('UPDATE team_tasks SET project_id=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?', [project, task]);
    await this.manager.query('UPDATE personal_items i JOIN task_assignments a ON a.id=i.assignment_id SET i.project_id=?,i.version=i.version+1,i.updated_at=UTC_TIMESTAMP(3) WHERE a.task_id=?', [project, task]);
  }
  /** 独立个人工作迁移用于归档前整理，不能迁移私人事项或拆散关联。 */
  async movePersonal(id: string, project: string) { await this.manager.query('UPDATE personal_items SET project_id=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?', [project, id]); }
  /** 新项目参与人只补研发角色，不覆盖已有项目角色。 */
  async joinProject(project: string, account: string) {
    await this.manager.query("INSERT IGNORE INTO project_members (project_id,account_id,roles_json) VALUES (?,?,'[\"developer\"]')", [project, account]);
    await this.manager.query('UPDATE projects SET version=version+1 WHERE id=?', [project]);
  }
  /** 执行前已确认无子任务、个人关联、执行事实及发布引用。 */
  async deleteTask(task: string) {
    await this.manager.query('DELETE w FROM weekly_arrangements w JOIN task_assignments a ON a.id=w.assignment_id WHERE a.task_id=?', [task]);
    await this.manager.query('DELETE FROM weekly_pending WHERE task_id=?', [task]);
    await this.manager.query('UPDATE team_tasks SET waiting_task_id=NULL,version=version+1 WHERE waiting_task_id=?', [task]);
    await this.manager.query('UPDATE task_assignments SET waiting_task_id=NULL,version=version+1 WHERE waiting_task_id=?', [task]);
    await this.manager.query('DELETE FROM task_assignments WHERE task_id=?', [task]);
    await this.manager.query("DELETE FROM work_tags WHERE object_kind='task' AND object_id=?", [task]);
    await this.manager.query('DELETE FROM team_tasks WHERE id=?', [task]);
  }
  /** 删除本人事项不修改关联分工状态，历史及发布文字独立保留。 */
  async deletePersonal(id: string) {
    await this.manager.query('DELETE FROM personal_progress WHERE item_id=?', [id]);
    await this.manager.query("DELETE FROM work_tags WHERE object_kind='personal' AND object_id=?", [id]);
    await this.manager.query('DELETE FROM personal_items WHERE id=?', [id]);
  }
  /** 生命周期历史按原团队隔离；不会把私人事项写入团队事件。 */
  async event(team: string, actor: string, object: string, action: string, payload: unknown) {
    await this.manager.query('INSERT INTO lifecycle_events (id,team_id,actor_id,object_id,action,payload_json,created_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), team, actor, object, action, JSON.stringify(payload)]);
  }
}
