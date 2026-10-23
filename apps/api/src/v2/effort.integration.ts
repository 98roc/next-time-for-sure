import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { v2ImpactSchema, v2TaskHistorySchema, type V2Workspace } from '@ntfs/contracts';
import { v2ResultSchema } from './repository-utils.js';

type Actor = { id: ReturnType<typeof randomUUID>; token: string; csrf: string };
type Harness = { source: DataSource; lead: Actor; developer: Actor; manager: Actor; periodId: string; nextId: string; projectId: string; call: (path: string, actor: Actor, body?: unknown, expected?: number) => Promise<unknown>; state: (actor?: Actor) => Promise<V2Workspace> };

/** 随机项目内真实API及数据库回读，复用主夹具清理，不修改用户任务。 */
export async function verifyEffort(h: Harness): Promise<void> {
  const { source, lead, developer, manager, periodId, nextId, projectId, call, state } = h;
  const input = { projectId, executorId: developer.id, title: '人天与AI验收', periodId, plannedDays: 1 };
  await call('tasks', lead, { action: 'create_project', operationId: randomUUID(), task: { ...input, additionalArrangements: [{ periodId, plannedDays: 1 }] } }, 400);
  for (const plannedDays of [null, undefined, -1, 0.001, 10000]) {
    await call('tasks', lead, { action: 'create_project', operationId: randomUUID(), task: { ...input, plannedDays } }, 400);
  }
  await call('tasks', lead, { action: 'create_batch', operationId: randomUUID(), tasks: [input, { ...input, plannedDays: null }] }, 400);
  const id = v2ResultSchema.parse(await call('tasks', lead, { action: 'create_project', operationId: randomUUID(), task: input })).objectIds[0]; assert.ok(id);
  const current = async () => { const task = (await state(developer)).tasks.find((row) => row.id === id); assert.ok(task); return task; };
  const edit = async (actor: Actor, fields: object, expected = 200) => call('edit', actor, { action: 'save_task', operationId: randomUUID(), taskId: id, version: (await current()).version, ...fields }, expected);
  await edit(developer, { arrangements: [{ periodId, plannedDays: null }] }, 400);
  await call('tasks', lead, { action: 'add_arrangement', operationId: randomUUID(), taskId: id, version: (await current()).version, periodId: nextId, plannedDays: null }, 400);
  await call('tasks', lead, { action: 'change_arrangement', operationId: randomUUID(), taskId: id, version: (await current()).version, periodId, targetPeriodId: nextId, plannedDays: null, confirmation: '0'.repeat(64) }, 400);
  await edit(developer, { arrangements: [{ periodId, plannedDays: 0 }] });
  assert.equal((await state()).arrangements.find((row) => row.taskId === id)?.plannedDays, 0);
  await edit(manager, { completion: { actualDays: 1, aiContribution: 'high' } }, 403);
  await edit(developer, { arrangements: [{ periodId, plannedDays: 1.25 }] });
  await edit(developer, { arrangements: [{ periodId: nextId, plannedDays: 2 }] }, 403);
  assert.equal((await state()).arrangements.find((row) => row.taskId === id)?.plannedDays, 1.25);
  await edit(developer, { completion: { actualDays: 0.001, aiContribution: 'none' } }, 400);
  await edit(developer, { status: 'completed' }, 409);
  assert.equal((await current()).status, 'not_started');
  const me = await state(developer), category = me.categories.find((row) => row.status === 'completed' && row.isDefault); assert.ok(category);
  const move = { action: 'move_task', operationId: randomUUID(), taskId: id, taskVersion: (await current()).version, version: me.personalVersion, categoryId: category.id, beforeTaskId: null };
  await call('personal', developer, move, 409);
  const completedMove = { ...move, completion: { actualDays: 0, aiContribution: null } };
  await call('personal', developer, completedMove); await call('personal', developer, completedMove);
  assert.equal((await current()).actualDays, 0); assert.equal((await current()).aiContribution, 'high');
  await edit(lead, { completion: { actualDays: 2.5, aiContribution: 'medium' } });
  await edit(developer, { status: 'in_progress' });
  assert.equal((await current()).actualDays, 2.5);
  await edit(developer, { status: 'completed' });
  assert.equal((await current()).actualDays, 2.5); assert.equal((await current()).aiContribution, 'medium');
  const version = (await current()).version;
  const rows = [{ periodId, plannedDays: 1.25 }, { periodId: nextId, plannedDays: 1 }];
  const intent = { action: 'save_arrangements', taskId: id, version, arrangements: rows };
  const preview = v2ImpactSchema.parse(await call('impact', lead, intent));
  await edit(lead, { arrangements: rows, arrangementConfirmation: '0'.repeat(64), completion: { actualDays: 8, aiContribution: 'none' } }, 409);
  assert.equal((await current()).actualDays, 2.5); assert.equal((await current()).version, version);
  const command = { action: 'save_task', operationId: randomUUID(), taskId: id, version, arrangements: rows, arrangementConfirmation: preview.confirmation };
  await call('edit', lead, command); await call('edit', lead, command);
  assert.equal((await state()).arrangements.filter((row) => row.taskId === id).length, 2);
  await call('edit', lead, { ...command, operationId: randomUUID() }, 409);
  await edit(lead, { arrangements: [] }, 400);
  const original = await current();
  const races = await Promise.all([3, 4].map((actualDays) => fetchEdit(actualDays)));
  assert.deepEqual(races.sort(), [200, 409]);
  async function fetchEdit(actualDays: number) {
    try { await call('edit', developer, { action: 'save_task', operationId: randomUUID(), taskId: id, version: original.version, completion: { actualDays, aiContribution: 'low' } }); return 200; }
    catch (error) { if (error instanceof assert.AssertionError && error.actual === 409) return 409; throw error; }
  }
  const stored = z.array(z.object({ actualDays: z.coerce.number(), ai: z.string() })).parse(await source.query('SELECT actual_days AS actualDays,ai_contribution AS ai FROM v2_tasks WHERE id=?', [id]))[0];
  assert.equal(stored?.actualDays, (await current()).actualDays); assert.equal(stored?.ai, 'low');
  const history = v2TaskHistorySchema.parse(await call(`history?taskId=${id}`, developer));
  assert.ok(history.some((row) => row.snapshot.actualDays === 0 && row.snapshot.aiContribution === 'high'));
  assert.ok(history.some((row) => row.actorId === lead.id && row.snapshot.actualDays === 2.5));

  // 创建即完成必须和结果同事务落库，失败不遗留任务；个人任务不受此限制。
  const createCompleted = { action: 'create_project', operationId: randomUUID(), task: input, categoryId: category.id };
  await call('tasks', developer, createCompleted, 409);
  const created = v2ResultSchema.parse(await call('tasks', developer, { ...createCompleted, task: { ...input, completion: { actualDays: 0, aiContribution: 'none' } } })).objectIds[0];
  assert.equal((await state(developer)).tasks.find((row) => row.id === created)?.status, 'completed');
  const privateId = v2ResultSchema.parse(await call('tasks', developer, { action: 'create_private', operationId: randomUUID(), task: { title: '私人直接完成验收', categoryId: category.id } })).objectIds[0];
  assert.ok(privateId); const privateTask = (await state(developer)).tasks.find((row) => row.id === privateId); assert.ok(privateTask);
  await call('edit', developer, { action: 'save_task', operationId: randomUUID(), taskId: privateId, version: privateTask.version, completion: { actualDays: 1, aiContribution: 'low' } }, 409);
  assert.equal(privateTask.actualDays, null);

  // 历史已完成空记录可改无关字段，不补造数据；重开后再次完成才必填。
  await source.query('UPDATE v2_tasks SET actual_days=NULL,ai_contribution=NULL WHERE id=?', [id]);
  await edit(lead, { details: { kind: 'project', title: '历史任务改名', priority: 3, executorId: developer.id, milestoneId: null } });
  assert.equal((await current()).actualDays, null); assert.equal((await current()).aiContribution, null);
  await edit(developer, { status: 'in_progress' }); await edit(developer, { status: 'completed' }, 409);
  await edit(developer, { status: 'completed', completion: { actualDays: 0.25, aiContribution: 'none' } });
  console.log('Effort API/database checks passed: permissions, atomicity, 0/null, move/create completion, concurrency, history and private isolation.');
}
