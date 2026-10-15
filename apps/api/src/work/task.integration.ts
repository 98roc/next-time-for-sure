import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assignmentCompletionSchema, assignmentSnapshotSchema, personalSnapshotSchema, taskImpactSchema, workSnapshotSchema } from '@ntfs/contracts';
import type { TaskCommand } from '@ntfs/contracts';
import type { Session, WorkFixture } from '../organization/integration-smoke.js';

/** 整体结束真实验收：权限、过期确认、个人事实保留、停止执行及本人收尾。 */
export async function verifyTasks(fixture: WorkFixture, taskId: string): Promise<void> {
  const { call, developer, leader, manager, projectId, ownerId } = fixture;
  async function task() { const state = workSnapshotSchema.parse(await (await call(`work?projectId=${projectId}`, developer)).json()); const entry = state.tasks.find((item) => item.id === taskId); assert.ok(entry); return entry; }
  async function personal() { return personalSnapshotSchema.parse(await (await call('personal?scope=mine', developer)).json()); }
  async function assignments() { return assignmentSnapshotSchema.parse(await (await call(`assignments?projectId=${projectId}`, developer)).json()); }
  async function review(intent = 'complete_task', auth = developer) { const response = await call(`tasks/impact?taskId=${taskId}&intent=${intent}`, auth); assert.equal(response.status, 200); return taskImpactSchema.parse(await response.json()); }
  async function execute(command: TaskCommand, auth: Session = developer, expected = 200) { assert.equal((await call('tasks/commands', auth, command)).status, expected, command.action); }
  let current = await task();
  assert.equal((await call(`tasks/impact?taskId=${taskId}&intent=complete_task`, leader)).status, 403);
  await execute({ action: 'start_task', taskId, version: current.version }, manager, 403);
  await execute({ action: 'start_task', taskId, version: current.version });
  current = await task(); assert.ok(current.startedAt); const firstStart = current.startedAt;
  await execute({ action: 'task_progress', taskId, version: current.version, progress: 100 });
  assert.equal((await task()).status, 'in_progress');
  const beforeAssignments = await assignments();
  const assignment = beforeAssignments.assignments.find((entry) => entry.taskId === taskId && !['exited', 'transferred'].includes(entry.status)); assert.ok(assignment);
  const item = (await personal()).items.find((entry) => entry.assignmentId === assignment.id); assert.ok(item);
  const stale = await review(); assert.ok(stale.assignments.length); assert.ok(stale.personal.length);
  assert.equal((await call('personal/commands', developer, { action: 'personal_progress', itemId: item.id, version: item.version, occurredOn: '2026-10-13', reportWeek: '2026-10-12', content: '确认期间有新进展', operationId: randomUUID() })).status, 200);
  await execute({ action: 'complete_task', taskId, version: stale.version, confirmation: stale.confirmation }, developer, 409);
  const finalReview = await review();
  const beforePersonal = await personal();
  const beforeCompletion = await assignments();
  await execute({ action: 'complete_task', taskId, version: finalReview.version, confirmation: finalReview.confirmation });
  current = await task(); assert.equal(current.status, 'completed'); assert.ok(current.endedAt); assert.equal(current.inMilestone, true);
  assert.deepEqual(await assignments(), beforeCompletion);
  const afterPersonal = await personal();
  assert.deepEqual(afterPersonal.items.map((entry) => ({ ...entry, stopReason: null })), beforePersonal.items.map((entry) => ({ ...entry, stopReason: null })));
  const stoppedItem = afterPersonal.items.find((entry) => entry.id === item.id); assert.ok(stoppedItem?.stopReason);
  assert.equal((await call('personal/commands', developer, { action: 'start_personal', itemId: item.id, version: stoppedItem.version })).status, 409);
  assert.equal((await call('assignments/commands', developer, { action: 'start', assignmentId: assignment.id, version: assignment.version })).status, 409);
  assert.equal((await call('personal/commands', developer, { action: 'create_personal', kind: 'work', projectId, assignmentId: assignment.id, title: '不能绕过整体结束', description: '', acceptance: '', categoryId: null, operationId: randomUUID() })).status, 409);

  // 本人可以主动确认收尾，但整体结束本身不能产生该成员的完成事实。
  const completion = assignmentCompletionSchema.parse(await (await call(`assignments/completion?assignmentId=${assignment.id}`, developer)).json());
  assert.equal((await call('assignments/commands', developer, { action: 'complete', assignmentId: assignment.id, version: completion.assignmentVersion, confirmation: completion.confirmation })).status, 200);
  assert.equal((await personal()).items.find((entry) => entry.id === item.id)?.status, stoppedItem.status);
  await execute({ action: 'reopen_task', taskId, version: current.version, reason: '继续后续工作' }, leader);
  current = await task(); assert.equal(current.startedAt, firstStart); assert.equal(current.endedAt, null);
  assert.equal((await assignments()).assignments.find((entry) => entry.id === assignment.id)?.status, 'completed');
  const completePreview = await review(); const cancelPreview = await review('cancel_task', leader);
  await execute({ action: 'cancel_task', taskId, version: current.version, reason: '不再执行', confirmation: completePreview.confirmation }, leader, 409);
  await execute({ action: 'cancel_task', taskId, version: current.version, reason: '不再执行', confirmation: cancelPreview.confirmation }, leader);
  assert.equal((await task()).status, 'cancelled'); assert.equal((await task()).endedAt, null);
  current = await task();
  const retainedAssignments = await assignments();
  const retainedPersonal = await personal();
  const times = { action: 'task_times', taskId, version: current.version, startedAt: '2026-10-01T01:00:00.000Z', endedAt: '2026-10-02T02:00:00.000Z' } satisfies TaskCommand;
  await execute(times, leader, 403);
  await execute({ ...times, startedAt: '2026-10-03T01:00:00.000Z' }, developer, 400);
  await execute(times);
  await execute(times, developer, 409);
  current = await task();
  assert.equal(current.status, 'cancelled');
  assert.ok(current.startedAt && current.endedAt);
  assert.equal(Date.parse(current.startedAt), Date.parse(times.startedAt));
  assert.equal(Date.parse(current.endedAt), Date.parse(times.endedAt));
  assert.deepEqual(await assignments(), retainedAssignments);
  assert.deepEqual(await personal(), retainedPersonal);
  await execute({ action: 'change_owner', taskId, version: current.version, ownerId }, manager, 403);
  await execute({ action: 'change_owner', taskId, version: current.version, ownerId }, leader);
  const state = workSnapshotSchema.parse(await (await call(`work?projectId=${projectId}`, developer)).json());
  assert.ok(state.events.some((event) => event.action === 'task.reopen_task' && event.objectId === taskId));
  console.log('PASS: task owner authority, explicit completion at 100 percent, stale impact rejection, milestone association preservation, independent personal facts/times, stopped-work rejection, own cleanup, reopening history and intent-bound cancellation');
}
