import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { upcomingTaskReminders, v2MessagesSchema, v2TaskReminderReason, type V2TaskReminderPlan, type V2Workspace } from '@ntfs/contracts';
import type { DataSource } from 'typeorm';
import { v2ResultSchema } from './repository-utils.js';
import { sendDueTaskReminders } from './task-reminder.service.js';

type Actor = { id: ReturnType<typeof randomUUID>; token: string; csrf: string };
type Harness = {
  source: DataSource; lead: Actor; developer: Actor; manager: Actor; outsider: Actor; projectId: string; periodId: string;
  call: (path: string, actor: Actor, body?: unknown, expected?: number) => Promise<unknown>;
  state: (actor?: Actor) => Promise<V2Workspace>;
};

/** 真实 HTTP 与本机数据库验证配置、执行人快照及任务生命周期，测试夹具由外层回收。 */
export async function verifyTaskReminders({ source, lead, developer, manager, outsider, projectId, periodId, call, state }: Harness) {
  const now = Date.now(), day = 86_400_000, minute = 60_000;
  const beijingFields = (at: number) => {
    const local = new Date(at + 8 * 3_600_000).toISOString();
    return { on: local.slice(0, 10), time: local.slice(11, 16) };
  };
  const plan: V2TaskReminderPlan = { mode: 'daily', ...beijingFields(now + 3 * day), advanceDays: 2 };
  const past: V2TaskReminderPlan = { mode: 'once', ...beijingFields(now - minute) };
  const input = { projectId, periodId, title: '定时提醒验收', executorId: developer.id, plannedDays: 1, unplanned: false };
  const action = (name: string, fields: object) => ({ action: name, operationId: randomUUID(), ...fields });
  const ids = (result: unknown) => v2ResultSchema.parse(result).objectIds;
  const task = async (taskId: string) => { const row = (await state()).tasks.find((entry) => entry.id === taskId); assert.ok(row); return row; };
  const readReminder = async (actor: Actor, taskId: string) => (await state(actor)).taskReminders?.find((row) => row.taskId === taskId);
  const messages = async (actor: Actor, taskId: string) => v2MessagesSchema.parse(await call('notifications', actor)).messages.flatMap((row) => row.items).filter((item) => item.taskId === taskId);
  const reminders = async (actor: Actor, taskId: string) => (await messages(actor, taskId)).filter((item) => item.reasons.includes(v2TaskReminderReason));
  const tick = () => source.transaction('READ COMMITTED', (manager) => sendDueTaskReminders(manager, new Date()));

  // 批量按条配置，旧请求字段省略仍有效；无权用户读不到配置。
  const [projectTask, otherTask] = ids(await call('tasks', lead, action('create_batch', { tasks: [{ ...input, reminder: plan }, input] })));
  assert.ok(projectTask && otherTask);
  assert.equal((await readReminder(developer, projectTask))?.nextAt, new Date(upcomingTaskReminders(plan, now).first ?? 0).toISOString());
  assert.equal(await readReminder(developer, otherTask), undefined);
  assert.equal(await readReminder(manager, projectTask), undefined);
  await call('edit', manager, action('save_task', { taskId: projectTask, version: 0, reminder: null }), 403);
  await call('tasks', lead, action('create_project', { task: { ...input, title: '过去提醒应回滚', reminder: past } }), 409);
  assert.ok(!(await state()).tasks.some((row) => row.title === '过去提醒应回滚'));

  // 待建转换与私人任务沿用相同配置；消息保留触发时的姓名。
  const [backlogId] = ids(await call('projects', lead, action('create_backlog', { projectId, title: '待建提醒验收', priority: 3 })));
  assert.ok(backlogId);
  const [converted] = ids(await call('projects', lead, action('convert_backlog', { backlogId, version: 0, task: { ...input, reminder: plan } })));
  const [personal] = ids(await call('tasks', developer, action('create_private', { task: { title: '私人提醒验收', reminder: plan } })));
  assert.ok(converted && personal);
  assert.deepEqual((await readReminder(developer, converted))?.plan, plan);
  assert.deepEqual((await readReminder(developer, personal))?.plan, plan);
  const before = (await messages(developer, projectTask)).find((item) => item.reasons.some((reason) => reason.endsWith('为你安排了任务')));
  const organization = await state(lead);
  assert.equal(before?.executorName, organization.accounts.find((row) => row.id === developer.id)?.displayName);

  // 改派后以发送时的执行人为准，完成及重新打开任务不会留下旧计划。
  await call('edit', lead, action('save_task', { taskId: projectTask, version: 0,
    details: { kind: 'project', title: input.title, priority: 3, executorId: lead.id, milestoneId: null },
  }));
  await call('tasks', developer, action('set_status', { taskId: converted, version: 0, status: 'completed',
    completion: { actualDays: 1, aiContribution: 'none' },
  }));
  assert.equal(await readReminder(developer, converted), undefined);
  await call('edit', developer, action('save_task', { taskId: converted, version: (await task(converted)).version, reminder: plan }), 409);
  await call('tasks', developer, action('set_status', { taskId: converted, version: (await task(converted)).version, status: 'in_progress' }));
  assert.equal(await readReminder(developer, converted), undefined);

  // 仅加速本次夹具，真实后台事务并发扫描不得重复发给同一账号。
  for (const taskId of [projectTask, personal]) {
    await source.query('UPDATE v2_task_reminders SET plan_json=?,next_at=? WHERE task_id=?', [
      JSON.stringify(past), new Date(Date.parse(`${past.on}T${past.time}:00+08:00`)), taskId,
    ]);
  }
  await Promise.all([tick(), tick()]);
  assert.equal((await reminders(lead, projectTask)).length, 1);
  assert.equal((await reminders(developer, projectTask)).length, 0);
  assert.equal((await reminders(developer, personal)).length, 1);
  assert.equal((await reminders(lead, personal)).length, 0);
  assert.equal((await reminders(outsider, projectTask)).length, 0);
  assert.equal((await readReminder(lead, projectTask))?.nextAt, null);

  // 显式移除及已完成时拒绝配置，分别验证空值与业务状态。
  await call('edit', lead, action('save_task', { taskId: projectTask, version: (await task(projectTask)).version, reminder: null }));
  assert.equal(await readReminder(lead, projectTask), undefined);
}
