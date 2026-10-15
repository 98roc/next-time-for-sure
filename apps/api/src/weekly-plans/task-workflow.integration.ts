import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assignmentSnapshotSchema, organizationSnapshotSchema, planPublicationsSchema, publicationPreviewSchema, weeklyCandidatesSchema, weeklyDraftResponseSchema } from '@ntfs/contracts';
import type { Session, WorkFixture } from '../organization/integration-smoke.js';

/** 真实HTTP和数据库回读验证连续编排、整批回滚、权限、并发以及发布历史冻结。 */
export async function verifyTaskWorkflow({ call, leader, developer, manager, projectId, ownerId }: WorkFixture) {
  const org = organizationSnapshotSchema.parse(await (await call('organization', leader)).json());
  const team = org.teams[0]; const own = org.groups.find((group) => group.leaderId === ownerId); const other = org.groups.find((group) => group.leaderId !== ownerId);
  assert.ok(team && own && other);
  const teamId = team.id; const week = '2030-01-07'; const targetWeek = '2030-01-14';
  async function write(path: string, body: unknown, auth: Session = leader) {
    const response = await call(path, auth, body); const result: unknown = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result)); return z.object({ objectId: z.string().uuid() }).parse(result).objectId;
  }
  const create = () => write('work/commands', { action: 'create_task', projectId, title: '连续编排验收', description: '', acceptance: '', operationId: randomUUID() }, developer);
  const taskId = await create();
  const assignments = async () => assignmentSnapshotSchema.parse(await (await call(`assignments?projectId=${projectId}`, leader)).json()).assignments;
  const draft = async (target = week) => weeklyDraftResponseSchema.parse(await (await call(`weekly-plans?teamId=${teamId}&week=${target}`, leader)).json()).draft;
  const candidates = async () => weeklyCandidatesSchema.parse(await (await call(`weekly-plans/candidates?teamId=${teamId}&week=${week}`, leader)).json()).assignments;
  const publications = async () => planPublicationsSchema.parse(await (await call(`weekly-plans/publications?teamId=${teamId}&week=${week}`, leader)).json()).publications;
  const members = [{ accountId: ownerId, groupId: own.id, content: '接口' }, { accountId: team.leaderId, groupId: other.id, content: '联调' }];
  const assign = { action: 'assign_many', taskId, members, operationId: randomUUID() };
  assert.equal((await call('assignments/commands', manager, assign)).status, 403);
  assert.equal((await call('assignments/commands', developer, assign)).status, 403);
  assert.equal((await call('assignments/commands', leader, { ...assign, members: [...members, members[0]] })).status, 400);
  assert.equal((await call('assignments/commands', leader, { ...assign, members: [members[0], { accountId: randomUUID(), groupId: other.id, content: '' }] })).status, 400);
  assert.equal((await assignments()).length, 0);
  assert.equal(await write('assignments/commands', assign), taskId);
  assert.equal(await write('assignments/commands', assign), taskId);
  assert.equal((await assignments()).length, 2);
  assert.equal((await call('assignments/commands', leader, { ...assign, operationId: randomUUID() })).status, 409);
  const rows = (await candidates()).filter((entry) => entry.taskId === taskId).map((entry) => ({ assignmentId: entry.assignmentId, assignmentVersion: entry.assignmentVersion, taskVersion: entry.taskVersion, version: null, goal: '', expectedProgress: null, plannedDays: null }));
  assert.equal(rows.length, 2);
  const batch = { action: 'save_arrangements', teamId, week, arrangements: rows };
  assert.equal((await call('weekly-plans/commands', manager, batch)).status, 403);
  assert.equal((await call('weekly-plans/commands', developer, batch)).status, 409);
  assert.equal((await draft())?.arrangements.length ?? 0, 0);
  assert.ok(rows[1]);
  assert.equal((await call('weekly-plans/commands', leader, { ...batch, arrangements: [rows[0], { ...rows[1], taskVersion: 999 }] })).status, 409);
  assert.equal((await draft())?.arrangements.length ?? 0, 0);
  await write('weekly-plans/commands', batch);
  assert.equal((await draft())?.arrangements.length, 2);
  const preview = publicationPreviewSchema.parse(await (await call(`weekly-plans/preview?teamId=${teamId}&week=${week}`, leader)).json());
  await write('weekly-plans/commands', { action: 'publish_plan', teamId, week, confirmation: preview.confirmation, reason: '首次安排基线' });
  const frozen = JSON.stringify(await publications());
  assert.equal((await draft())?.hasUnpublishedChanges, false);
  const first = (await draft())?.arrangements[0]; assert.ok(first);
  const candidate = rows.find((row) => row.assignmentId === first.assignmentId); assert.ok(candidate);
  const update = { action: 'save_arrangement', teamId, week, ...candidate, version: first.version, goal: '周中调整', plannedDays: '1.50' };
  const races = await Promise.all([call('weekly-plans/commands', leader, update), call('weekly-plans/commands', leader, { ...update, goal: '并发调整' })]);
  assert.deepEqual(races.map((response) => response.status).sort(), [200, 409]);
  assert.equal((await draft())?.hasUnpublishedChanges, true);
  assert.equal(JSON.stringify(await publications()), frozen);

  // 移周保持目标周人工安排；源版本或目标版本过期都必须整笔拒绝。
  const source = (await draft())?.arrangements.find((row) => row.id === first.id); assert.ok(source);
  await write('weekly-plans/commands', { ...update, week: targetWeek, version: null, goal: '目标周已有人工内容' });
  const move = { action: 'move_arrangement', teamId, week, arrangementId: source.id, version: source.version, targetWeek, targetVersion: 0 };
  assert.equal((await call('weekly-plans/commands', leader, { ...move, targetVersion: null })).status, 409);
  assert.equal((await draft())?.arrangements.length, 2);
  await write('weekly-plans/commands', move);
  assert.equal((await draft())?.arrangements.length, 1);
  assert.equal((await draft(targetWeek))?.arrangements[0]?.goal, '目标周已有人工内容');
  assert.equal(JSON.stringify(await publications()), frozen);
  assert.equal((await call('weekly-plans/commands', leader, move)).status, 409);
  const remaining = (await draft())?.arrangements[0]; assert.ok(remaining);
  await write('weekly-plans/commands', { action: 'move_arrangement', teamId, week, arrangementId: remaining.id, version: remaining.version, targetWeek: '2030-01-21', targetVersion: null });
  assert.equal((await draft('2030-01-21'))?.arrangements.length, 1);
  assert.equal((await draft())?.arrangements.length, 0);

  // 周中换人沿用原分工历史，新接手人需要显式重新排周，不假造执行事实。
  const transferTask = await create();
  const original = await write('assignments/commands', { action: 'assign', taskId: transferTask, accountId: ownerId, groupId: own.id, content: '', operationId: randomUUID() });
  const originalCandidate = (await candidates()).find((row) => row.assignmentId === original); assert.ok(originalCandidate);
  await write('weekly-plans/commands', { action: 'save_arrangement', teamId, week, assignmentId: original, assignmentVersion: originalCandidate.assignmentVersion, taskVersion: originalCandidate.taskVersion, version: null, goal: '', expectedProgress: null, plannedDays: null });
  const replacement = await write('assignments/commands', { action: 'transfer', assignmentId: original, version: 0, accountId: team.leaderId, groupId: own.id, content: '', reason: '周中换人', operationId: randomUUID() });
  assert.equal((await assignments()).find((row) => row.id === original)?.status, 'transferred');
  assert.equal((await assignments()).find((row) => row.id === replacement)?.status, 'not_started');
  assert.equal((await draft())?.arrangements.some((row) => row.assignmentId === replacement), false);
  assert.equal((await candidates()).some((row) => row.assignmentId === original), false);
  assert.equal(JSON.stringify(await publications()), frozen);
  // 真实本周移到自动延续的下周空壳，应携带目标及投入，不能被读取时生成的空记录吞掉。
  const calendar = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}T00:00:00Z`);
  calendar.setUTCDate(calendar.getUTCDate() - (calendar.getUTCDay() + 6) % 7);
  const currentWeek = calendar.toISOString().slice(0, 10); calendar.setUTCDate(calendar.getUTCDate() + 7); const followingWeek = calendar.toISOString().slice(0, 10);
  const newCandidate = (await candidates()).find((row) => row.assignmentId === replacement); assert.ok(newCandidate);
  await write('weekly-plans/commands', { action: 'save_arrangement', teamId, week: currentWeek, assignmentId: replacement, assignmentVersion: newCandidate.assignmentVersion, taskVersion: newCandidate.taskVersion, version: null, goal: '随移周保留', expectedProgress: 25, plannedDays: '1.50' });
  const currentRow = (await draft(currentWeek))?.arrangements.find((row) => row.assignmentId === replacement); assert.ok(currentRow);
  const autoRow = (await draft(followingWeek))?.arrangements.find((row) => row.assignmentId === replacement); assert.ok(autoRow && autoRow.sourceWeek);
  await write('weekly-plans/commands', { action: 'move_arrangement', teamId, week: currentWeek, arrangementId: currentRow.id, version: currentRow.version, targetWeek: followingWeek, targetVersion: autoRow.version });
  const movedRow = (await draft(followingWeek))?.arrangements.find((row) => row.assignmentId === replacement);
  assert.equal(movedRow?.goal, '随移周保留'); assert.equal(movedRow.plannedDays, '1.50'); assert.equal(movedRow.expectedProgress, 25);
  console.log('PASS: continuous task workflow, batch atomicity/idempotency, scoped permissions, concurrent edits, atomic week move, transfer and publication freeze');
}
