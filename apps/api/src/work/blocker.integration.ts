import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { notificationsSchema } from '@ntfs/contracts';
import { z } from 'zod';
import { assignmentSnapshotSchema, organizationSnapshotSchema, personalSnapshotSchema, taskImpactSchema, workSnapshotSchema } from '@ntfs/contracts';
import type { WorkFixture, Session } from '../organization/integration-smoke.js';

/** 阻塞、管理关联的真实边界：独立状态、不能代改或越过原负责小组。 */
export async function verifyBlockers(fixture: WorkFixture): Promise<void> {
  const { call, developer, leader, manager, projectId, ownerId, otherProjectId } = fixture;
  async function write(path: string, input: unknown, auth: Session = developer, expected = 200) { const response = await call(path, auth, input); assert.equal(response.status, expected, path); return expected === 200 ? z.object({ objectId: z.string() }).parse(await response.json()).objectId : ''; }
  async function work() { return workSnapshotSchema.parse(await (await call(`work?projectId=${projectId}`, developer)).json()); }
  async function task(id: string) { const entry = (await work()).tasks.find((item) => item.id === id); assert.ok(entry); return entry; }
  async function assignments() { return assignmentSnapshotSchema.parse(await (await call(`assignments?projectId=${projectId}`, developer)).json()); }
  async function items() { return personalSnapshotSchema.parse(await (await call('personal?scope=mine', developer)).json()); }
  const create = (title: string) => write('work/commands', { action: 'create_task', projectId, title, description: '', acceptance: '', operationId: randomUUID() });
  const id = await create('页面验收：接口联调'); const waiting = await create('页面验收：环境准备');
  const org = organizationSnapshotSchema.parse(await (await call('organization', leader)).json());
  const ownGroup = org.groups.find((entry) => entry.leaderId === ownerId); const otherGroup = org.groups.find((entry) => entry.leaderId !== ownerId); assert.ok(ownGroup && otherGroup);
  const assignmentId = await write('assignments/commands', { action: 'assign', taskId: id, accountId: ownerId, groupId: otherGroup.id, content: '接口联调工作', operationId: randomUUID() }, leader);
  const secondAssignment = await write('assignments/commands', { action: 'assign', taskId: waiting, accountId: ownerId, groupId: ownGroup.id, content: '环境准备工作', operationId: randomUUID() }, leader);
  const blocker = { action: 'task_blocker', taskId: id, version: 0, blockedReason: '等待环境', waitingFor: '测试环境', waitingTaskId: waiting };
  await write('tasks/commands', blocker, manager, 403);
  await write('tasks/commands', { ...blocker, waitingTaskId: id }, developer, 400);
  await write('tasks/commands', blocker);
  await write('assignments/commands', { action: 'assignment_blocker', assignmentId, version: 0, blockedReason: '本人等待账号', waitingFor: '', waitingTaskId: null }, leader, 403);
  await write('assignments/commands', { action: 'assignment_blocker', assignmentId, version: 0, blockedReason: '本人等待账号', waitingFor: '', waitingTaskId: null });
  assert.equal((await task(id)).status, 'not_started');
  await write('tasks/commands', { action: 'start_task', taskId: id, version: (await task(id)).version });
  const preview = taskImpactSchema.parse(await (await call(`tasks/impact?taskId=${waiting}&intent=complete_task`, developer)).json());
  await write('tasks/commands', { action: 'complete_task', taskId: waiting, version: preview.version, confirmation: preview.confirmation });
  const notifications = notificationsSchema.parse(await (await call('notifications', developer)).json());
  assert.equal(notifications.filter((entry) => entry.title.includes('等待的关联工作')).length, 1);
  assert.equal((await task(id)).blockedReason, '等待环境');
  await write('tasks/commands', { action: 'task_blocker', taskId: id, version: (await task(id)).version, blockedReason: '', waitingFor: '应清空', waitingTaskId: waiting });
  assert.equal((await task(id)).waitingTaskId, null);
  assert.equal((await assignments()).assignments.find((entry) => entry.id === assignmentId)?.blockedReason, '本人等待账号');
  await write('tasks/commands', { action: 'reopen_task', taskId: waiting, version: (await task(waiting)).version, reason: '继续验收关联' });
  const itemId = await write('personal/commands', { action: 'create_personal', kind: 'work', projectId, assignmentId: null, title: '页面验收：个人接口检查', description: '', acceptance: '', categoryId: null, operationId: randomUUID() });
  const privateId = await write('personal/commands', { action: 'create_personal', kind: 'private', projectId: null, assignmentId: null, title: '页面验收：私人事项', description: '', acceptance: '', categoryId: null, operationId: randomUUID() });
  const before = (await items()).items.find((entry) => entry.id === itemId); assert.ok(before);
  await write('personal/commands', { action: 'manage_link', itemId: privateId, assignmentId, version: 0 }, leader, 403);
  await write('personal/commands', { action: 'manage_link', itemId, assignmentId, version: 0 }, manager, 403);
  await write('personal/commands', { action: 'manage_link', itemId, assignmentId, version: 0 }, leader);
  await write('personal/commands', { action: 'manage_link', itemId, assignmentId: secondAssignment, version: 1 }, developer, 403);
  await write('personal/commands', { action: 'manage_link', itemId, assignmentId: secondAssignment, version: 1 }, leader);
  assert.equal(notificationsSchema.parse(await (await call('notifications', developer)).json()).filter((entry) => entry.title.includes('管理者调整')).length, 2);
  const after = (await items()).items.find((entry) => entry.id === itemId); assert.ok(after);
  assert.deepEqual({ ...after, assignmentId: before.assignmentId, version: before.version }, before);
  assert.equal((await call('work?projectId=' + otherProjectId, developer)).status, 403);
  // 组长不需要加入每个项目，但只能管理本组成员的关联，不能获得项目整体访问。
  const teamLeaderId = org.teams.find((team) => team.id === ownGroup.teamId)?.leaderId; assert.ok(teamLeaderId);
  const externalTask = await write('work/commands', { action: 'create_task', projectId: otherProjectId, title: '跨项目本组工作', description: '', acceptance: '', operationId: randomUUID() }, leader);
  const externalAssignment = await write('assignments/commands', { action: 'assign', taskId: externalTask, accountId: teamLeaderId, groupId: ownGroup.id, content: '本组成员跨项目分工', operationId: randomUUID() }, leader);
  const externalItem = await write('personal/commands', { action: 'create_personal', kind: 'work', projectId: otherProjectId, assignmentId: null, title: '跨项目个人工作', description: '', acceptance: '', categoryId: null, operationId: randomUUID() }, leader);
  const scoped = await call(`assignments?projectId=${otherProjectId}`, developer); assert.equal(scoped.status, 200);
  assert.ok(assignmentSnapshotSchema.parse(await scoped.json()).assignments.some((entry) => entry.id === externalAssignment));
  await write('personal/commands', { action: 'manage_link', itemId: externalItem, assignmentId: externalAssignment, version: 0 }, developer);
  assert.equal((await call(`work?projectId=${otherProjectId}`, developer)).status, 403);
  const milestoneId = await write('milestones/commands', { action: 'create_node', projectId, ownerId, title: '联调目标', expectedOn: '2026-11-01', operationId: randomUUID() }, leader);
  for (const taskId of [id, waiting]) await write('milestones/commands', { action: 'link_task', taskId, milestoneId, version: (await task(taskId)).version }, leader);
  console.log('PASS: independent team/own blockers, manual clearing, dependency completion does not clear or restrict execution, managed link scope/private protection and unchanged personal facts');
}
