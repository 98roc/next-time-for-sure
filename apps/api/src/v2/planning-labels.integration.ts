import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { v2ImpactSchema, v2MessagesSchema, v2SummaryRowSchema, v2TaskHistorySchema, type V2Workspace } from '@ntfs/contracts';
import { v2ResultSchema } from './repository-utils.js';
import { PlanningLabels1793412000000 } from '../database/migrations/1793412000000-planning-labels.js';

type Actor = { id: ReturnType<typeof randomUUID>; token: string; csrf: string };
type Harness = { source: DataSource; lead: Actor; developer: Actor; manager: Actor; outsider: Actor; projectId: string; periodId: string; nextPeriodId: string; call: (path: string, actor: Actor, body?: unknown, expected?: number) => Promise<unknown>; state: (actor?: Actor) => Promise<V2Workspace> };

/** 真实HTTP/MySQL验证标签独立保存、旧数据、授权、事务、审计及通知去重；外层统一回收夹具。 */
export async function verifyPlanningLabels(h: Harness): Promise<void> {
  const { source, lead, developer, manager, outsider, projectId, periodId, nextPeriodId, call, state } = h;
  const input = { projectId, periodId, executorId: developer.id, title: '周期标签验收', plannedDays: 1 };
  const create = async (extra: object = {}) => {
    const id = v2ResultSchema.parse(await call('tasks', lead, { action: 'create_project', operationId: randomUUID(), task: { ...input, ...extra } })).objectIds[0];
    assert.ok(id); return id;
  };
  const readTask = async (id: string) => { const task = (await state()).tasks.find((row) => row.id === id); assert.ok(task); return task; };
  const mark = async (taskId: string, unplanned: boolean, period = periodId, actor = developer) => {
    const task = await readTask(taskId);
    const command = { action: 'save_task', operationId: randomUUID(), taskId, version: task.version, planningLabels: [{ periodId: period, unplanned }] };
    await call('edit', actor, command); return command;
  };
  const value = async (taskId: string, period = periodId) => (await state()).planningLabels.find((row) => row.taskId === taskId && row.periodId === period)?.unplanned;
  const messageCount = async () => v2MessagesSchema.parse(await call('notifications', lead)).total;

  // 自动默认只填一次；人工 false 和未来安排分别独立保存。
  const automatic = await create(); assert.equal(await value(automatic), true);
  const id = await create({ unplanned: false, additionalArrangements: [{ periodId: nextPeriodId, plannedDays: 0.5 }] });
  assert.equal(await value(id), false); assert.equal(await value(id, nextPeriodId), false);
  const baseline = await messageCount();
  await source.query('UPDATE v2_arrangements SET planned_days=NULL WHERE task_id=? AND period_id=?', [id, periodId]);
  const command = await mark(id, true);
  await call('edit', developer, command);
  assert.equal(await value(id), true); assert.equal(await messageCount(), baseline + 1);
  assert.equal((await state()).arrangements.find((row) => row.taskId === id && row.periodId === periodId)?.plannedDays, null, '单改标签不重填历史估算');
  await call('edit', developer, { ...command, operationId: randomUUID() }, 409);
  await mark(id, false); await mark(id, true);
  assert.equal(await messageCount(), baseline + 1, '反复标记不得重复提醒');
  await mark(id, true, nextPeriodId);
  assert.equal(await messageCount(), baseline + 1, '未来周期不发当前临时工作提醒');

  // 可见不等于可修改；越权、非法周期和混合失败均不落部分结果。
  const task = await readTask(id), patch = { action: 'save_task', operationId: randomUUID(), taskId: id, version: task.version, planningLabels: [{ periodId, unplanned: false }] };
  await call('edit', manager, patch, 403); await call('edit', outsider, patch, 404);
  await call('edit', developer, { ...patch, planningLabels: [{ periodId: randomUUID(), unplanned: false }] }, 409);
  await call('edit', developer, { ...patch, planningLabels: [{ periodId, unplanned: false }, { periodId: randomUUID(), unplanned: true }] }, 409);
  assert.equal(await value(id), true); assert.equal((await readTask(id)).version, task.version);
  const results = await Promise.all([false, true].map((unplanned) => call('edit', developer, { ...patch, operationId: randomUUID(), planningLabels: [{ periodId, unplanned }] }, 200).then(() => 200).catch((error: unknown) => {
    if (error instanceof assert.AssertionError && error.actual === 409) return 409;
    throw error;
  })));
  assert.deepEqual(results.sort(), [200, 409]);

  // 标签不依赖当前排期行，取消再加入以及改派仍保持；移往新周期不继承。
  await mark(id, true);
  let current = await readTask(id);
  const intent = { action: 'remove_arrangement', taskId: id, version: current.version, periodId };
  const impact = v2ImpactSchema.parse(await call('impact', lead, intent));
  await call('tasks', lead, { ...intent, operationId: randomUUID(), confirmation: impact.confirmation });
  assert.equal(await value(id), true);
  current = await readTask(id);
  await call('tasks', lead, { action: 'add_arrangement', operationId: randomUUID(), taskId: id, version: current.version, periodId, plannedDays: 1 });
  assert.equal(await value(id), true); assert.equal(await messageCount(), baseline + 1);
  const history = v2TaskHistorySchema.parse(await call(`history?taskId=${id}`, developer));
  assert.ok(history.some((event) => event.actorId === developer.id && event.planningChanges?.some((change) => change.periodId === periodId && change.before === true && change.after === false)));
  const summary = z.array(v2SummaryRowSchema).parse(await call(`summary?periodId=${periodId}`, developer));
  assert.equal(summary.find((row) => row.taskId === id)?.planning, 'unplanned');

  // 待建默认不勾选，但显式人工标记照常接受；系统延续不复制上期标签。
  const backlog = v2ResultSchema.parse(await call('projects', developer, { action: 'create_backlog', operationId: randomUUID(), projectId, title: '待建标签验收', priority: 3 })).objectIds[0]; assert.ok(backlog);
  const converted = v2ResultSchema.parse(await call('projects', developer, { action: 'convert_backlog', operationId: randomUUID(), backlogId: backlog, version: 0, task: { ...input, title: '待建标签验收' } })).objectIds[0]; assert.ok(converted);
  assert.equal(await value(converted), false); await mark(converted, true); assert.equal(await value(converted), true);
  const old = (await state()).periods.find((row) => row.endOn < (new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }))); assert.ok(old);
  const carried = await create({ periodId: old.id, unplanned: true });
  assert.equal(await value(carried, old.id), true); assert.equal(await value(carried), false);

  // 在真实库重跑初始化：既有人工选择不覆盖，旧来源不足明确为未知，不补发通知。
  const legacy = await create();
  await source.query('DELETE FROM v2_task_planning_labels WHERE task_id=?', [legacy]);
  const runner = source.createQueryRunner();
  try { await runner.connect(); await new PlanningLabels1793412000000().up(runner); } finally { await runner.release(); }
  assert.equal(await value(legacy), true); assert.equal(await value(id), true);
  await source.query("UPDATE v2_task_events SET action='migrated' WHERE task_id=? AND sequence=0", [legacy]);
  await source.query('DELETE FROM v2_task_planning_labels WHERE task_id=?', [legacy]);
  const unknownRunner = source.createQueryRunner();
  try { await unknownRunner.connect(); await new PlanningLabels1793412000000().up(unknownRunner); } finally { await unknownRunner.release(); }
  assert.equal(await value(legacy), null);
  await mark(legacy, false); assert.equal(await value(legacy), false);
  const comments = z.array(z.object({ comment: z.string() })).parse(await source.query("SELECT COLUMN_COMMENT AS comment FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='v2_task_planning_labels'"));
  assert.ok(comments.length > 0 && comments.every((row) => /[\u4e00-\u9fff]/u.test(row.comment)));
  console.log('Planning labels HTTP/MySQL passed: persisted defaults, explicit overrides, source-independent marking, estimate-free edits, authorization, idempotence/concurrency, rollback, cancellation restoration, carry isolation, audit, migration preservation/unknowns and notification deduplication.');
}
