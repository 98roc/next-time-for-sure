import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { v2ImpactSchema, v2TaskHistorySchema, type V2Workspace } from '@ntfs/contracts';
import { v2ResultSchema } from './repository-utils.js';

type Actor = { id: ReturnType<typeof randomUUID>; token: string; csrf: string };
type Harness = { source: DataSource; lead: Actor; leader: Actor; developer: Actor; outsider: Actor; projectId: string; periodId: string; call: (path: string, actor: Actor, body?: unknown, expected?: number) => Promise<unknown>; state: (actor?: Actor) => Promise<V2Workspace> };

/** 真实 HTTP 与数据库回读验证目标原子编辑；夹具由主测试统一清理。 */
export async function verifyMilestoneEditor({ source, lead, leader, developer, outsider, projectId, periodId, call, state }: Harness): Promise<void> {
  const milestoneId = v2ResultSchema.parse(await call('projects', lead, { action: 'create_milestone', projectId, title: '原子编辑验收', expectedOn: null, operationId: randomUUID() })).objectIds[0];
  assert.ok(milestoneId);
  const ids: string[] = [];
  for (const title of ['关联甲', '关联乙']) {
    const id = v2ResultSchema.parse(await call('tasks', lead, { action: 'create_project', operationId: randomUUID(), task: { projectId, periodId, executorId: developer.id, title, plannedDays: 1, milestoneId } })).objectIds[0];
    assert.ok(id); ids.push(id);
  }
  const before = await state(), original = before.milestones.find((row) => row.id === milestoneId); assert.ok(original);
  const linked = before.tasks.filter((row) => ids.includes(row.id)); assert.equal(linked.length, 2);
  const intent = { action: 'edit_milestone', milestoneId, version: original.version, title: '修改日期及关联', expectedOn: before.today, unlinkTasks: linked.map((row) => ({ taskId: row.id, version: row.version })) };
  const save = (body: object, expected = 200, actor = lead) => call('projects', actor, { ...body, operationId: randomUUID() }, expected);

  // 未授权、缺少确认、跨目标和过期版本均不得部分修改名称、日期或关联。
  await call('impact', developer, intent, 403);
  await call('impact', outsider, intent, 403);
  await save(intent, 409);
  await save(intent, 403, developer);
  const preview = v2ImpactSchema.parse(await call('impact', lead, intent));
  assert.deepEqual(preview.blockers, []);
  for (const task of linked) assert.ok(preview.details.some((line) => line.includes(task.title)));
  assert.ok(preview.details.some((line) => line.includes('未规划') && line.includes(before.today)));
  await save({ ...intent, title: '篡改确认内容', confirmation: preview.confirmation }, 409);
  await save({ ...intent, unlinkTasks: [...intent.unlinkTasks, intent.unlinkTasks[0]], confirmation: preview.confirmation }, 400);
  const foreign = { ...intent, unlinkTasks: [{ taskId: randomUUID(), version: 0 }] };
  const blocked = v2ImpactSchema.parse(await call('impact', lead, foreign));
  assert.ok(blocked.blockers.length);
  await save({ ...foreign, confirmation: blocked.confirmation }, 409);
  const unchanged = await state();
  assert.deepEqual(unchanged.milestones.find((row) => row.id === milestoneId), original);
  assert.deepEqual(unchanged.tasks.filter((row) => ids.includes(row.id)), linked);

  const first = linked[0]; assert.ok(first);
  await call('tasks', developer, { action: 'set_status', operationId: randomUUID(), taskId: first.id, version: first.version, status: 'in_progress' });
  await save({ ...intent, confirmation: preview.confirmation }, 409);
  assert.equal((await state()).milestones.find((row) => row.id === milestoneId)?.title, original.title);
  assert.equal((await state()).tasks.filter((row) => row.milestoneId === milestoneId).length, 2);

  // 刷新草稿后一次成功；同一幂等键重试不重复审计，安排和任务业务状态均保留。
  const current = await state(), currentTasks = current.tasks.filter((row) => ids.includes(row.id));
  const refreshed = { ...intent, unlinkTasks: currentTasks.map((row) => ({ taskId: row.id, version: row.version })) };
  const confirmed = v2ImpactSchema.parse(await call('impact', leader, refreshed));
  const command = { ...refreshed, confirmation: confirmed.confirmation, operationId: randomUUID() };
  await call('projects', leader, command); await call('projects', leader, command);
  const after = await state(), target = after.milestones.find((row) => row.id === milestoneId); assert.ok(target);
  assert.equal(target.title, intent.title); assert.equal(target.expectedOn, intent.expectedOn); assert.equal(target.version, original.version + 1);
  assert.deepEqual(after.arrangements.filter((row) => ids.includes(row.taskId)), current.arrangements.filter((row) => ids.includes(row.taskId)));
  for (const task of currentTasks) {
    const saved = after.tasks.find((row) => row.id === task.id); assert.ok(saved);
    assert.deepEqual(saved, { ...task, milestoneId: null, version: task.version + 1, updatedAt: saved.updatedAt });
    const history = v2TaskHistorySchema.parse(await call(`history?taskId=${task.id}`, lead));
    assert.equal(history.at(-1)?.actorId, leader.id);
  }
  const stored = z.array(z.object({ title: z.string(), version: z.number(), expectedOn: z.string() })).parse(await source.query("SELECT title,version,DATE_FORMAT(expected_on,'%Y-%m-%d') AS expectedOn FROM v2_milestones WHERE id=?", [milestoneId]));
  assert.deepEqual(stored[0], { title: intent.title, version: 1, expectedOn: before.today });
  const events = z.array(z.object({ count: z.coerce.number() })).parse(await source.query('SELECT COUNT(*) AS count FROM v2_object_events WHERE object_id=?', [milestoneId]));
  assert.equal(events[0]?.count, 2);
  await save({ ...refreshed, confirmation: confirmed.confirmation }, 409);

  // 移回未规划同样确认日期变化，普通名称修改仍兼容旧调用。
  const undate = { action: 'edit_milestone', milestoneId, version: target.version, title: target.title, expectedOn: null };
  const undateImpact = v2ImpactSchema.parse(await call('impact', lead, undate));
  await save({ ...undate, confirmation: undateImpact.confirmation });
  await save({ ...undate, version: target.version + 1, title: '名称独立修改' });
  assert.equal((await state()).milestones.find((row) => row.id === milestoneId)?.expectedOn, null);
  console.log('Milestone editor API/database checks passed: authorization, confirmation, atomic save, stale versions, idempotence, audit and preserved tasks/arrangements.');
}
