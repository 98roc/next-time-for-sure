import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { v2WorkspaceSchema, v2WeeklyStateSchema } from '@ntfs/contracts';
import { withFixture, type Session } from '../testing/fixture.js';
import { v2ResultSchema } from './repository-utils.js';

/** 真实 API/MySQL 验证账号隔离、隐藏对象、普通成员创建边界及团队文字顺序；夹具自动清理。 */
await withFixture(async ({ source, call, prefix, teamId, projectId, otherProjectId, leader, developer, outsider, admin }) => {
  async function request(path: string, actor: Session, body?: unknown, expected = 200) {
    const response = await call(`v2/${path}`, actor, body), result: unknown = await response.json();
    assert.equal(response.status, expected, `${path}: ${JSON.stringify(result)}`);
    return result;
  }
  const workspace = async (actor: Session) => v2WorkspaceSchema.parse(await request(`workspace?teamId=${teamId}`, actor));
  const baseline = await workspace(leader), period = baseline.periods.find((row) => row.startOn <= baseline.today && baseline.today <= row.endOn);
  assert.ok(period);
  const next = baseline.periods[baseline.periods.indexOf(period) + 1]; assert.ok(next);
  const weekly = async (actor: Session) => v2WeeklyStateSchema.parse(await request(`weekly?teamId=${teamId}&summaryPeriodId=${period.id}&planPeriodId=${next.id}`, actor));
  const task = (title: string, executorId = developer.id) => ({ projectId, executorId, title, priority: 3, periodId: next.id, plannedDays: 1, milestoneId: null });
  const create = async (actor: Session, title: string, executorId = developer.id) => v2ResultSchema.parse(await request('tasks', actor, { action: 'create_project', operationId: randomUUID(), task: task(title, executorId) })).objectIds[0];
  const a = await create(leader, '个人排序任务甲'), b = await create(leader, '个人排序任务乙'); assert.ok(a && b);
  const planning = (actor: Session, body: object, expected = 200) => request(`planning?teamId=${teamId}`, actor, { operationId: randomUUID(), ...body }, expected);
  const order = async (actor: Session, scope: string) => {
    const found = (await workspace(actor)).orders.find((row) => row.scope === scope); assert.ok(found); return found;
  };

  // 切换只继承一次旧共享顺序，新的个人保存不改写旧表或其他账号。
  const scope = `project-page:tasks:${projectId}`;
  await source.query('INSERT INTO v2_shared_orders(team_id,scope_key,ordered_ids,version,manual_order) VALUES (?,?,?,7,1)', [teamId, scope, JSON.stringify([b, a])]);
  const initial = await order(developer, scope); assert.deepEqual(initial.ids, [b, a]);
  const leaderOrder = await order(leader, scope);
  await planning(developer, { action: 'reorder_project_items', projectId, target: 'tasks', ids: [a, b], version: initial.version });
  assert.deepEqual((await order(developer, scope)).ids, [a, b]);
  assert.deepEqual(await order(leader, scope), leaderOrder);
  await planning(developer, { action: 'reorder_project_items', projectId, target: 'tasks', ids: [b, a], version: initial.version }, 409);
  const persisted = z.array(z.object({ owner_id: z.string() })).parse(await source.query('SELECT owner_id FROM v2_view_orders WHERE team_id=? AND scope_key=?', [teamId, scope]));
  assert.equal(persisted.length, 2);
  const legacy = z.array(z.object({ version: z.number() })).parse(await source.query('SELECT version FROM v2_shared_orders WHERE team_id=? AND scope_key=?', [teamId, scope])); assert.equal(legacy[0]?.version, 7);

  // 项目、人员、任务、待建均允许普通成员排序；不可见项目仍禁止，日期权限没有放开。
  await planning(developer, { action: 'reorder_projects', page: 'projects', projectIds: [projectId], version: (await order(developer, 'project-page:projects')).version });
  await planning(developer, { action: 'reorder_projects', page: 'projects', projectIds: [projectId, otherProjectId], version: (await order(developer, 'project-page:projects')).version }, 409);
  await planning(developer, { action: 'reorder_project_items', projectId: otherProjectId, target: 'tasks', ids: [], reset: true, version: 0 }, 403);
  await planning(developer, { action: 'set_period_window', before: 2, after: 2, version: 0 }, 403);
  const backlog = v2ResultSchema.parse(await request('projects', developer, { action: 'create_backlog', operationId: randomUUID(), projectId, title: '本人待建排序', priority: 3 })).objectIds[0]; assert.ok(backlog);
  await planning(developer, { action: 'reorder_project_items', projectId, target: 'backlog', ids: [backlog], version: (await order(developer, `project-page:backlog:${projectId}`)).version });
  let ownWeek = await weekly(developer);
  await planning(developer, { action: 'reorder_people', executorIds: [developer.id], version: ownWeek.peopleOrder.version });
  ownWeek = await weekly(developer);
  await planning(developer, { action: 'reorder_people', executorIds: [outsider.id], version: ownWeek.peopleOrder.version }, 409);

  // 页面顺序各自保存，自动文字统一跟随团队负责人；普通成员不读共享手工稿。
  const leadWeek = await weekly(leader), leadTaskOrder = leadWeek.taskOrders.find((row) => row.projectId === projectId && row.periodId === next.id); assert.ok(leadTaskOrder);
  await planning(leader, { action: 'reorder_tasks', projectId, periodId: next.id, view: 'plan', taskIds: [b, a], version: leadTaskOrder.version });
  const reportBefore = await weekly(leader);
  ownWeek = await weekly(developer);
  const ownTaskOrder = ownWeek.taskOrders.find((row) => row.projectId === projectId && row.periodId === next.id); assert.ok(ownTaskOrder);
  await planning(developer, { action: 'reorder_tasks', projectId, periodId: next.id, view: 'plan', taskIds: [a, b], version: ownTaskOrder.version });
  ownWeek = await weekly(developer);
  assert.deepEqual(ownWeek.taskOrders.find((row) => row.projectId === projectId && row.periodId === next.id)?.ids, [a, b]);
  assert.ok(ownWeek.generatedText.indexOf('个人排序任务乙') < ownWeek.generatedText.indexOf('个人排序任务甲'));
  assert.equal((await weekly(leader)).currentSourceHash, reportBefore.currentSourceHash);
  assert.equal((await weekly(admin)).generatedText, reportBefore.generatedText);
  await request(`report?teamId=${teamId}`, leader, { action: 'save', operationId: randomUUID(), summaryPeriodId: period.id, planPeriodId: next.id, body: '团队手工稿保持原样', sourceHash: reportBefore.currentSourceHash, version: reportBefore.text.version });
  assert.equal((await weekly(admin)).text.body, '团队手工稿保持原样');
  assert.notEqual((await weekly(developer)).text.body, '团队手工稿保持原样');

  // 普通研发可批量创建本人任务，给他人创建仍拒绝；负责人创建后进入执行人的看板。
  await request('tasks', developer, { action: 'create_batch', operationId: randomUUID(), tasks: [task('普通研发批量一'), task('普通研发批量二')] });
  await request('tasks', developer, { action: 'create_batch', operationId: randomUUID(), tasks: [task('不能给负责人安排', leader.id)] }, 403);
  const created = await create(leader, '工作台给他人任务'); assert.ok(created);
  assert.ok((await workspace(developer)).placements.some((row) => row.taskId === created));
  assert.ok(!(await workspace(leader)).placements.some((row) => row.taskId === created));

  // 恢复默认只重置本人，不改变团队负责人的顺序。
  await planning(developer, { action: 'reorder_project_items', projectId, target: 'tasks', reset: true, ids: [], version: (await order(developer, scope)).version });
  assert.equal((await order(developer, scope)).manual, false);
  assert.equal((await order(leader, scope)).manual, true);

  // 超管切换团队时，同名项目排序作用域不能串到另一团队。
  const secondTeam = randomUUID(), secondProject = randomUUID();
  await source.query('INSERT INTO teams(id,name,leader_id,created_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [secondTeam, `${prefix}.second`, admin.id]);
  await source.query('INSERT INTO projects(id,team_id,name) VALUES (?,?,?)', [secondProject, secondTeam, '第二团队项目']);
  const adminOrder = await order(admin, 'project-page:projects');
  await planning(admin, { action: 'reorder_projects', page: 'projects', projectIds: [...adminOrder.ids].reverse(), version: adminOrder.version });
  const firstTeamOrder = await order(admin, 'project-page:projects');
  const secondState = v2WorkspaceSchema.parse(await request(`workspace?teamId=${secondTeam}`, admin));
  const secondOrder = secondState.orders.find((row) => row.scope === 'project-page:projects'); assert.ok(secondOrder);
  await request(`planning?teamId=${secondTeam}`, admin, { action: 'reorder_projects', page: 'projects', operationId: randomUUID(), projectIds: [secondProject], version: secondOrder.version });
  assert.deepEqual(await order(admin, 'project-page:projects'), firstTeamOrder);
  console.log('View orders API/MySQL passed: seed, account isolation, permissions, stale versions, scoped reset, shared report order and task assignment.');
});
