import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { v2WeeklyStateSchema, type V2Workspace } from '@ntfs/contracts';
import { v2ResultSchema } from './repository-utils.js';

type Actor = { id: ReturnType<typeof randomUUID>; token: string; csrf: string };
type Harness = {
  source: DataSource; leader: Actor; lead: Actor; manager: Actor; developer: Actor; projectId: string; hiddenProjectId: string; teamId: string; periodId: string; nextId: string;
  call: (path: string, actor: Actor, body?: unknown, expected?: number) => Promise<unknown>;
  state: (actor?: Actor) => Promise<V2Workspace>;
};

/** 复用随机团队夹具，真实 HTTP 覆盖默认/手动/恢复、权限、隔离及数据库保存；由主夹具清理。 */
export async function verifySorting(h: Harness): Promise<void> {
  const { source, call, state, leader, lead, manager, developer, projectId, hiddenProjectId, teamId, periodId, nextId } = h;
  const projectScope = `project-page:tasks:${projectId}`;
  const order = (snapshot: V2Workspace, scope = projectScope) => {
    const result = snapshot.orders.find((row) => row.scope === scope); assert.ok(result); return result;
  };
  const weekly = async (actor = leader) => v2WeeklyStateSchema.parse(await call(`weekly?summaryPeriodId=${periodId}&planPeriodId=${nextId}`, actor));
  const create = async (priority: number) => {
    const result = v2ResultSchema.parse(await call('tasks', lead, { action: 'create_project', operationId: randomUUID(), task: { projectId, periodId: nextId, executorId: developer.id, title: `排序验收 ${priority}`, priority, milestoneId: null, plannedDays: null } }));
    const id = result.objectIds[0]; assert.ok(id); return id;
  };
  const resetPersonal = async () => call('personal', developer, { action: 'reset_order', operationId: randomUUID(), version: (await state(developer)).personalVersion });
  const selected = (ids: string[], scope: string[]) => ids.filter((id) => scope.includes(id));
  await resetPersonal();
  const a = await create(3), b = await create(1), pair = [a, b];
  const baseline = await state();
  assert.deepEqual(selected(order(baseline).ids, pair), [b, a]);
  assert.deepEqual(selected((await state(developer)).placements.map((row) => row.taskId), pair), [b, a]);
  const reorder = { action: 'reorder_project_items', operationId: randomUUID(), projectId, target: 'tasks', version: order(baseline).version, ids: [a, b] };
  await call('planning', manager, reorder, 403);
  await call('planning', lead, reorder);
  await call('planning', lead, { ...reorder, operationId: randomUUID() }, 409);
  const firstManual = order(await state());
  assert.deepEqual(firstManual.ids.filter((id) => !pair.includes(id)), order(baseline).ids.filter((id) => !pair.includes(id)));
  assert.deepEqual(selected(firstManual.ids, pair), [a, b]);
  const beforeWeekly = await weekly(), planOrder = beforeWeekly.taskOrders.find((row) => row.projectId === projectId && row.periodId === nextId); assert.ok(planOrder);
  assert.deepEqual(selected(planOrder.ids, pair), [b, a]);
  await call('planning', lead, { action: 'reorder_tasks', operationId: randomUUID(), projectId, periodId: nextId, view: 'plan', version: planOrder.version, taskIds: [...planOrder.ids].reverse() });
  assert.deepEqual(order(await state()).ids, firstManual.ids);

  // 个人拖动独立保存，新增任务在手动分类顶部；默认分类不以新建顺序覆盖优先级。
  let own = await state(developer);
  const placed = own.placements.find((row) => row.taskId === a), task = own.tasks.find((row) => row.id === a); assert.ok(placed && task);
  await call('personal', developer, { action: 'move_task', operationId: randomUUID(), version: own.personalVersion, taskId: a, taskVersion: task.version, categoryId: placed.categoryId, beforeTaskId: b });
  const c = await create(5);
  assert.equal(order(await state()).ids[0], c);
  assert.equal((await weekly()).taskOrders.find((row) => row.projectId === projectId && row.periodId === nextId)?.ids[0], c);
  own = await state(developer); assert.equal(own.placements.filter((row) => row.categoryId === placed.categoryId)[0]?.taskId, c);
  const d = await create(5);
  assert.deepEqual(order(await state()).ids.slice(0, 2), [d, c]);
  const beforeEdit = order(await state()).ids;
  const aTask = (await state()).tasks.find((row) => row.id === a); assert.ok(aTask);
  await call('edit', lead, { action: 'save_task', operationId: randomUUID(), taskId: a, version: aTask.version, details: { kind: 'project', title: aTask.title, priority: 5, executorId: developer.id, milestoneId: null } });
  assert.deepEqual(order(await state()).ids, beforeEdit);
  const current = order(await state());
  await call('planning', lead, { ...reorder, operationId: randomUUID(), version: current.version, reset: true, ids: [] });
  await call('planning', lead, { ...reorder, operationId: randomUUID(), version: current.version }, 409);
  assert.equal(order(await state()).manual, false);
  assert.deepEqual(selected(order(await state()).ids, [a, b, c, d]), [b, a, c, d]);
  await resetPersonal();
  own = await state(developer);
  assert.deepEqual(selected(own.placements.map((row) => row.taskId), [a, b, c, d]), [b, a, c, d]);
  const e = await create(1);
  assert.deepEqual(selected(order(await state()).ids, [a, b, e]), [b, e, a]);
  assert.deepEqual(selected((await state(developer)).placements.map((row) => row.taskId), [a, b, e]), [b, e, a]);
  const manualWeek = (await weekly()).taskOrders.find((row) => row.projectId === projectId && row.periodId === nextId); assert.ok(manualWeek);
  await call('planning', lead, { action: 'reorder_tasks', operationId: randomUUID(), projectId, periodId: nextId, view: 'plan', version: manualWeek.version, reset: true, taskIds: [] });
  const resetWeek = (await weekly()).taskOrders.find((row) => row.projectId === projectId && row.periodId === nextId); assert.ok(resetWeek);
  assert.equal(resetWeek.manual, false);
  assert.deepEqual(selected(resetWeek.ids, [a, b, c, d, e]), [b, e, a, c, d]);

  // 待建的默认和手动规则与正式任务一致，且两个列表不共享顺序。
  const createBacklog = async (priority: number) => {
    const result = v2ResultSchema.parse(await call('projects', developer, { action: 'create_backlog', operationId: randomUUID(), projectId, title: `待建排序 ${priority}`, priority }));
    const id = result.objectIds[0]; assert.ok(id); return id;
  };
  const ba = await createBacklog(3), bb = await createBacklog(1), backlogScope = `project-page:backlog:${projectId}`;
  assert.deepEqual(selected(order(await state(), backlogScope).ids, [ba, bb]), [bb, ba]);
  await call('planning', lead, { action: 'reorder_project_items', operationId: randomUUID(), projectId, target: 'backlog', version: order(await state(), backlogScope).version, ids: [ba, bb] });
  const bc = await createBacklog(5);
  assert.equal(order(await state(), backlogScope).ids[0], bc);
  assert.deepEqual(selected(order(await state(), backlogScope).ids, [ba, bb]), [ba, bb]);
  await call('planning', lead, { action: 'reorder_project_items', operationId: randomUUID(), projectId, target: 'backlog', version: order(await state(), backlogScope).version, ids: [randomUUID()] }, 409);

  // 全团队顺序经过受限读取仍完整；周报项目组按总结区间独立保存。
  await source.query("UPDATE projects SET created_at='2026-01-01 00:00:00' WHERE id=?", [projectId]);
  await source.query("UPDATE projects SET created_at='2026-01-02 00:00:00' WHERE id=?", [hiddenProjectId]);
  const projectOrder = order(await state(), 'project-page:projects');
  assert.deepEqual(projectOrder.ids, [hiddenProjectId, projectId]);
  await call('planning', leader, { action: 'reorder_projects', page: 'projects', operationId: randomUUID(), version: projectOrder.version, projectIds: [projectId, hiddenProjectId] });
  assert.deepEqual(order(await state(lead), 'project-page:projects').ids, [projectId]);
  assert.deepEqual(order(await state(), 'project-page:projects').ids, [projectId, hiddenProjectId]);
  const week = await weekly();
  await call('planning', leader, { action: 'reorder_projects', periodId, operationId: randomUUID(), version: week.projectOrder.version, projectIds: [projectId, hiddenProjectId] });
  const periods = (await state()).periods, after = periods[periods.findIndex((row) => row.id === nextId) + 1]; assert.ok(after);
  const another = v2WeeklyStateSchema.parse(await call(`weekly?summaryPeriodId=${nextId}&planPeriodId=${after.id}`, leader));
  assert.deepEqual(another.projectOrder.ids, [hiddenProjectId, projectId]);
  assert.deepEqual((await weekly(lead)).projectOrder.ids, [projectId]);
  const newProject = v2ResultSchema.parse(await call('team', leader, { action: 'create_project', operationId: randomUUID(), name: '排序验收新项目', members: [{ accountId: lead.id, roles: ['project_lead'] }, { accountId: manager.id, roles: ['project_manager'] }] })).objectIds[0];
  assert.ok(newProject);
  try {
    assert.equal(order(await state(), 'project-page:projects').ids[0], newProject);
    assert.equal((await weekly()).projectOrder.ids[0], newProject);
    const creation = z.array(z.object({ recorded: z.coerce.number() })).parse(await source.query('SELECT created_at IS NOT NULL AS recorded FROM projects WHERE id=?', [newProject]));
    assert.equal(creation[0]?.recorded, 1);
  } finally {
    await source.transaction(async (db) => {
      await db.query('DELETE FROM v2_object_events WHERE project_id=?', [newProject]);
      await db.query('DELETE FROM project_members WHERE project_id=?', [newProject]);
      await db.query('DELETE FROM projects WHERE id=? AND team_id=?', [newProject, teamId]);
    });
  }
  const persisted = z.array(z.object({ scope_key: z.string(), manual_order: z.coerce.number(), version: z.number() })).parse(await source.query('SELECT scope_key,manual_order,version FROM v2_shared_orders WHERE team_id=?', [teamId]));
  assert.equal(persisted.find((row) => row.scope_key === projectScope)?.manual_order, 0);
  assert.equal(persisted.find((row) => row.scope_key === backlogScope)?.manual_order, 1);
  assert.ok(persisted.some((row) => row.scope_key === `projects:${periodId}` && row.version > 0));
  console.log('Sorting API/MySQL verified: defaults, manual order, prepend, reset, stale versions, permissions, hidden items and independent pages/periods.');
}
