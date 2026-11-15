import { createHash, randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { v2MessageItemSchema, v2TaskReminderReason, type V2MessageItem, type V2Task } from '@ntfs/contracts';
import type { V2Context } from './context.js';
import { decodeJson, instantColumn } from './repository-utils.js';
import { V2PlanningRepository } from './planning.repository.js';
import { V2PlanningLabelsRepository } from './planning-labels.repository.js';
import { periodWindow } from './calendar.js';

const storedSchema = z.object({ id: z.coerce.string(), items: z.unknown(), createdAt: z.string() });
export const messageRetentionDays = 7;

/** 同一接收人的同次业务操作合并任务与原因，保留首次写入的事件快照。 */
async function saveTaskMessage(manager: EntityManager, accountId: string, operationId: string, item: V2MessageItem): Promise<void> {
  const existing = z.array(z.object({ items: z.unknown() })).parse(await manager.query('SELECT items_json AS items FROM v2_notifications WHERE account_id=? AND operation_id=?', [accountId, operationId]))[0];
  const items = existing ? z.array(v2MessageItemSchema).parse(decodeJson(existing.items)) : [];
  const previous = items.find((row) => row.taskId === item.taskId);
  if (previous) previous.reasons = [...new Set([...previous.reasons, ...item.reasons])];
  else items.push(item);
  await manager.query('INSERT INTO v2_notifications(operation_id,account_id,items_json,created_at) VALUES (?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE items_json=VALUES(items_json)', [operationId, accountId, JSON.stringify(items)]);
}

/** 在业务事务及幂等回调内生成消息；同次操作每个接收人只保留一条，任务原因合并。 */
export async function notifyTask(manager: EntityManager, context: V2Context, task: V2Task, event: 'created' | 'completed' | 'planning', planningPeriodIds: string[] = []): Promise<void> {
  if (task.kind !== 'project') return;
  const project = context.projects.find((row) => row.id === task.projectId);
  if (!project) return;
  let unplanned = false;
  if (event !== 'completed' && planningPeriodIds.length) {
    const planning = new V2PlanningRepository(manager);
    const periods = await planning.periods(task.teamId);
    const now = new Date().toISOString(), labels = new V2PlanningLabelsRepository(manager);
    for (const period of periods.filter((row) => planningPeriodIds.includes(row.id))) {
      const window = periodWindow(period);
      if (now >= window.start && now < window.endExclusive && await labels.claimNotification(task.id, period.id, now)) unplanned = true;
    }
  }
  const actorName = context.organization.accounts.find((row) => row.id === context.actor.id)?.displayName ?? '成员';
  const executorName = context.organization.accounts.find((row) => row.id === task.executorId)?.displayName ?? '成员';
  // 幂等键只在操作者内唯一；不同账号偶然使用相同客户端标识不能合并彼此消息。
  const operationId = createHash('sha256').update(`${context.actor.id}:${context.operationId ?? randomUUID()}`).digest('hex').slice(0, 32);
  for (const member of project.members) {
    if (member.accountId === context.actor.id || !context.organization.accounts.some((row) => row.id === member.accountId && !row.disabled)) continue;
    const reasons: string[] = [];
    if (event === 'created' && member.accountId === task.executorId) reasons.push(`${actorName}为你安排了任务`);
    if (member.roles.includes('project_lead')) {
      if (event === 'completed') reasons.push(context.actor.id === task.executorId ? `${actorName}完成了任务` : `${actorName}代${executorName}完成了任务`);
      if (unplanned) reasons.push(`${actorName}${event === 'created' ? '新增' : '标记'}了计划外任务`);
    }
    if (!reasons.length) continue;
    await saveTaskMessage(manager, member.accountId, operationId, {
      taskId: task.id, projectId: task.projectId, projectName: context.organization.projects.find((row) => row.id === task.projectId)?.name ?? '',
      title: task.title, executorName, reasons,
    });
  }
}

/** 定时提醒只有当前执行人一个接收人；发送器须在同一事务核验状态与访问权限。 */
export async function notifyTaskReminder(manager: EntityManager, task: V2Task, executorName: string, projectName: string, scheduledAt: number): Promise<void> {
  const operationId = createHash('sha256').update(`task-reminder:${task.id}:${scheduledAt}`).digest('hex').slice(0, 32);
  await saveTaskMessage(manager, task.executorId, operationId, {
    taskId: task.id, projectId: task.projectId, projectName, title: task.title, executorName, reasons: [v2TaskReminderReason],
  });
}

/** 每次查询重新鉴权并裁剪项目；游标以数据库序号为准，首连只建立基线不补弹。 */
export async function readMessages(manager: EntityManager, context: V2Context, page: number, after?: string) {
  await manager.query(`DELETE FROM v2_notifications WHERE created_at<=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ${messageRetentionDays} DAY)`);
  const rows = z.array(storedSchema).parse(await manager.query(`SELECT id,items_json AS items,${instantColumn('created_at', 'createdAt')} FROM v2_notifications WHERE account_id=? AND created_at>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ${messageRetentionDays} DAY) ORDER BY id DESC`, [context.actor.id]));
  const visibleProjects = new Set(context.projects.map((row) => row.id));
  // 私人消息在写入时固定绑定本人；项目消息还须满足当前项目可见性。
  const messages = rows.map((row) => ({ ...row, items: z.array(v2MessageItemSchema).parse(decodeJson(row.items)).filter((item) => item.projectId === null || visibleProjects.has(item.projectId)) })).filter((row) => row.items.length > 0);
  const cursor = rows[0]?.id ?? '0';
  const pages = Math.max(1, Math.ceil(messages.length / 10)), current = Math.min(page, pages);
  return { accountId: context.actor.id, cursor, page: current, total: messages.length, messages: after === undefined ? messages.slice((current - 1) * 10, current * 10) : after === 'start' ? [] : messages.filter((row) => BigInt(row.id) > BigInt(after)).reverse() };
}
