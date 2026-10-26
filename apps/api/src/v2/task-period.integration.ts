import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { v2DailyReportSchema, v2TaskHistorySchema, v2SummaryRowSchema, v2WeeklyStateSchema, type V2Workspace } from '@ntfs/contracts';
import { v2ResultSchema, dbTime } from './repository-utils.js';
import { periodWindow, shiftDate } from './calendar.js';

type Actor = { id: ReturnType<typeof randomUUID>; token: string; csrf: string };
type Harness = { source: DataSource; lead: Actor; developer: Actor; manager: Actor; projectId: string; call: (path: string, actor: Actor, body?: unknown, expected?: number) => Promise<unknown>; state: (actor?: Actor) => Promise<V2Workspace> };

/** 复用随机团队夹具，经真实HTTP补录与顺延，数据库只回溯本测试任务的创建基线。 */
export async function verifyTaskPeriods(h: Harness): Promise<void> {
  const { source, lead, developer, manager, projectId, call, state } = h;
  const workspace = await state(developer), current = workspace.periods.find((p) => p.startOn <= workspace.today && p.endOn >= workspace.today);
  assert.ok(current);
  const old = workspace.periods[workspace.periods.indexOf(current) - 1]; assert.ok(old);
  const future = workspace.periods[workspace.periods.indexOf(current) + 1]; assert.ok(future);
  const createdAt = periodWindow(old).start, completedAt = new Date(`${old.endOn}T18:00:00+08:00`).toISOString();
  const create = async (title: string, extra = false) => {
    const id = v2ResultSchema.parse(await call('tasks', lead, { action: 'create_project', operationId: randomUUID(), task: { projectId, executorId: developer.id, title, periodId: old.id, plannedDays: 0.5, workNote: '原周期工作', ...(extra ? { additionalArrangements: [{ periodId: future.id, plannedDays: 2, workNote: '后续工作' }] } : {}) } })).objectIds[0]; assert.ok(id);
    // 测试准备：构造上期已存在的真实任务历史，后续操作全部走API。
    await source.query('UPDATE v2_tasks SET created_at=?,updated_at=? WHERE id=?', [dbTime(createdAt), dbTime(createdAt), id]);
    await source.query("UPDATE v2_task_events SET occurred_at=?,snapshot_json=JSON_SET(snapshot_json,'$.task.createdAt',?,'$.task.updatedAt',?) WHERE task_id=? AND sequence=0", [dbTime(createdAt), createdAt, createdAt, id]);
    await source.query('UPDATE v2_arrangement_history SET valid_from=? WHERE task_id=?', [dbTime(createdAt), id]);
    return id;
  };
  const id = await create('补录与顺延验收'), futureId = await create('已有后续安排不追加', true);
  const read = () => state(developer);
  let snapshot = await read(), task = snapshot.tasks.find((t) => t.id === id); assert.ok(task);
  const carried = snapshot.arrangements.find((a) => a.taskId === id && a.periodId === current.id); assert.ok(carried);
  assert.equal(carried.plannedDays, 0.5); assert.equal(carried.carriedFromPeriodId, old.id); assert.equal(carried.workNote, '');
  assert.equal(snapshot.arrangements.some((a) => a.taskId === futureId && a.periodId === current.id), false);
  await Promise.all([read(), read()]);
  assert.equal((await read()).arrangements.filter((a) => a.taskId === id && a.periodId === current.id).length, 1);
  const complete = { action: 'set_status', operationId: randomUUID(), taskId: id, version: task.version, status: 'completed', completion: { actualDays: 0.2, aiContribution: 'high', completedAt } };
  await call('tasks', manager, complete, 403);
  await call('tasks', developer, { ...complete, completion: { ...complete.completion, completedAt: new Date(Date.now() + 86400000).toISOString() } }, 409);
  await call('tasks', developer, { ...complete, completion: { ...complete.completion, completedAt: new Date(Date.parse(createdAt) - 1000).toISOString() } }, 409);
  await call('tasks', developer, complete); await call('tasks', developer, complete);
  snapshot = await read(); task = snapshot.tasks.find((t) => t.id === id); assert.ok(task);
  assert.equal(task.completedAt, completedAt);
  assert.equal(snapshot.arrangements.some((a) => a.taskId === id && a.periodId === current.id), false);
  const summary = z.array(v2SummaryRowSchema).parse(await call(`summary?periodId=${old.id}`, developer));
  assert.equal(summary.find((t) => t.taskId === id)?.status, 'completed');
  assert.equal(z.array(v2SummaryRowSchema).parse(await call(`summary?periodId=${current.id}`, developer)).some((t) => t.taskId === id), false);
  const daily = v2DailyReportSchema.parse(await call(`daily?on=${old.endOn}`, developer)); assert.match(daily.generatedText, /补录与顺延验收/u);
  assert.doesNotMatch(v2DailyReportSchema.parse(await call(`daily?on=${workspace.today}`, developer)).generatedText, /补录与顺延验收/u);
  const history = v2TaskHistorySchema.parse(await call(`history?taskId=${id}`, developer));
  assert.ok(history.some((e) => e.action === 'arrangement_carried' && e.actorId === null));
  const lastEvent = history.at(-1); assert.ok(lastEvent && lastEvent.occurredAt > completedAt);
  await call('edit', developer, { action: 'save_task', operationId: randomUUID(), taskId: id, version: task.version, completion: { ...complete.completion, completedAt: new Date(`${shiftDate(old.endOn, -1)}T18:00:00+08:00`).toISOString() } });
  assert.doesNotMatch(v2DailyReportSchema.parse(await call(`daily?on=${old.endOn}`, developer)).generatedText, /补录与顺延验收/u);
  const noteTask = (await read()).tasks.find((t) => t.id === futureId); assert.ok(noteTask);
  await call('edit', developer, { action: 'save_task', operationId: randomUUID(), taskId: futureId, version: noteTask.version, arrangements: [{ periodId: old.id, plannedDays: 0.5, workNote: '更新本期工作' }, { periodId: future.id, plannedDays: 2, workNote: '后续工作' }] });
  assert.equal((await read()).arrangements.find((a) => a.taskId === futureId && a.periodId === old.id)?.workNote, '更新本期工作');
  // 已人工填写的顺延不能被补录静默删掉，失败同时回滚状态、版本及完成结果。
  const touchedId = await create('人工修改顺延保护');
  snapshot = await read(); const touched = snapshot.tasks.find((t) => t.id === touchedId); assert.ok(touched);
  await call('edit', developer, { action: 'save_task', operationId: randomUUID(), taskId: touchedId, version: touched.version, arrangements: snapshot.arrangements.filter((a) => a.taskId === touchedId).map((a) => ({ periodId: a.periodId, plannedDays: a.plannedDays, workNote: a.periodId === current.id ? '本期已另有工作' : a.workNote })) });
  const edited = (await read()).tasks.find((t) => t.id === touchedId); assert.ok(edited);
  await call('tasks', developer, { ...complete, operationId: randomUUID(), taskId: touchedId, version: edited.version }, 409);
  const preserved = await read();
  assert.equal(preserved.tasks.find((t) => t.id === touchedId)?.status, 'not_started');
  assert.equal(preserved.tasks.find((t) => t.id === touchedId)?.version, edited.version);
  assert.equal(preserved.arrangements.find((a) => a.taskId === touchedId && a.periodId === current.id)?.workNote, '本期已另有工作');
  const week = v2WeeklyStateSchema.parse(await call(`weekly?summaryPeriodId=${old.id}&planPeriodId=${current.id}`, developer));
  assert.match(week.generatedText, /人工修改顺延保护（原周期工作）/u);
  assert.match(week.generatedText, /人工修改顺延保护（本期已另有工作）/u);
  const nextWeek = v2WeeklyStateSchema.parse(await call(`weekly?summaryPeriodId=${current.id}&planPeriodId=${future.id}`, developer));
  assert.match(nextWeek.generatedText, /已有后续安排不追加（后续工作）/u);
  // 私人任务共用时间校验，但不引入项目人天或AI字段。
  const privateId = v2ResultSchema.parse(await call('tasks', developer, { action: 'create_private', operationId: randomUUID(), task: { title: '私人完成时间验收', priority: 3 } })).objectIds[0]; assert.ok(privateId);
  const privateAt = new Date().toISOString();
  await call('tasks', developer, { action: 'set_status', operationId: randomUUID(), taskId: privateId, version: 0, status: 'completed', completion: { completedAt: privateAt, actualDays: null, aiContribution: null } });
  assert.equal((await read()).tasks.find((t) => t.id === privateId)?.completedAt, privateAt);
  console.log('Task periods API/database passed: automatic carry, copied estimate, future plan protection, time validation, authorization, idempotence, historical summary/daily correction, work notes, touched-arrangement rollback and private completion.');
}
