import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { v2DailyReportSchema, v2SubtasksSchema, type V2Workspace, type V2SubtaskInput } from '@ntfs/contracts';
import { v2ResultSchema } from './repository-utils.js';
import { shiftDate } from './calendar.js';

type Actor = { id: ReturnType<typeof randomUUID>; token: string; csrf: string };
type Harness = { source: DataSource; leader: Actor; lead: Actor; developer: Actor; manager: Actor; projectId: string; hiddenProjectId: string; teamId: string; periodId: string; call: (path: string, actor: Actor, body?: unknown, expected?: number) => Promise<unknown>; state: (actor?: Actor) => Promise<V2Workspace> };

/** 复用主夹具验证私人权限、历史、并发及持久化，所有随机记录由主夹具回收。 */
export async function verifyPersonalWork(h: Harness): Promise<void> {
  const { source, leader, lead, developer, manager, projectId, hiddenProjectId, teamId, periodId, call, state } = h;
  const today = (await state()).today, yesterday = shiftDate(today, -1);
  const taskId = v2ResultSchema.parse(await call('tasks', lead, { action: 'create_project', operationId: randomUUID(), task: { projectId, periodId, executorId: developer.id, title: '私人步骤父任务' } })).objectIds[0]; assert.ok(taskId);
  const read = async () => v2SubtasksSchema.parse(await call(`subtasks?taskId=${taskId}`, developer));
  const daily = async (on = today, actor = developer) => v2DailyReportSchema.parse(await call(`daily?on=${on}`, actor));
  const current = async () => { const task = (await state(developer)).tasks.find((row) => row.id === taskId); assert.ok(task); return task; };
  const a = { id: randomUUID(), title: '私人步骤甲', completed: true }, b = { id: randomUUID(), title: '私人步骤乙', completed: true }, c = { id: randomUUID(), title: '未完成步骤', completed: false };
  const command = { action: 'save_subtasks', operationId: randomUUID(), taskId, version: 0, items: [a, b, c], removedIds: [] };
  assert.equal((await read()).items.length, 0);
  for (const actor of [leader, lead, manager]) { await call(`subtasks?taskId=${taskId}`, actor, undefined, 403); await call('subtasks', actor, command, 403); }
  await call('subtasks', developer, { ...command, ownerId: leader.id }, 400);
  await call('subtasks', developer, { ...command, items: [a, a] }, 400);
  await call('subtasks', developer, command); await call('subtasks', developer, command);
  assert.equal((await read()).version, 1); assert.equal((await current()).status, 'not_started');
  await call('subtasks', developer, { ...command, operationId: randomUUID() }, 409);
  const firstTime = (await read()).items[0]?.completedAt; assert.ok(firstTime);
  const save = async (items: V2SubtaskInput[], removedIds: string[] = []) => call('subtasks', developer, { ...command, operationId: randomUUID(), version: (await read()).version, items, removedIds });
  await save([b, { ...a, title: '私人步骤甲改名' }, c]);
  assert.equal((await read()).items[1]?.completedAt, firstTime);
  const generated = await daily(); assert.match(generated.generatedText, /\d+\.私人步骤父任务\n\x20{2}（1）私人步骤乙\n\x20{2}（2）私人步骤甲改名/u); assert.doesNotMatch(generated.generatedText, /未开始|进行中|未完成步骤/u);
  assert.doesNotMatch(JSON.stringify(await state(manager)), /私人步骤甲|私人步骤乙/u);
  assert.doesNotMatch((await daily(today, leader)).generatedText, /私人步骤父任务|私人步骤乙/u);

  // 主任务完成、重开都不改子任务；子任务全部完成也不联动主任务状态。
  for (const status of ['completed', 'in_progress']) await call('tasks', developer, { action: 'set_status', operationId: randomUUID(), taskId, version: (await current()).version, status, ...(status === 'completed' ? { completion: { actualDays: 0, aiContribution: 'none' } } : {}) });
  assert.equal((await read()).items[2]?.completed, false);
  await save([b, a, { ...c, completed: true }]); assert.equal((await current()).status, 'in_progress');
  await call('subtasks', developer, { ...command, operationId: randomUUID(), version: (await read()).version, items: [a] }, 409);
  await save([b, a], [c.id]);
  const version = (await read()).version;
  const races = await Promise.all(['并发甲', '并发乙'].map(async (title) => {
    try { await call('subtasks', developer, { ...command, operationId: randomUUID(), version, items: [b, { ...a, title }] }); return 200; }
    catch (error) { if (error instanceof assert.AssertionError && error.actual === 409) return 409; throw error; }
  })); assert.deepEqual(races.sort(), [200, 409]);
  const stored = z.array(z.object({ items: z.string(), version: z.number() })).parse(await source.query('SELECT CAST(items_json AS CHAR) AS items,version FROM v2_personal_subtasks WHERE owner_id=? AND task_id=?', [developer.id, taskId]))[0]; assert.ok(stored); assert.equal(stored.version, version + 1); assert.deepEqual(JSON.parse(stored.items), (await read()).items);

  // 只回拨随机夹具的事件时间，验证跨日后改名、删除、重开与改派不会修改昨日事实。
  await source.query("UPDATE v2_personal_subtask_events SET occurred_at=CONCAT(?,' 02:00:00.000'),snapshot_json=JSON_SET(snapshot_json,'$.items[0].completedAt',CONCAT(?,'T02:00:00.000Z'),'$.items[1].completedAt',CONCAT(?,'T02:00:00.000Z')) WHERE owner_id=? AND task_id=? AND sequence=?", [yesterday, yesterday, yesterday, developer.id, taskId, version + 1]);
  const historic = (await daily(yesterday)).generatedText; assert.match(historic, /私人步骤乙/u);
  await save([], [a.id, b.id]);
  assert.equal((await daily(yesterday)).generatedText, historic);
  await call('edit', lead, { action: 'save_task', operationId: randomUUID(), taskId, version: (await current()).version, details: { kind: 'project', title: '后来改名并改派', priority: 3, executorId: lead.id, milestoneId: null } });
  await call(`subtasks?taskId=${taskId}`, developer, undefined, 403); await call('subtasks', developer, command, 403);
  assert.equal(v2SubtasksSchema.parse(await call(`subtasks?taskId=${taskId}`, lead)).items.length, 0);
  assert.equal((await daily(yesterday)).generatedText, historic);
  assert.doesNotMatch((await daily(yesterday, lead)).generatedText, /私人步骤乙/u);

  // 私人任务同样有清单；完成时间由后端记录且父任务计一次。
  const privateId = v2ResultSchema.parse(await call('tasks', developer, { action: 'create_private', operationId: randomUUID(), task: { title: '个人日报任务' } })).objectIds[0]; assert.ok(privateId);
  await call('subtasks', developer, { ...command, operationId: randomUUID(), taskId: privateId, items: [a] });
  await call('tasks', developer, { action: 'set_status', operationId: randomUUID(), taskId: privateId, version: 0, status: 'completed' });
  assert.match((await daily()).generatedText, /\d+\.个人日报任务（当日完成）\n\x20{2}（1）私人步骤甲/u);
  await call(`subtasks?taskId=${privateId}`, manager, undefined, 404);

  // 账号偏好跨请求持久化，其他账号不受影响；项目共享顺序和个人覆盖分开。
  const prefs = (await state(developer)).personalPreferences;
  await call('personal-settings', developer, { action: 'set_completed_mode', operationId: randomUUID(), version: prefs.version, mode: 'period' });
  assert.equal((await state(developer)).personalPreferences.completedMode, 'period'); assert.equal((await state(lead)).personalPreferences.completedMode, 'day');
  await call('personal-settings', developer, { action: 'set_daily_project_order', operationId: randomUUID(), version: prefs.version + 1, projectIds: [hiddenProjectId, projectId] }, 403);
  const shared = (await state()).orders.find((row) => row.scope === 'project-page:projects'); assert.ok(shared);
  await call('planning', leader, { action: 'reorder_projects', page: 'projects', operationId: randomUUID(), version: shared.version, projectIds: [hiddenProjectId, projectId] });
  assert.deepEqual((await daily(today, leader)).projects.map((row) => row.id), [hiddenProjectId, projectId]);
  await call('personal-settings', leader, { action: 'set_daily_project_order', operationId: randomUUID(), version: (await state()).personalPreferences.version, projectIds: [projectId, hiddenProjectId] });
  assert.deepEqual((await daily(yesterday, leader)).projects.map((row) => row.id), [projectId, hiddenProjectId]);
  const sharedAfter = (await state()).orders.find((row) => row.scope === 'project-page:projects'); assert.deepEqual(sharedAfter?.ids, [hiddenProjectId, projectId]);
  await call('personal-settings', leader, { action: 'set_daily_project_order', operationId: randomUUID(), version: (await state()).personalPreferences.version, projectIds: null });
  assert.deepEqual((await daily(today, leader)).projects.map((row) => row.id), [hiddenProjectId, projectId]);

  // 手工文字、版本和来源分别保护；来源变化只提示，不能自动覆盖。
  const beforeText = await daily(), write = { action: 'save_daily', operationId: randomUUID(), on: today, version: beforeText.text.version, sourceHash: beforeText.currentSourceHash, body: '仅本人手工日报' };
  await call('daily', developer, write); await call('daily', developer, write);
  await call('daily', developer, { ...write, operationId: randomUUID() }, 409);
  await call('subtasks', developer, { ...command, operationId: randomUUID(), taskId: privateId, version: 1, items: [{ ...a, title: '新来源步骤' }] });
  const changed = await daily(); assert.equal(changed.text.body, write.body); assert.equal(changed.text.stale, true);
  await call('daily', developer, { ...write, action: 'regenerate_daily', version: 1, operationId: randomUUID() }, 409);
  await call('daily', developer, { ...write, action: 'regenerate_daily', version: 1, sourceHash: changed.currentSourceHash, operationId: randomUUID() });
  assert.equal((await daily()).text.manual, false); assert.match((await daily()).text.body, /新来源步骤/u);
  assert.doesNotMatch((await daily(today, manager)).text.body, /新来源步骤|仅本人手工日报/u);
  await call(`daily?on=${today}&ownerId=${developer.id}`, manager, undefined, 400);
  const dbPreferences = z.array(z.object({ mode: z.string() })).parse(await source.query('SELECT completed_mode AS mode FROM v2_personal_preferences WHERE owner_id=?', [developer.id])); assert.equal(dbPreferences[0]?.mode, 'period');
  assert.equal((await state()).team?.id, teamId);
  console.log('Personal work API/database passed: privacy, independent states, deletion, reorder, timestamps, concurrency, reassignment, historical snapshots, preferences and protected daily text.');
}
