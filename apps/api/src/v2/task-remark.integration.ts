import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { v2TaskHistorySchema, v2WeeklyStateSchema, type V2Workspace } from '@ntfs/contracts';
import { v2ResultSchema } from './repository-utils.js';

type Actor = { id: ReturnType<typeof randomUUID>; token: string; csrf: string };
type Harness = { source: DataSource; lead: Actor; developer: Actor; manager: Actor; outsider: Actor; projectId: string; periodId: string; nextPeriodId: string; call: (path: string, actor: Actor, body?: unknown, expected?: number) => Promise<unknown>; state: (actor?: Actor) => Promise<V2Workspace> };

/** 真实HTTP与数据库回读覆盖备注权限、清空语义、并发及历史；随机数据由调用方统一清理。 */
export async function verifyTaskRemarks(h: Harness): Promise<void> {
  const { source, lead, developer, manager, outsider, projectId, periodId, nextPeriodId, call, state } = h;
  const input = { projectId, periodId, executorId: developer.id, title: '任务备注验收', plannedDays: 1 };
  const create = async (extra: object = {}) => {
    const id = v2ResultSchema.parse(await call('tasks', lead, { action: 'create_project', operationId: randomUUID(), task: { ...input, ...extra } })).objectIds[0];
    assert.ok(id); return id;
  };
  const taskId = await create(), current = async () => {
    const task = (await state(developer)).tasks.find((row) => row.id === taskId); assert.ok(task); return task;
  };
  const edit = async (actor: Actor, fields: object, expected = 200) => call('edit', actor, { action: 'save_task', operationId: randomUUID(), taskId, version: (await current()).version, ...fields }, expected);
  assert.equal((await current()).remark, '');

  // 执行人与管理者可写；只读者连明确清空也不可写，不能夹带基本信息越权。
  await edit(manager, { remark: '越权' }, 403);
  await edit(manager, { remark: '' }, 403);
  await edit(outsider, { remark: '越权' }, 404);
  for (const remark of [null, 42, '字'.repeat(5001)]) await edit(developer, { remark }, 400);
  const note = '任务级说明\n保留换行、<纯文本>与表情😀';
  const version = (await current()).version;
  const command = { action: 'save_task', operationId: randomUUID(), taskId, version, remark: `  ${note}  ` };
  await call('edit', developer, command); await call('edit', developer, command);
  assert.equal((await current()).version, version + 1);
  assert.equal((await current()).remark, note);
  const stored = z.array(z.object({ remark: z.string() })).parse(await source.query('SELECT remark FROM v2_tasks WHERE id=?', [taskId]));
  assert.equal(stored[0]?.remark, note);
  assert.equal((await state(manager)).tasks.find((row) => row.id === taskId)?.remark, note);
  const history = v2TaskHistorySchema.parse(await call(`history?taskId=${taskId}`, developer));
  assert.equal(history.at(-1)?.actorId, developer.id); assert.equal(history.at(-1)?.snapshot.remark, note);
  await call('edit', lead, { ...command, operationId: randomUUID(), remark: '过期覆盖' }, 409);
  await edit(developer, { remark: '越权同时覆盖', details: { kind: 'project', title: '非法改名', priority: 3, executorId: developer.id, milestoneId: null } }, 403);
  await edit(lead, { remark: '非法安排同时覆盖', arrangements: [{ periodId: randomUUID(), plannedDays: 1 }] }, 409);
  assert.equal((await current()).remark, note);

  // 周期工作及周报内容与备注独立；旧客户端省略备注时保留已保存值。
  await edit(developer, { arrangements: [{ periodId, plannedDays: 1, workNote: '本期交付内容' }] });
  assert.equal((await current()).remark, note);
  const report = () => call(`weekly?summaryPeriodId=${periodId}&planPeriodId=${nextPeriodId}`, lead).then((value) => v2WeeklyStateSchema.parse(value));
  const beforeReport = await report();
  await edit(lead, { remark: '管理者补充' });
  const afterReport = await report();
  assert.equal(afterReport.generatedText, beforeReport.generatedText);
  assert.equal((await state()).arrangements.find((row) => row.taskId === taskId)?.workNote, '本期交付内容');
  const concurrentVersion = (await current()).version;
  const concurrent = await Promise.allSettled([developer, lead].map((actor, index) => call('edit', actor, { action: 'save_task', operationId: randomUUID(), taskId, version: concurrentVersion, remark: `并发备注${index}` })));
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
  const conflict = concurrent.find((result) => result.status === 'rejected'); assert.ok(conflict?.status === 'rejected');
  assert.ok(conflict.reason instanceof assert.AssertionError); assert.equal(conflict.reason.actual, 409);
  assert.equal((await current()).version, concurrentVersion + 1);
  await edit(developer, { remark: '   ' }); assert.equal((await current()).remark, '');

  // 当前执行人权限随改派立即变化，旧幂等请求不能绕过重新鉴权。
  const retry = { action: 'save_task', operationId: randomUUID(), taskId, version: (await current()).version, remark: '改派前备注' };
  await call('edit', developer, retry);
  await edit(lead, { details: { kind: 'project', title: input.title, priority: 3, executorId: lead.id, milestoneId: null } });
  await call('edit', developer, retry, 403);
  await edit(developer, { remark: '改派后越权' }, 403);
  assert.equal((await current()).remark, '改派前备注');

  // 创建、批量、待建转换及私人任务均采用同一个字段契约。
  const createdId = await create({ remark: note });
  assert.equal((await state()).tasks.find((row) => row.id === createdId)?.remark, note);
  const batch = v2ResultSchema.parse(await call('tasks', lead, { action: 'create_batch', operationId: randomUUID(), tasks: [{ ...input, remark: '第一条' }, { ...input, remark: '第二条' }] }));
  const batchState = await state(); assert.deepEqual(batch.objectIds.map((id) => batchState.tasks.find((row) => row.id === id)?.remark), ['第一条', '第二条']);
  const backlogId = v2ResultSchema.parse(await call('projects', lead, { action: 'create_backlog', operationId: randomUUID(), projectId, title: input.title, priority: 3 })).objectIds[0];
  const convertedId = v2ResultSchema.parse(await call('projects', lead, { action: 'convert_backlog', operationId: randomUUID(), backlogId, version: 0, task: { ...input, remark: '转换时补充' } })).objectIds[0];
  assert.equal((await state()).tasks.find((row) => row.id === convertedId)?.remark, '转换时补充');
  const privateId = v2ResultSchema.parse(await call('tasks', developer, { action: 'create_private', operationId: randomUUID(), task: { title: '私人备注', remark: note } })).objectIds[0];
  assert.ok(privateId);
  assert.equal((await state(developer)).tasks.find((row) => row.id === privateId)?.remark, note);
  await call('edit', lead, { action: 'save_task', operationId: randomUUID(), taskId: privateId, version: 0, remark: '越权' }, 404);
  await call('edit', developer, { action: 'save_task', operationId: randomUUID(), taskId: privateId, version: 0, remark: '' });
  assert.equal((await state(developer)).tasks.find((row) => row.id === privateId)?.remark, '');
  const comments = z.array(z.object({ comment: z.string() })).parse(await source.query("SELECT COLUMN_COMMENT AS comment FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='v2_tasks' AND COLUMN_NAME='remark'"));
  assert.match(comments[0]?.comment ?? '', /任务备注/u);
  console.log('Task remarks API/MySQL passed: create, edit, clear, permissions, atomic rollback, concurrency, history, report isolation, batch, conversion and private tasks.');
}
