import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { personalSnapshotSchema, workSnapshotSchema } from '@ntfs/contracts';
import type { WorkFixture } from '../organization/integration-smoke.js';

/** 排序真实验证权限、并发与执行事实不变，复用随机组织夹具清理。 */
export async function verifyOrder({ call, developer, manager, projectId }: WorkFixture): Promise<void> {
  async function work() { return workSnapshotSchema.parse(await (await call(`work?projectId=${projectId}`, developer)).json()); }
  async function personal() { return personalSnapshotSchema.parse(await (await call('personal?scope=mine', developer)).json()); }
  const column = (await work()).tasks.filter((entry) => entry.status === 'not_started');
  const last = column.at(-1); const first = column[0]; assert.ok(last && first && last.id !== first.id);
  const command = { action: 'reorder_task', taskId: last.id, version: last.version, beforeId: first.id, order: column.map(({ id, version }) => ({ id, version })) };
  assert.equal((await call('tasks/commands', manager, command)).status, 403);
  const results = await Promise.all([call('tasks/commands', developer, command), call('tasks/commands', developer, command)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const reordered = (await work()).tasks.filter((entry) => entry.status === 'not_started');
  assert.equal(reordered[0]?.id, last.id);
  for (const before of column) { const after = reordered.find((entry) => entry.id === before.id); assert.ok(after); assert.deepEqual({ ...after, position: before.position, version: before.version }, before); }
  for (const title of ['排序甲', '排序乙']) assert.equal((await call('personal/commands', developer, { action: 'create_personal', kind: 'private', projectId: null, assignmentId: null, title, description: '', acceptance: '', categoryId: null, operationId: randomUUID() })).status, 200);
  const categoryId = (await personal()).categories.find((entry) => entry.status === 'not_started')?.id; assert.ok(categoryId);
  const items = (await personal()).items.filter((entry) => entry.categoryId === categoryId);
  const moving = items.at(-1); const target = items[0]; assert.ok(moving && target && moving.id !== target.id);
  const insert = { action: 'insert_personal', itemId: moving.id, version: moving.version, categoryId, beforeId: target.id, order: items.filter((entry) => entry.id !== moving.id).map(({ id, version }) => ({ id, version })) };
  assert.equal((await call('personal/commands', manager, insert)).status, 403);
  assert.equal((await call('personal/commands', developer, insert)).status, 200);
  assert.equal((await call('personal/commands', developer, insert)).status, 409);
  const sorted = (await personal()).items.filter((entry) => entry.categoryId === categoryId);
  assert.equal(sorted[0]?.id, moving.id);
  for (const before of items) { const after = sorted.find((entry) => entry.id === before.id); assert.ok(after); assert.deepEqual({ ...after, position: before.position, version: before.version }, before); }
  console.log('PASS: persisted team/personal insertion order, unauthorized sort rejection, stale/concurrent sort conflict and unchanged execution facts');
}
