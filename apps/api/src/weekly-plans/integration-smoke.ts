import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { organizationSnapshotSchema, weeklyCandidatesSchema, taskImpactSchema } from '@ntfs/contracts';
import { smoke } from '../organization/integration-smoke.js';
import type { Session } from '../organization/integration-smoke.js';

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

  // 已结束任务即使成员还未确认完成，也不得继续成为正常周安排候选。
  const preview = taskImpactSchema.parse(await (await call(`tasks/impact?taskId=${first}&intent=complete_task`, developer)).json());
  await write('tasks/commands', { action: 'complete_task', taskId: first, version: preview.version, confirmation: preview.confirmation }, developer);
  const remaining = (await read(leader)).assignments;
  assert.equal(remaining.some((entry) => entry.assignmentId === firstId), false);
  assert.equal(new Set(remaining.map((entry) => entry.assignmentId)).size, remaining.length);
  console.log('PASS: weekly candidate scope, cross-project group management, role rejection, Monday validation, stopped task exclusion and no multi-group duplication');
});
