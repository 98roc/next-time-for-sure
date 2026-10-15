import { verifyAutomaticCarry } from './carry-forward.integration.js';
import { verifyTaskWorkflow } from './task-workflow.integration.js';
import { verifyTeamDirect } from './team-direct.integration.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { organizationSnapshotSchema, weeklyCandidatesSchema, taskImpactSchema, weeklyDraftSchema } from '@ntfs/contracts';
import { smoke } from '../organization/integration-smoke.js';
import type { Session } from '../organization/integration-smoke.js';
import { reportingSmoke } from './reporting-smoke.js';

/** 周计划首个增量使用真实接口验证跨项目候选与负责小组权限，不宣称发布能力已完成。 */
await smoke(async ({ call, developer, leader, manager, admin, projectId, otherProjectId, ownerId }) => {
  const org = organizationSnapshotSchema.parse(await (await call('organization', leader)).json());
  const team = org.teams[0]; assert.ok(team);
  const ownGroup = org.groups.find((entry) => entry.leaderId === ownerId);
  const otherGroup = org.groups.find((entry) => entry.leaderId !== ownerId); assert.ok(ownGroup && otherGroup);
  const write = async (path: string, command: unknown, auth: Session = leader) => {
    const response = await call(path, auth, command); assert.equal(response.status, 200);
    return z.object({ objectId: z.string().uuid() }).parse(await response.json()).objectId;
  };
  const create = (project: string) => write('work/commands', { action: 'create_task', projectId: project, title: '周计划候选验收', description: '', acceptance: '', operationId: randomUUID() }, project === projectId ? developer : leader);
  const first = await create(projectId); const second = await create(projectId); const foreign = await create(otherProjectId);
  const assign = (taskId: string, accountId: string, groupId: string) => write('assignments/commands', { action: 'assign', taskId, accountId, groupId, content: '', operationId: randomUUID() });
  const firstId = await assign(first, ownerId, ownGroup.id);
  const secondId = await assign(second, ownerId, otherGroup.id);
  const foreignId = await assign(foreign, team.leaderId, ownGroup.id);
  const path = `weekly-plans/candidates?teamId=${team.id}&week=2026-10-12`;
  const read = async (auth: Session) => { const response = await call(path, auth); assert.equal(response.status, 200); return weeklyCandidatesSchema.parse(await response.json()); };
  assert.equal((await call(path)).status, 401);
  assert.equal((await call(path, manager)).status, 403);
  assert.equal((await call(path, admin)).status, 403);
  assert.equal((await call(path.replace('2026-10-12', '2026-10-13'), leader)).status, 400);
  assert.deepEqual(new Set((await read(developer)).assignments.map((entry) => entry.assignmentId)), new Set([firstId, foreignId]));
  assert.deepEqual(new Set((await read(leader)).assignments.map((entry) => entry.assignmentId)), new Set([firstId, secondId, foreignId]));

  const draft = async (week: string, auth = leader) => {
    const response = await call(`weekly-plans?teamId=${team.id}&week=${week}`, auth);
    assert.equal(response.status, 200); return z.object({ draft: weeklyDraftSchema }).parse(await response.json()).draft;
  };
  assert.equal(await draft('2026-10-12'), null);
  const initialize = { action: 'ensure_draft', teamId: team.id, week: '2026-10-12' };
  assert.equal(await write('weekly-plans/commands', initialize), await write('weekly-plans/commands', initialize, developer));
  const candidate = (await read(leader)).assignments.find((entry) => entry.assignmentId === firstId); assert.ok(candidate);
  const save = { action: 'save_arrangement', teamId: team.id, week: '2026-10-12', assignmentId: firstId, assignmentVersion: candidate.assignmentVersion, taskVersion: candidate.taskVersion, version: null, goal: '本周接口', expectedProgress: 30, plannedDays: '2.50' };
  await write('weekly-plans/commands', save, developer);
  assert.equal((await call('weekly-plans/commands', developer, save)).status, 409);
  assert.equal((await call('weekly-plans/commands', manager, save)).status, 403);
  const otherCandidate = (await read(leader)).assignments.find((entry) => entry.assignmentId === secondId); assert.ok(otherCandidate);
  assert.equal((await call('weekly-plans/commands', developer, { ...save, assignmentId: secondId, assignmentVersion: otherCandidate.assignmentVersion, taskVersion: otherCandidate.taskVersion })).status, 409);
  const stored = await draft('2026-10-12'); assert.ok(stored);
  assert.equal(stored.arrangements[0]?.plannedDays, '2.50');
  const races = await Promise.all(['甲', '乙'].map((goal) => call('weekly-plans/commands', developer, { ...save, goal, version: 0 })));
  assert.deepEqual(races.map((entry) => entry.status).sort(), [200, 409]);
  const carry = { action: 'carry_forward', teamId: team.id, week: '2026-10-19' };
  await write('weekly-plans/commands', carry, developer);
  const next = await draft('2026-10-19'); assert.ok(next);
  assert.equal(next.arrangements.length, 1);
  assert.equal(next.arrangements[0]?.goal, '');
  assert.equal(next.arrangements[0]?.plannedDays, null);
  await write('weekly-plans/commands', { ...save, week: '2026-10-19', version: 0, goal: '人工保留', plannedDays: '0.50' }, developer);
  await write('weekly-plans/commands', carry, developer);
  assert.equal((await draft('2026-10-19'))?.arrangements[0]?.goal, '人工保留');

  // 已结束任务即使成员还未确认完成，也不得继续成为正常周安排候选。
  const preview = taskImpactSchema.parse(await (await call(`tasks/impact?taskId=${first}&intent=complete_task`, developer)).json());
  await write('tasks/commands', { action: 'complete_task', taskId: first, version: preview.version, confirmation: preview.confirmation }, developer);
  const remaining = (await read(leader)).assignments;
  assert.equal(remaining.some((entry) => entry.assignmentId === firstId), false);
  assert.equal(new Set(remaining.map((entry) => entry.assignmentId)).size, remaining.length);
  await write('weekly-plans/commands', { ...carry, week: '2026-10-26' });
  assert.equal((await draft('2026-10-26'))?.arrangements.length, 0);
  assert.equal((await draft('2026-10-12'))?.arrangements.length, 1);
  console.log('PASS: weekly candidate scope, cross-project group management, role rejection, Monday validation, stopped task exclusion and no multi-group duplication');
});
await smoke(reportingSmoke);
await smoke(verifyAutomaticCarry);
await smoke(verifyTaskWorkflow);
await smoke(verifyTeamDirect);
