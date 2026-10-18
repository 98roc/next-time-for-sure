import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { LegacySource } from './source.js';
import { buildPlan, targetId } from './plan.js';

/** 最小真实来源关系：一个多人任务跨两个区间，另有同执行人的私人任务。 */
function fixture(): LegacySource {
  const team = randomUUID(), project = randomUUID(), creator = randomUUID(), first = randomUUID(), second = randomUUID(), task = randomUUID(), week = randomUUID(), next = randomUUID();
  const createdAt = '2026-10-16T04:00:00.000Z';
  const assignments = [first, second].map((account_id) => ({ id: randomUUID(), task_id: task, account_id, status: 'not_started' as const, started_at: null, ended_at: null, created_at: createdAt, updated_at: createdAt }));
  return {
    accounts: [creator, first, second].map((id) => ({ id, team_id: team, display_name: id, is_super_admin: false, disabled: false })), teams: [{ id: team, leader_id: creator }], projects: [{ id: project, team_id: team, name: '项目', archived: false }],
    members: [{ project_id: project, account_id: first, roles_json: ['project_manager', 'project_lead', 'developer'] }, { project_id: project, account_id: second, roles_json: ['developer'] }],
    tasks: [{ id: task, project_id: project, request_id: null, parent_id: null, milestone_id: null, title: '共同任务', status: 'not_started', created_at: createdAt, updated_at: createdAt }], assignments,
    personal: [{ id: randomUUID(), owner_id: first, kind: 'private', project_id: null, assignment_id: null, category_id: null, title: '私人内容', status: 'not_started', position: 2, ended_at: null, created_at: createdAt, updated_at: createdAt }], categories: [], milestones: [], requests: [],
    drafts: [{ id: week, team_id: team, week: '2026-10-12' }, { id: next, team_id: team, week: '2026-10-19' }], arrangements: assignments.flatMap((assignment) => [week, next].map((draft_id) => ({ id: randomUUID(), draft_id, assignment_id: assignment.id, planned_days: draft_id === week ? 0 : null, goal: '' }))),
    workEvents: [{ id: randomUUID(), object_id: task, actor_id: creator, action: 'create_task', payload_json: { title: '共同任务', milestoneId: null }, created_at: createdAt }], personalEvents: [], weeklyEvents: [], reports: [], publications: [],
  };
}

test('多人工作按执行人拆分而跨区间不复制，保留零估算、原创建人和私人隔离', () => {
  const source = fixture(), before = JSON.stringify(source), actorId = source.teams[0]?.leader_id; assert.ok(actorId);
  const plan = buildPlan(source, { actorId, supplements: [] }, '2026-10-18T00:00:00.000Z');
  const tasks = plan.rows.get('v2_tasks') ?? [], arrangements = plan.rows.get('v2_arrangements') ?? [];
  assert.equal(tasks.length, 3); assert.equal(arrangements.length, 4);
  for (const task of tasks.filter((row) => row.kind === 'project')) {
    assert.equal(task.creator_id, actorId); assert.equal(arrangements.filter((row) => row.task_id === task.id).length, 2);
  }
  const privateTask = tasks.find((row) => row.kind === 'private'); assert.ok(privateTask);
  assert.equal(privateTask.team_id, null); assert.equal(privateTask.project_id, null); assert.equal(privateTask.creator_id, privateTask.executor_id);
  assert.equal(arrangements.some((row) => row.task_id === privateTask.id), false);
  assert.equal(arrangements.filter((row) => row.planned_days === 0).length, 2); assert.equal(arrangements.filter((row) => row.planned_days === null).length, 2);
  assert.equal(JSON.stringify(source), before);
});

test('补录授权绑定具体来源与创建日；缺失、过期和多个人副本均不得静默猜测', () => {
  const source = fixture(), assignment = source.assignments[0], actorId = source.teams[0]?.leader_id; assert.ok(assignment); assert.ok(actorId);
  source.arrangements = source.arrangements.filter((row) => row.assignment_id !== assignment.id);
  assert.throws(() => buildPlan(source, { actorId, supplements: [] }, '2026-10-18T00:00:00.000Z'), /REVIEW_MISSING_PERIOD/);
  const decision = { sourceTable: 'task_assignments' as const, sourceId: assignment.id, createdOn: '2026-10-16', startOn: '2026-10-12' };
  assert.throws(() => buildPlan(source, { actorId, supplements: [{ ...decision, createdOn: '2026-10-15' }] }, '2026-10-18T00:00:00.000Z'), /REVIEW_MISSING_PERIOD/);
  const plan = buildPlan(source, { actorId, supplements: [decision] }, '2026-10-18T00:00:00.000Z');
  const supplement = plan.rows.get('v2_arrangement_history')?.[0]; assert.equal(supplement?.provenance, 'migration_supplement'); assert.equal(supplement?.valid_from, '2026-10-18 00:00:00.000');
  assert.equal(targetId('task', assignment.id), plan.taskSources.get(assignment.id));
  const privateItem = source.personal[0]; assert.ok(privateItem);
  source.personal.push(...[randomUUID(), randomUUID()].map((id) => ({ ...privateItem, id, kind: 'work' as const, assignment_id: assignment.id, project_id: source.tasks[0]?.project_id ?? null, owner_id: assignment.account_id })));
  assert.throws(() => buildPlan(source, { actorId, supplements: [decision] }, '2026-10-18T00:00:00.000Z'), /REVIEW_MULTIPLE_PERSONAL_ALIASES/);
});
