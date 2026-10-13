import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { workSnapshotSchema, assignmentSnapshotSchema, personalSnapshotSchema } from '@ntfs/contracts';
import type { MilestoneCommand } from '@ntfs/contracts';
import type { WorkFixture, Session } from '../organization/integration-smoke.js';

/** 实际API验证节点增改移出、并发及引用一致性，复用隔离夹具统一清理。 */
export async function verifyMilestones(fixture: WorkFixture, taskId: string): Promise<void> {
  const { call, leader, developer, manager, admin, projectId, ownerId, otherProjectId } = fixture;
  async function snapshot() { return workSnapshotSchema.parse(await (await call(`work?projectId=${projectId}`, developer)).json()); }
  async function task(id: string) { const result = (await snapshot()).tasks.find((entry) => entry.id === id); assert.ok(result); return result; }
  async function execute(command: MilestoneCommand, auth: Session = leader, expected = 200) {
    const response = await call('milestones/commands', auth, command); assert.equal(response.status, expected, command.action);
    return expected === 200 ? z.object({ objectId: z.string().uuid() }).parse(await response.json()).objectId : '';
  }
  const create: MilestoneCommand = { action: 'create_node', projectId, ownerId, title: '节点验收', description: '', acceptance: '', expectedOn: '2026-11-03', operationId: randomUUID() };
  await execute(create, manager, 403); await execute(create, admin, 403);
  await execute({ ...create, projectId: otherProjectId }, developer, 403);
  const id = await execute(create); assert.equal(await execute(create), id);
  await execute({ ...create, title: '同键不同内容' }, leader, 409);
  const second = await execute({ ...create, title: '同日第二节点', operationId: randomUUID() }, developer);
  assert.equal((await snapshot()).tasks.filter((entry) => entry.inMilestone && entry.expectedOn === create.expectedOn).length, 2);
  const current = await task(id);
  await execute({ action: 'edit_task', taskId: id, version: current.version, title: '管理者不能改他人任务内容', description: '', acceptance: '' }, leader, 403);
  await execute({ action: 'edit_task', taskId: id, version: current.version, title: '原任务同步标题', description: '保持同一对象', acceptance: '' }, developer);
  await execute({ action: 'reschedule_node', taskId: id, version: current.version, expectedOn: null, reason: '旧版本调整' }, leader, 409);
  const updated = await task(id);
  const results = await Promise.all([
    call('milestones/commands', leader, { action: 'reschedule_node', taskId: id, version: updated.version, expectedOn: null, reason: '条件待定' }),
    call('milestones/commands', leader, { action: 'reschedule_node', taskId: id, version: updated.version, expectedOn: '2026-11-05', reason: '改期' }),
  ]);
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
  const moved = await task(id);
  await execute({ action: 'reschedule_node', taskId: id, version: moved.version, expectedOn: null, reason: '放回未规划' });
  assert.equal((await task(id)).expectedOn, null); assert.equal((await task(id)).inMilestone, true);

  // 已有分工及个人关联的任务移出节点后，所有原执行记录仍可通过相同标识访问。
  const assignmentsBefore = assignmentSnapshotSchema.parse(await (await call(`assignments?projectId=${projectId}`, developer)).json());
  const personalBefore = personalSnapshotSchema.parse(await (await call('personal?scope=mine', developer)).json());
  const original = await task(taskId);
  await execute({ action: 'add_node', taskId, expectedOn: '2026-11-03', version: original.version });
  await execute({ action: 'remove_node', taskId, version: original.version + 1, reason: '移出规划但保留执行' });
  assert.equal((await task(taskId)).inMilestone, false);
  assert.equal((await task(taskId)).expectedOn, null);
  assert.deepEqual(assignmentSnapshotSchema.parse(await (await call(`assignments?projectId=${projectId}`, developer)).json()), assignmentsBefore);
  assert.deepEqual(personalSnapshotSchema.parse(await (await call('personal?scope=mine', developer)).json()), personalBefore);
  await execute({ action: 'add_node', taskId, expectedOn: null, version: original.version + 2 });
  await execute({ action: 'add_node', taskId, expectedOn: null, version: original.version + 3 }, leader, 409);
  const history = (await snapshot()).events.filter((entry) => entry.objectId === id && entry.action === 'milestone.reschedule_node');
  assert.ok(history.length >= 1); assert.ok(history.every((entry) => entry.payload.before && entry.payload.after));
  assert.ok((await task(second)).inMilestone);
  console.log('PASS: milestone creation/replay, same-day nodes, unplanned dates, role/content boundaries, date version races, shared task edits, removal/re-addition preserving assignments/personal records and dated history');
}
