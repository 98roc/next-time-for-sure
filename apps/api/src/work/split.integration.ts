import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assignmentSnapshotSchema, organizationSnapshotSchema, personalSnapshotSchema, taskImpactSchema, workSnapshotSchema } from '@ntfs/contracts';
import type { SplitCommand } from '@ntfs/contracts';
import type { WorkFixture, Session } from '../organization/integration-smoke.js';

/** 拆分和父子联动真实验收，不使用直接SQL制造任务关系。 */
export async function verifySplits(fixture: WorkFixture): Promise<void> {
  const { call, developer, leader, manager, projectId, ownerId } = fixture;
  async function write(path: string, input: unknown, auth: Session = developer, status = 200) { const response = await call(path, auth, input); assert.equal(response.status, status, path); return status === 200 ? z.object({ objectId: z.string().uuid() }).parse(await response.json()).objectId : ''; }
  async function work() { return workSnapshotSchema.parse(await (await call(`work?projectId=${projectId}`, developer)).json()); }
  async function task(id: string) { const item = (await work()).tasks.find((entry) => entry.id === id); assert.ok(item); return item; }
  async function assignments() { return assignmentSnapshotSchema.parse(await (await call(`assignments?projectId=${projectId}`, developer)).json()); }
  async function personal() { return personalSnapshotSchema.parse(await (await call('personal?scope=mine', developer)).json()); }
  async function review(id: string) { const response = await call(`tasks/impact?taskId=${id}&intent=complete_task`, developer); assert.equal(response.status, 200); return taskImpactSchema.parse(await response.json()); }
  async function end(id: string) { const current = await review(id); await write('tasks/commands', { action: 'complete_task', taskId: id, version: current.version, confirmation: current.confirmation }); }
  const org = organizationSnapshotSchema.parse(await (await call('organization', leader)).json());
  const group = org.groups.find((entry) => entry.leaderId !== ownerId && entry.memberIds.includes(ownerId)); assert.ok(group);
  const parentId = await write('work/commands', { action: 'create_task', projectId, title: '拆分验收父任务', description: '', acceptance: '', operationId: randomUUID() });
  const assignmentId = await write('assignments/commands', { action: 'assign', taskId: parentId, accountId: ownerId, groupId: group.id, content: '需要迁移的有效责任', operationId: randomUUID() }, leader);
  await write('assignments/commands', { action: 'start', assignmentId, version: 0 });
  await write('assignments/commands', { action: 'record_progress', assignmentId, version: 1, occurredOn: '2026-10-13', reportWeek: '2026-10-12', content: '拆分前的真实进展', operationId: randomUUID() });
  const itemId = await write('personal/commands', { action: 'create_personal', kind: 'work', projectId, assignmentId, title: '随原分工迁移的个人工作', description: '', acceptance: '', categoryId: null, operationId: randomUUID() });
  await write('personal/commands', { action: 'start_personal', itemId, version: 0 });
  const beforeAssignments = await assignments(); const beforePersonal = await personal();
  const before = beforeAssignments.assignments.find((entry) => entry.id === assignmentId); assert.ok(before);
  const keyA = randomUUID(); const keyB = randomUUID();
  const command: SplitCommand = { taskId: parentId, version: 0, operationId: randomUUID(), children: [{ key: keyA, title: '子任务甲', description: '', acceptance: '' }, { key: keyB, title: '子任务乙', description: '', acceptance: '' }], moves: [{ assignmentId, version: before.version, childKey: keyA }] };
  await write('tasks/split', command, manager, 403);
  await write('tasks/split', command, developer, 403);
  await write('tasks/split', { ...command, moves: [] }, leader, 409);
  await write('tasks/split', { ...command, moves: [{ ...command.moves[0], version: 0 }] }, leader, 409);
  assert.equal((await work()).tasks.some((entry) => entry.parentId === parentId), false);
  await write('tasks/split', command, leader); await write('tasks/split', command, leader);
  const children = (await work()).tasks.filter((entry) => entry.parentId === parentId); assert.equal(children.length, 2);
  const childA = children.find((entry) => entry.title === '子任务甲'); const childB = children.find((entry) => entry.title === '子任务乙'); assert.ok(childA && childB);
  assert.ok(children.every((entry) => entry.ownerId === ownerId && entry.startedAt === null && entry.endedAt === null));
  const afterAssignments = await assignments(); const moved = afterAssignments.assignments.find((entry) => entry.id === assignmentId); assert.ok(moved);
  assert.deepEqual(moved, { ...before, taskId: childA.id, originTaskId: parentId, version: before.version + 1 });
  assert.equal(afterAssignments.assignments.length, beforeAssignments.assignments.length);
  assert.deepEqual(afterAssignments.progress, beforeAssignments.progress); assert.deepEqual(await personal(), beforePersonal);
  await write('milestones/commands', { action: 'add_node', taskId: parentId, version: (await task(parentId)).version, expectedOn: '2026-11-01' }, leader);
  await write('milestones/commands', { action: 'add_node', taskId: childA.id, version: (await task(childA.id)).version, expectedOn: '2026-11-05' }, leader);
  assert.equal((await task(parentId)).expectedOn, '2026-11-01');
  assert.equal((await task(childA.id)).expectedOn, '2026-11-05');
  await write('tasks/split', { ...command, taskId: childA.id, version: childA.version, moves: [], operationId: randomUUID() }, leader, 409);
  await write('assignments/commands', { action: 'claim', taskId: parentId, groupId: group.id, content: '', operationId: randomUUID() }, developer, 409);

  // 子任务完成不自动结束父任务；结束父范围也不传播本人状态与实际时间。
  await end(childA.id); assert.equal((await task(parentId)).status, 'not_started');
  const stale = await review(parentId); assert.ok(stale.children.some((entry) => entry.id === childB.id));
  await write('tasks/commands', { action: 'task_progress', taskId: childB.id, version: childB.version, progress: 30 });
  await write('tasks/commands', { action: 'complete_task', taskId: parentId, version: stale.version, confirmation: stale.confirmation }, developer, 409);
  await end(parentId);
  assert.equal((await task(childB.id)).status, 'completed'); assert.equal((await task(childB.id)).endedAt, null);
  assert.deepEqual(await assignments(), afterAssignments);
  const stoppedItem = (await personal()).items.find((entry) => entry.id === itemId); assert.ok(stoppedItem); assert.equal(stoppedItem.status, 'in_progress'); assert.ok(stoppedItem.stopReason);
  await write('tasks/commands', { action: 'reopen_task', taskId: childA.id, version: (await task(childA.id)).version, reason: '不能越过父范围' }, developer, 409);
  await write('tasks/commands', { action: 'reopen_task', taskId: parentId, version: (await task(parentId)).version, reason: '恢复父范围' });
  assert.equal((await task(childA.id)).status, 'completed');
  await write('tasks/commands', { action: 'reopen_task', taskId: childA.id, version: (await task(childA.id)).version, reason: '恢复本子任务' });
  assert.equal((await personal()).items.find((entry) => entry.id === itemId)?.stopReason, null);
  await end(childA.id);
  assert.ok((await work()).tasks.filter((entry) => entry.parentId === parentId).every((entry) => entry.status === 'completed'));
  assert.notEqual((await task(parentId)).status, 'completed');
  assert.ok((await work()).events.some((entry) => entry.action === 'assignment.moved_to_child' && entry.objectId === assignmentId));
  console.log('PASS: single-level split, separate assignment authority, complete migration mapping/version checks, retry without copies, original IDs/history/times preserved, parent execution rejection and parent-child completion/reopening boundaries');
}
