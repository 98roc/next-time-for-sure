import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { workSnapshotSchema, assignmentSnapshotSchema, personalSnapshotSchema, taskImpactSchema } from '@ntfs/contracts';
import type { MilestoneCommand } from '@ntfs/contracts';
import type { WorkFixture, Session } from '../organization/integration-smoke.js';

/** 实际API覆盖独立目标、多个关联、负责人确认、并发及执行历史保留。 */
export async function verifyMilestones(fixture: WorkFixture, taskId: string): Promise<void> {
  const { call, leader, developer, manager, admin, projectId, ownerId, otherProjectId } = fixture;
  async function snapshot() { return workSnapshotSchema.parse(await (await call(`work?projectId=${projectId}`, developer)).json()); }
  async function task(id: string) { const result = (await snapshot()).tasks.find((entry) => entry.id === id); assert.ok(result); return result; }
  async function node(id: string) { const result = (await snapshot()).milestones.find((entry) => entry.id === id); assert.ok(result); return result; }
  async function execute(command: MilestoneCommand, auth: Session = leader, expected = 200) {
    const response = await call('milestones/commands', auth, command); assert.equal(response.status, expected, JSON.stringify(await response.clone().json()));
    return expected === 200 ? z.object({ objectId: z.string().uuid() }).parse(await response.json()).objectId : '';
  }
  const create: MilestoneCommand = { action: 'create_node', projectId, ownerId, title: '节点验收', expectedOn: '2026-11-03', operationId: randomUUID() };
  const originalTasks = (await snapshot()).tasks;
  await execute(create, manager, 403); await execute(create, admin, 403);
  await execute({ ...create, projectId: otherProjectId }, developer, 403);
  const id = await execute(create); assert.equal(await execute(create), id);
  await execute({ ...create, title: '同键不同内容' }, leader, 409);
  const second = await execute({ ...create, title: '同日第二目标', operationId: randomUUID() }, developer);
  assert.deepEqual((await snapshot()).tasks, originalTasks);
  assert.equal((await snapshot()).milestones.filter((entry) => entry.expectedOn === create.expectedOn).length, 2);

  // 原任务只增加关联，分工、个人执行和任务自身日期不变。
  const assignmentsBefore = assignmentSnapshotSchema.parse(await (await call(`assignments?projectId=${projectId}`, developer)).json());
  const personalBefore = personalSnapshotSchema.parse(await (await call('personal?scope=mine', developer)).json());
  const original = await task(taskId);
  await execute({ action: 'link_task', taskId, milestoneId: id, version: original.version }, manager, 403);
  await execute({ action: 'link_task', taskId, milestoneId: id, version: original.version }, developer);
  assert.equal((await task(taskId)).milestoneId, id);
  const taskResponse = await call('work/commands', developer, { action: 'create_task', projectId, title: '目标下第二任务', description: '', acceptance: '', milestoneId: id, operationId: randomUUID() });
  assert.equal(taskResponse.status, 200);
  const linkedId = z.object({ objectId: z.string() }).parse(await taskResponse.json()).objectId;
  assert.equal((await snapshot()).tasks.filter((entry) => entry.milestoneId === id).length, 2);
  const foreignResponse = await call('milestones/commands', leader, { ...create, projectId: otherProjectId, ownerId: z.object({ id: z.string() }).parse(await (await call('auth/me', leader)).json()).id, operationId: randomUUID() });
  assert.equal(foreignResponse.status, 200);
  const foreignId = z.object({ objectId: z.string() }).parse(await foreignResponse.json()).objectId;
  await execute({ action: 'link_task', taskId, milestoneId: foreignId, version: (await task(taskId)).version }, leader, 409);

  // 目标日期并发竞争只允许一个版本成功，不反向覆盖任务日期。
  const current = await node(id);
  const results = await Promise.all([null, '2026-11-05'].map((expectedOn) => call('milestones/commands', leader, { action: 'reschedule_node', milestoneId: id, version: current.version, expectedOn, reason: '调整日期' })));
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
  assert.equal((await task(taskId)).expectedOn, original.expectedOn);
  const preview = taskImpactSchema.parse(await (await call(`tasks/impact?taskId=${linkedId}&intent=complete_task`, developer)).json());
  assert.equal((await call('tasks/commands', developer, { action: 'complete_task', taskId: linkedId, version: preview.version, confirmation: preview.confirmation })).status, 200);
  assert.equal((await node(id)).status, 'open');
  await execute({ action: 'complete_node', milestoneId: id, version: (await node(id)).version }, leader, 403);
  await execute({ action: 'complete_node', milestoneId: id, version: (await node(id)).version }, developer);
  assert.equal((await node(id)).status, 'completed');
  assert.equal((await task(taskId)).status, original.status);
  await execute({ action: 'reopen_node', milestoneId: id, version: (await node(id)).version, reason: '补充验收' }, developer);

  await execute({ action: 'remove_node', milestoneId: id, version: (await node(id)).version, reason: '移出目标保留执行' });
  assert.equal((await task(taskId)).milestoneId, null);
  assert.equal((await task(linkedId)).milestoneId, null);
  assert.deepEqual(assignmentSnapshotSchema.parse(await (await call(`assignments?projectId=${projectId}`, developer)).json()), assignmentsBefore);
  assert.deepEqual(personalSnapshotSchema.parse(await (await call('personal?scope=mine', developer)).json()), personalBefore);
  await execute({ action: 'link_task', taskId, milestoneId: id, version: (await task(taskId)).version }, developer, 409);
  await execute({ action: 'link_task', taskId, milestoneId: second, version: (await task(taskId)).version }, developer);
  assert.ok((await snapshot()).events.some((entry) => entry.objectId === id && entry.action === 'milestone.reschedule_node' && entry.payload.before && entry.payload.after));
  console.log('PASS: independent milestone creation, multiple tasks, atomic task creation/link, project/owner boundaries, concurrent dates, manual completion and preserved execution records');
}
