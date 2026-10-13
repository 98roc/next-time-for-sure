import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assignmentSnapshotSchema, organizationSnapshotSchema, workSnapshotSchema } from '@ntfs/contracts';
import type { AssignmentCommand } from '@ntfs/contracts';
import type { Session, WorkFixture } from '../organization/integration-smoke.js';

/** 真实HTTP验证多组成员的责任边界、本人事实及转交历史。 */
export async function verifyAssignments(fixture: WorkFixture, firstTask: string, secondTask: string): Promise<void> {
  const { call, leader, developer, projectId, ownerId } = fixture;
  const organization = organizationSnapshotSchema.parse(await (await call('organization', leader)).json());
  const ownGroup = organization.groups.find((group) => group.leaderId === ownerId);
  const otherGroup = organization.groups.find((group) => group.leaderId !== ownerId);
  assert.ok(ownGroup && otherGroup);
  const leaderId = otherGroup.leaderId;
  async function execute(command: AssignmentCommand, auth: Session, expected = 200): Promise<string> {
    const response = await call('assignments/commands', auth, command);
    assert.equal(response.status, expected, `assignment.${command.action}`);
    return expected === 200 ? z.object({ objectId: z.string().uuid() }).parse(await response.json()).objectId : '';
  }
  async function state() {
    const response = await call(`assignments?projectId=${projectId}`, developer); assert.equal(response.status, 200);
    return assignmentSnapshotSchema.parse(await response.json());
  }
  const claim: AssignmentCommand = { action: 'claim', taskId: firstTask, groupId: ownGroup.id, content: '', operationId: randomUUID() };
  const claimed = await execute(claim, developer); assert.equal(await execute(claim, developer), claimed);
  await execute({ ...claim, operationId: randomUUID() }, developer, 409);
  await execute({ action: 'start', assignmentId: claimed, version: 0 }, leader, 403);
  await execute({ action: 'start', assignmentId: claimed, version: 0 }, developer);
  const progress: AssignmentCommand = { action: 'record_progress', assignmentId: claimed, version: 1, occurredOn: '2026-10-13', reportWeek: '2026-10-12', content: '完成接口核对', operationId: randomUUID() };
  const progressId = await execute(progress, developer); assert.equal(await execute(progress, developer), progressId);
  await execute({ ...progress, operationId: randomUUID(), version: 2, content: '补充另一条进展' }, developer);
  assert.equal((await state()).progress.length, 2);
  await execute({ action: 'correct_times', assignmentId: claimed, version: 3, startedAt: '2026-10-13T01:00:00Z', endedAt: null }, leader, 403);
  await execute({ action: 'complete', assignmentId: claimed, version: 3 }, developer);
  let entry = (await state()).assignments.find((assignment) => assignment.id === claimed); assert.ok(entry?.startedAt && entry.endedAt);
  await execute({ action: 'start', assignmentId: claimed, version: entry.version }, developer);
  const history = workSnapshotSchema.parse(await (await call(`work?projectId=${projectId}`, developer)).json());
  const reopened = history.events.find((event) => event.action === 'assignment.start' && z.object({ status: z.literal('completed'), endedAt: z.string() }).safeParse(event.payload.before).success);
  assert.ok(reopened, '恢复执行必须保留此前完成时间快照');
  entry = (await state()).assignments.find((assignment) => assignment.id === claimed); assert.ok(entry); assert.equal(entry.endedAt, null);
  await execute({ action: 'exit', assignmentId: claimed, version: entry.version, reason: '重新协调' }, developer);
  await execute({ action: 'start', assignmentId: claimed, version: entry.version + 1 }, developer, 409);
  const assigned = await execute({ action: 'assign', taskId: secondTask, accountId: ownerId, groupId: otherGroup.id, content: '他组负责安排', operationId: randomUUID() }, leader);
  await execute({ action: 'adjust', assignmentId: assigned, groupId: ownGroup.id, content: '越权调整', version: 0 }, developer, 403);
  await execute({ action: 'exit', assignmentId: assigned, reason: '尝试退出管理安排', version: 0 }, developer, 403);
  await execute({ action: 'start', assignmentId: assigned, version: 0 }, developer);
  const transfer: AssignmentCommand = { action: 'transfer', assignmentId: assigned, accountId: leaderId, groupId: otherGroup.id, content: '交接工作', reason: '人员协调', version: 1, operationId: randomUUID() };
  const successor = await execute(transfer, leader); assert.equal(await execute(transfer, leader), successor);
  const after = await state();
  const old = after.assignments.find((assignment) => assignment.id === assigned);
  const next = after.assignments.find((assignment) => assignment.id === successor);
  assert.equal(old?.status, 'transferred'); assert.ok(old?.transferredAt); assert.equal(old?.endedAt, null);
  assert.equal(next?.status, 'not_started'); assert.equal(next?.startedAt, null);
  await execute({ action: 'start', assignmentId: assigned, version: 2 }, developer, 409);
  await execute({ action: 'record_progress', assignmentId: assigned, occurredOn: '2026-10-13', reportWeek: '2026-10-12', content: '原人员补记交接前事实', version: 2, operationId: randomUUID() }, developer);
  const current = organizationSnapshotSchema.parse(await (await call('organization', leader)).json());
  assert.ok(current.projects.find((project) => project.id === projectId)?.members.some((member) => member.accountId === leaderId && member.roles.includes('developer')));
  console.log('PASS: assignment scope, multi-group rejection, claim replay, own-only execution, multiple progress entries, exit source rules, transfer replay/history and automatic project membership');
}
