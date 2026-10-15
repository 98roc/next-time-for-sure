import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assignmentSnapshotSchema, organizationSnapshotSchema, workSnapshotSchema } from '@ntfs/contracts';
import type { Session, WorkFixture } from '../organization/integration-smoke.js';

/** 真实API回归误开始撤销，验证权限、竞争、时间清理、历史保留及已有进展拒绝。 */
export async function verifyUndoStart({ call, developer, manager, leader, projectId }: WorkFixture): Promise<void> {
  async function create(title: string) {
    const response = await call('work/commands', developer, { action: 'create_task', projectId, title, description: '', acceptance: '', operationId: randomUUID() });
    assert.equal(response.status, 200);
    return z.object({ objectId: z.string() }).parse(await response.json()).objectId;
  }
  async function snapshot() { return workSnapshotSchema.parse(await (await call(`work?projectId=${projectId}`, developer)).json()); }
  async function task(id: string) { const found = (await snapshot()).tasks.find((entry) => entry.id === id); assert.ok(found); return found; }
  async function execute(body: unknown, status = 200, auth: Session = developer) {
    const response = await call('tasks/commands', auth, body);
    assert.equal(response.status, status, await response.text());
  }
  const id = await create('误开始可撤销');
  await execute({ action: 'undo_start_task', taskId: id, version: 0 }, 409);
  await execute({ action: 'start_task', taskId: id, version: 0 });
  let current = await task(id); assert.ok(current.startedAt);
  const undo = { action: 'undo_start_task', taskId: id, version: current.version };
  await execute(undo, 403, manager);
  await execute(undo, 403, leader);
  const competing = await Promise.all([call('tasks/commands', developer, undo), call('tasks/commands', developer, undo)]);
  assert.deepEqual(competing.map((response) => response.status).sort(), [200, 409]);
  current = await task(id);
  assert.equal(current.status, 'not_started'); assert.equal(current.startedAt, null); assert.equal(current.endedAt, null);
  assert.ok((await snapshot()).events.some((event) => event.objectId === id && event.action === 'task.start_task'));
  assert.ok((await snapshot()).events.some((event) => event.objectId === id && event.action === 'task.undo_start_task'));
  await execute({ action: 'start_task', taskId: id, version: current.version });
  current = await task(id); assert.ok(current.startedAt);
  await execute({ action: 'task_progress', taskId: id, version: current.version, progress: 10 });
  current = await task(id);
  await execute({ action: 'undo_start_task', taskId: id, version: current.version }, 409);
  assert.deepEqual(await task(id), current);

  // 时间修正和关联人员执行均不能被一次撤销开始覆盖。
  const corrected = await create('已补录时间不可撤销');
  await execute({ action: 'start_task', taskId: corrected, version: 0 });
  current = await task(corrected);
  await execute({ action: 'task_times', taskId: corrected, version: current.version, startedAt: '2026-10-01T01:00:00.000Z', endedAt: null });
  current = await task(corrected);
  await execute({ action: 'undo_start_task', taskId: corrected, version: current.version }, 409);
  assert.deepEqual(await task(corrected), current);
  const assigned = await create('关联分工已执行不可撤销');
  const organization = organizationSnapshotSchema.parse(await (await call('organization', developer)).json());
  const ownProject = organization.projects.find((entry) => entry.id === projectId); assert.ok(ownProject);
  const owner = (await task(assigned)).ownerId;
  const group = organization.groups.find((entry) => entry.teamId === ownProject.teamId && entry.memberIds.includes(owner)); assert.ok(group);
  const claim = await call('assignments/commands', developer, { action: 'claim', taskId: assigned, groupId: group.id, content: '', operationId: randomUUID() });
  assert.equal(claim.status, 200);
  await execute({ action: 'start_task', taskId: assigned, version: (await task(assigned)).version });
  const assignments = assignmentSnapshotSchema.parse(await (await call(`assignments?projectId=${projectId}`, developer)).json());
  const assignment = assignments.assignments.find((entry) => entry.taskId === assigned); assert.ok(assignment);
  assert.equal((await call('assignments/commands', developer, { action: 'start', assignmentId: assignment.id, version: assignment.version })).status, 200);
  current = await task(assigned);
  await execute({ action: 'undo_start_task', taskId: assigned, version: current.version }, 409);
  assert.deepEqual(await task(assigned), current);

  const linked = await create('关联个人进展不可撤销');
  const linkedClaim = await call('assignments/commands', developer, { action: 'claim', taskId: linked, groupId: group.id, content: '', operationId: randomUUID() });
  assert.equal(linkedClaim.status, 200);
  const linkedAssignment = z.object({ objectId: z.string() }).parse(await linkedClaim.json()).objectId;
  const personal = await call('personal/commands', developer, { action: 'create_personal', kind: 'work', projectId, assignmentId: linkedAssignment, title: '记录个人进展', description: '', acceptance: '', categoryId: null, operationId: randomUUID() });
  assert.equal(personal.status, 200);
  const itemId = z.object({ objectId: z.string() }).parse(await personal.json()).objectId;
  await execute({ action: 'start_task', taskId: linked, version: (await task(linked)).version });
  assert.equal((await call('personal/commands', developer, { action: 'personal_progress', itemId, version: 0, occurredOn: '2026-10-14', reportWeek: '2026-10-12', content: '已完成接口分析', operationId: randomUUID() })).status, 200);
  current = await task(linked);
  await execute({ action: 'undo_start_task', taskId: linked, version: current.version }, 409);
  assert.deepEqual(await task(linked), current);
  console.log('PASS: accidental start undo, owner-only authority, concurrent conflict, cleared mistaken time, retained audit history, progress/time/assignment/personal guards');
}
