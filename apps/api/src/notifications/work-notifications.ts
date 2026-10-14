import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { NotificationRepository } from './notification.repository.js';

/** 从既有业务事件解析稳定对象标识，不把任意载荷正文放入通知。 */
export async function notifyWork(manager: EntityManager, event: string, project: string, object: string, action: string, payload: unknown) {
  const scopeRows: unknown = await manager.query('SELECT team_id AS teamId FROM projects WHERE id=?', [project]);
  const scope = z.array(z.object({ teamId: z.string() })).parse(scopeRows)[0]; if (!scope) return;
  const data = z.object({ resultId: z.string().optional(), ownerId: z.string().optional(), after: z.object({ taskId: z.string().optional(), accountId: z.string().optional(), ownerId: z.string().optional(), groupId: z.string().optional() }).passthrough().nullable().optional(), before: z.object({ accountId: z.string().optional(), ownerId: z.string().optional(), groupId: z.string().optional() }).passthrough().nullable().optional() }).passthrough().parse(payload);
  const taskId = data.after?.taskId ?? object;
  const taskRows: unknown = await manager.query('SELECT owner_id AS ownerId FROM team_tasks WHERE id=?', [taskId]);
  const task = z.array(z.object({ ownerId: z.string() })).parse(taskRows)[0];
  const notifications = new NotificationRepository(manager); let recipients: string[] = []; let title = '';
  if (['submit_request', 'resubmit_request', 'supplement_request'].includes(action)) {
    const rows: unknown = await manager.query("SELECT account_id AS id FROM project_members WHERE project_id=? AND JSON_CONTAINS(roles_json,'\"project_lead\"') UNION SELECT leader_id AS id FROM teams WHERE id=?", [project, scope.teamId]);
    recipients = z.array(z.object({ id: z.string() })).parse(rows).map((row) => row.id); title = '项目需求有新的待处理内容';
  } else if (['review_request', 'accept_request'].includes(action)) {
    const rows: unknown = await manager.query('SELECT submitter_id AS id FROM work_requests WHERE id=?', [object]);
    recipients = z.array(z.object({ id: z.string() })).parse(rows).map((row) => row.id); title = '你提交的需求有新的处理结果';
  } else if (action === 'task.from_request') { recipients = data.ownerId ? [data.ownerId] : []; title = '已接收的需求由你负责，请核对任务'; }
  else if (['assignment.assign', 'assignment.transfer', 'assignment.adjust'].includes(action)) { recipients = [data.after?.accountId, data.before?.accountId].filter((id): id is string => Boolean(id)); title = '你的人员安排发生变化'; }
  else if (action === 'task.change_owner') { recipients = [data.before?.ownerId, data.after?.ownerId].filter((id): id is string => Boolean(id)); title = '团队任务主负责人发生变化'; }
  else if (['assignment.complete', 'assignment.assignment_blocker', 'task.task_blocker'].includes(action) && task) { recipients = [task.ownerId]; title = action.includes('blocker') ? '任务协作阻塞发生变化，请核对' : '参与人已确认完成本人分工'; }
  else if (['assignment.claim', 'assignment.exit'].includes(action)) {
    const rows: unknown = await manager.query('SELECT leader_id AS id FROM work_groups WHERE id=?', [data.after?.groupId ?? data.before?.groupId]); recipients = z.array(z.object({ id: z.string() })).parse(rows).map((row) => row.id); title = '本组成员认领或退出了执行分工';
  } else if (action === 'personal.link_managed') { recipients = data.ownerId ? [data.ownerId] : []; title = '管理者调整了你的个人工作关联'; }
  else if (action === 'assignment.restored_by_personal') { recipients = data.after?.accountId ? [data.after.accountId] : []; title = '新增或恢复的个人工作使本人分工恢复未完成'; }
  else if (['task.complete_task', 'task.cancel_task', 'task.ended_by_parent', 'milestone.reschedule_node', 'milestone.remove_node'].includes(action) || action === 'milestone.add_node' && data.after?.expectedOn) {
    const rows: unknown = await manager.query("SELECT account_id AS id FROM task_assignments WHERE task_id=? AND status NOT IN ('exited','transferred')", [object]); recipients = z.array(z.object({ id: z.string() })).parse(rows).map((row) => row.id); title = action.startsWith('milestone.') ? '任务排期发生重要变化' : '关联团队工作已整体结束或取消';
    if (task) recipients.push(task.ownerId);
    if (action === 'task.complete_task' || action === 'task.ended_by_parent' && data.after?.status === 'completed') {
      const dependents: unknown = await manager.query('SELECT owner_id AS id FROM team_tasks WHERE waiting_task_id=? UNION SELECT account_id AS id FROM task_assignments WHERE waiting_task_id=?', [object, object]);
      await notifications.enqueue(scope.teamId, project, z.array(z.object({ id: z.string() })).parse(dependents).map((row) => row.id), '等待的关联工作已结束，请人工确认是否解除阻塞', object, `/work?projectId=${project}`);
    }
  }
  if (title) await notifications.enqueue(scope.teamId, project, recipients, title, object, `/work?projectId=${project}`, event);
}
