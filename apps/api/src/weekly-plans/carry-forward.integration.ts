import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { organizationSnapshotSchema, weeklyDraftResponseSchema, weeklyCandidatesSchema, publicationPreviewSchema, planPublicationsSchema, assignmentSnapshotSchema, assignmentCompletionSchema } from '@ntfs/contracts';
import type { WorkFixture, Session } from '../organization/integration-smoke.js';

/** 使用当前上海周次验证无需点击结转、缺周补入、人工移出、发布冻结和小组范围。 */
export async function verifyAutomaticCarry({ call, leader, developer, manager, projectId, ownerId }: WorkFixture) {
  const now = new Date();
  const date = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  const week = date.toISOString().slice(0, 10);
  const shift = (days: number) => { const copy = new Date(date); copy.setUTCDate(copy.getUTCDate() + days); return copy.toISOString().slice(0, 10); };
  const previous = shift(-7); const next = shift(7); const gap = shift(-21);
  const org = organizationSnapshotSchema.parse(await (await call('organization', leader)).json());
  const team = org.teams[0]; const group = org.groups.find((entry) => entry.leaderId === ownerId); const other = org.groups.find((entry) => entry.leaderId !== ownerId); assert.ok(team && group && other);
  const teamId = team.id;
  async function write(path: string, body: unknown, auth: Session = leader) {
    const response = await call(path, auth, body);
    const result: unknown = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
    return z.object({ objectId: z.string() }).parse(result).objectId;
  }
  const candidates = async () => weeklyCandidatesSchema.parse(await (await call(`weekly-plans/candidates?teamId=${teamId}&week=${week}`, leader)).json()).assignments;
  const draft = async (target: string, auth = leader) => weeklyDraftResponseSchema.parse(await (await call(`weekly-plans?teamId=${teamId}&week=${target}`, auth)).json()).draft;
  async function create(title: string, groupId = group?.id) {
    assert.ok(groupId);
    const taskId = await write('work/commands', { action: 'create_task', projectId, title, description: '', acceptance: '', operationId: randomUUID() }, developer);
    const assignmentId = await write('assignments/commands', { action: 'assign', taskId, accountId: ownerId, groupId, content: '', operationId: randomUUID() });
    return { taskId, assignmentId };
  }
  async function save(assignmentId: string, target: string, version: number | null = null, goal = '') {
    const candidate = (await candidates()).find((entry) => entry.assignmentId === assignmentId); assert.ok(candidate);
    await write('weekly-plans/commands', { action: 'save_arrangement', teamId, week: target, assignmentId, assignmentVersion: candidate.assignmentVersion, taskVersion: candidate.taskVersion, version, goal, plannedDays: null, expectedProgress: null });
  }
  const active = await create('自动延续未完成');
  const completed = await create('已完成分工不延续');
  const foreign = await create('其他小组待办', other.id);
  const manual = await create('已有手工安排');
  const distant = await create('远期任务');
  for (const entry of [active, completed, foreign]) await save(entry.assignmentId, previous);
  await save(manual.assignmentId, next, null, '人工目标保留');
  await save(manual.assignmentId, gap);
  await save(distant.assignmentId, shift(21));
  const assignments = assignmentSnapshotSchema.parse(await (await call(`assignments?projectId=${projectId}`, developer)).json());
  const completion = assignments.assignments.find((entry) => entry.id === completed.assignmentId); assert.ok(completion);
  const impact = assignmentCompletionSchema.parse(await (await call(`assignments/completion?assignmentId=${completion.id}`, developer)).json());
  await write('assignments/commands', { action: 'complete', assignmentId: completion.id, version: completion.version, confirmation: impact.confirmation }, developer);
  const pendingTask = await write('work/commands', { action: 'create_task', projectId, title: '未落实人员的往期工作', description: '', acceptance: '', operationId: randomUUID() }, developer);
  await write('weekly-plans/commands', { action: 'add_pending', teamId, week: previous, taskId: pendingTask, taskVersion: 0 });
  const old = JSON.stringify(await draft(previous));
  assert.equal((await call(`weekly-plans?teamId=${teamId}&week=${week}`, manager)).status, 403);

  // 组长读取只自动维护本组；团队负责人随后补齐其他小组与待分配事项。
  const scoped = await draft(week, developer); assert.ok(scoped);
  assert.ok(scoped.arrangements.some((entry) => entry.assignmentId === active.assignmentId));
  assert.ok(!scoped.arrangements.some((entry) => entry.assignmentId === foreign.assignmentId));
  assert.ok(!scoped.arrangements.some((entry) => entry.assignmentId === completed.assignmentId));
  const current = await draft(week); assert.ok(current);
  assert.equal(current.arrangements.length, 3);
  assert.equal(current.pending.length, 1);
  assert.ok(!current.arrangements.some((entry) => entry.assignmentId === distant.assignmentId));
  assert.deepEqual(await draft(week), current);
  assert.equal(JSON.stringify(await draft(previous)), old);
  assert.equal((await draft(next))?.arrangements.find((entry) => entry.assignmentId === manual.assignmentId)?.goal, '人工目标保留');

  // 主动移出后刷新不复活；重新安排恢复后续延续。
  const carried = current.arrangements.find((entry) => entry.assignmentId === active.assignmentId); assert.ok(carried);
  await write('weekly-plans/commands', { action: 'remove_arrangement', teamId, week, arrangementId: carried.id, version: carried.version });
  assert.ok(!(await draft(week))?.arrangements.some((entry) => entry.assignmentId === active.assignmentId));
  await save(active.assignmentId, week);
  assert.ok((await draft(week))?.arrangements.some((entry) => entry.assignmentId === active.assignmentId));
  const pending = current.pending[0]; assert.ok(pending);
  await write('weekly-plans/commands', { action: 'remove_pending', teamId, week, pendingId: pending.id, version: pending.version });
  assert.equal((await draft(week))?.pending.length, 0);

  // 发布后新增来源不自动改变本周草稿及任何发布副本。
  const preview = publicationPreviewSchema.parse(await (await call(`weekly-plans/preview?teamId=${teamId}&week=${week}`, leader)).json());
  await write('weekly-plans/commands', { action: 'publish_plan', teamId, week, confirmation: preview.confirmation, reason: '发布保护验收' });
  const frozen = JSON.stringify(planPublicationsSchema.parse(await (await call(`weekly-plans/publications?teamId=${teamId}&week=${week}`, leader)).json()).publications);
  const late = await create('发布后补录往期');
  await save(late.assignmentId, previous);
  assert.ok(!(await draft(week))?.arrangements.some((entry) => entry.assignmentId === late.assignmentId));
  assert.equal(JSON.stringify(planPublicationsSchema.parse(await (await call(`weekly-plans/publications?teamId=${teamId}&week=${week}`, leader)).json()).publications), frozen);
  console.log('PASS: automatic current/next week carry, skipped weeks, permissions, completed/future exclusion, manual edits, removal persistence, no duplicates and frozen publications');
}
