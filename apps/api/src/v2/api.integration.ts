import { verifySorting } from './sorting.integration.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { z } from 'zod';
import { v2ImpactSchema, v2MemberImpactSchema, v2TaskHistorySchema, v2WeeklyStateSchema, v2WorkspaceSchema } from '@ntfs/contracts';
import { AppModule } from '../app.module.js';
import { SafeExceptionFilter } from '../safe-exception.filter.js';
import { loadEnvironment } from '../config/environment.js';
import { createDataSource } from '../database/data-source.js';
import { digest } from '../identity/password.js';
import { v2ResultSchema } from './repository-utils.js';
import { shiftDate } from './calendar.js';

/** 真实 HTTP、两个并发用户和 MySQL 回读；仅本机，随机夹具在 finally 中依赖逆序清理。 */
async function smoke(): Promise<void> {
  const environment = loadEnvironment();
  if (environment.DB_HOST !== '127.0.0.1') throw new Error('Local database required');
  const source = createDataSource(environment); await source.initialize();
  const teamId = randomUUID(), projectId = randomUUID(), hiddenProjectId = randomUUID();
  const makeActor = () => ({ id: randomUUID(), token: randomBytes(32).toString('hex'), csrf: randomBytes(32).toString('hex') });
  const leader = makeActor(), lead = makeActor(), developer = makeActor(), manager = makeActor(), outsider = makeActor();
  const actors = [leader, lead, developer, manager, outsider];
  let app: INestApplication | undefined, base = '', stage = 'setup';
  try {
    await source.transaction(async (db) => {
      for (const actor of actors) {
        await db.query('INSERT INTO accounts(id,login_name,display_name,password_hash,must_change_password,created_at,updated_at) VALUES (?,?,?,?,0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))', [actor.id, `v2.${actor.id}`, `测试${actor.id.slice(0, 5)}`, 'unusable-test-fixture']);
        await db.query('INSERT INTO login_sessions(token_hash,account_id,csrf_token,created_at,expires_at) VALUES (?,?,?,UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY))', [digest(actor.token), actor.id, actor.csrf]);
      }
      await db.query('INSERT INTO teams(id,name,leader_id,created_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [teamId, 'V2真实API测试团队', leader.id]);
      for (const actor of actors) await db.query('UPDATE accounts SET team_id=? WHERE id=?', [teamId, actor.id]);
      for (const id of [projectId, hiddenProjectId]) await db.query('INSERT INTO projects(id,team_id,name) VALUES (?,?,?)', [id, teamId, id === projectId ? '可见项目' : '受限项目']);
      for (const [id, roles] of [[lead.id, ['project_lead']], [developer.id, ['developer']], [manager.id, ['project_manager']]]) await db.query('INSERT INTO project_members(project_id,account_id,roles_json) VALUES (?,?,?)', [projectId, id, JSON.stringify(roles)]);
      await db.query('INSERT INTO project_members(project_id,account_id,roles_json) VALUES (?,?,?)', [hiddenProjectId, outsider.id, JSON.stringify(['project_manager', 'project_lead', 'developer'])]);
    });
    app = await NestFactory.create(AppModule, { logger: false }); app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new SafeExceptionFilter()); await app.listen(0, '127.0.0.1'); base = await app.getUrl();

    /** 只在测试内持有 Cookie，不写入文件或输出。 */
    async function call(path: string, actor: typeof leader, body?: unknown, expected = 200) {
      const response = await fetch(`${base}/api/v1/v2/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Origin: base, Cookie: `ntfs_session=${actor.token}`, 'X-CSRF-Token': actor.csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
      const result: unknown = await response.json();
      assert.equal(response.status, expected, `${stage}: ${path}: ${JSON.stringify(result)}`); return result;
    }
    const state = async (actor = leader) => v2WorkspaceSchema.parse(await call('workspace', actor));
    const initial = await state(); const period = initial.periods.find((row) => row.startOn <= initial.today && row.endOn >= initial.today); assert.ok(period);
    const next = initial.periods[initial.periods.indexOf(period) + 1]; assert.ok(next);
    const taskInput = { projectId, executorId: developer.id, periodId: period.id, title: '同一任务跨入口', priority: 3, milestoneId: null, plannedDays: null };
    const command = { action: 'create_project', operationId: randomUUID(), task: taskInput };
    stage = 'create and idempotence';
    const created = v2ResultSchema.parse(await call('tasks', lead, command)), taskId = created.objectIds[0]; assert.ok(taskId);
    assert.deepEqual(await call('tasks', lead, command), created);
    await call('tasks', lead, { ...command, task: { ...taskInput, title: '不同内容复用键' } }, 409);
    assert.equal((await state(developer)).tasks.filter((task) => task.id === taskId).length, 1);
    assert.equal((await state(manager)).tasks.some((task) => task.id === taskId), true);
    assert.equal((await state(outsider)).tasks.some((task) => task.id === taskId), false);
    await call('tasks', manager, { ...command, operationId: randomUUID() }, 403);
    await call('tasks', developer, { ...command, operationId: randomUUID(), task: { ...taskInput, executorId: lead.id } }, 403);
    stage = 'whole batch rollback';
    const count = (await state()).tasks.length;
    await call('tasks', lead, { action: 'create_batch', operationId: randomUUID(), tasks: [taskInput, { ...taskInput, periodId: randomUUID() }] }, 409);
    assert.equal((await state()).tasks.length, count);
    stage = 'concurrent status';
    const change = { action: 'set_status', taskId, version: 0, status: 'in_progress' };
    const responses = await Promise.all([developer, lead].map((actor) => fetch(`${base}/api/v1/v2/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, Cookie: `ntfs_session=${actor.token}`, 'X-CSRF-Token': actor.csrf }, body: JSON.stringify({ ...change, operationId: randomUUID() }) })));
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const current = (await state()).tasks.find((task) => task.id === taskId); assert.ok(current); assert.equal(current.version, 1);
    const history = v2TaskHistorySchema.parse(await call(`history?taskId=${taskId}`, developer)); assert.equal(history.length, 2); assert.ok([lead.id, developer.id].some((id) => id === history[1]?.actorId));
    await call(`history?taskId=${taskId}`, outsider, undefined, 404);
    stage = 'last arrangement and atomic reschedule';
    const removalIntent = { action: 'remove_arrangement', taskId, version: current.version, periodId: period.id };
    const blocked = v2ImpactSchema.parse(await call('impact', lead, removalIntent)); assert.match(blocked.blockers.join(), /最后一个/);
    await call('tasks', lead, { ...removalIntent, operationId: randomUUID(), confirmation: blocked.confirmation }, 409);
    const moveIntent = { action: 'change_arrangement', taskId, version: current.version, periodId: period.id, targetPeriodId: next.id };
    const move = v2ImpactSchema.parse(await call('impact', lead, moveIntent));
    await call('tasks', lead, { ...moveIntent, operationId: randomUUID(), plannedDays: 1.25, confirmation: move.confirmation });
    const moved = await state(); assert.equal(moved.arrangements.filter((row) => row.taskId === taskId).length, 1); assert.equal(moved.arrangements.find((row) => row.taskId === taskId)?.periodId, next.id);
    stage = 'atomic editor and selected existing tasks';
    const editing = moved.tasks.find((row) => row.id === taskId); assert.ok(editing);
    const detail = { kind: 'project', title: '合并保存后的名称', priority: 2, executorId: developer.id, milestoneId: null };
    await call('edit', developer, { action: 'save_task', operationId: randomUUID(), taskId, version: editing.version, details: detail }, 403);
    const invalidIntent = { action: 'change_arrangement', taskId, version: editing.version, periodId: next.id, targetPeriodId: period.id };
    const editImpact = v2ImpactSchema.parse(await call('impact', lead, invalidIntent));
    await call('edit', lead, { action: 'save_task', operationId: randomUUID(), taskId, version: editing.version, details: detail, arrangement: { periodId: next.id, targetPeriodId: period.id, plannedDays: 0, confirmation: '0'.repeat(64) } }, 409);
    assert.equal((await state()).tasks.find((row) => row.id === taskId)?.title, editing.title);
    const editCommand = { action: 'save_task', operationId: randomUUID(), taskId, version: editing.version, details: detail, arrangement: { periodId: next.id, targetPeriodId: period.id, plannedDays: 0, confirmation: editImpact.confirmation } };
    await call('edit', lead, editCommand); await call('edit', lead, editCommand);
    const edited = await state(); assert.equal(edited.tasks.find((row) => row.id === taskId)?.title, detail.title); assert.equal(edited.arrangements.find((row) => row.taskId === taskId)?.plannedDays, 0);
    const editedTask = edited.tasks.find((row) => row.id === taskId); assert.ok(editedTask);
    const secondResult = v2ResultSchema.parse(await call('tasks', lead, { ...command, operationId: randomUUID(), task: { ...taskInput, title: '选择已有任务原子性' } }));
    const secondId = secondResult.objectIds[0]; assert.ok(secondId);
    const selected = { action: 'add_existing', operationId: randomUUID(), periodId: next.id, tasks: [{ taskId, version: editedTask.version }, { taskId: secondId, version: 99 }] };
    await call('add-existing', lead, selected, 409);
    assert.equal((await state()).arrangements.some((row) => row.taskId === taskId && row.periodId === next.id), false);
    await call('add-existing', lead, { ...selected, tasks: [{ taskId, version: editedTask.version }, { taskId: secondId, version: 0 }] });
    const selectedState = await state(); assert.equal(selectedState.arrangements.filter((row) => [taskId, secondId].includes(row.taskId) && row.periodId === next.id && row.plannedDays === null).length, 2);
    const futureSummary = z.array(z.object({ taskId: z.string() })).parse(await call(`summary?periodId=${next.id}`, lead)); assert.ok(futureSummary.some((row) => row.taskId === secondId));
    stage = 'filtered shared order preserves other people';
    const thirdTask = v2ResultSchema.parse(await call('tasks', lead, { ...command, operationId: randomUUID(), task: { ...taskInput, executorId: lead.id, periodId: next.id, title: '排序中保留其他人员' } }));
    const orderBefore = v2WeeklyStateSchema.parse(await call(`weekly?summaryPeriodId=${period.id}&planPeriodId=${next.id}`, lead)).taskOrders.find((row) => row.projectId === projectId && row.periodId === next.id); assert.ok(orderBefore);
    const ownOrder = orderBefore.ids.filter((id) => id === taskId || id === secondId).reverse();
    const orderCommand = { action: 'reorder_tasks', operationId: randomUUID(), projectId, periodId: next.id, view: 'plan', executorId: developer.id, version: orderBefore.version, taskIds: ownOrder };
    await call('planning', lead, orderCommand);
    const orderAfter = v2WeeklyStateSchema.parse(await call(`weekly?summaryPeriodId=${period.id}&planPeriodId=${next.id}`, lead)).taskOrders.find((row) => row.projectId === projectId && row.periodId === next.id); assert.ok(orderAfter);
    assert.deepEqual(orderAfter.ids.filter((id) => id === taskId || id === secondId), ownOrder);
    assert.equal(orderAfter.ids.indexOf(thirdTask.objectIds[0] ?? ''), orderBefore.ids.indexOf(thirdTask.objectIds[0] ?? ''));
    await call('planning', lead, { ...orderCommand, operationId: randomUUID() }, 409);
    stage = 'natural week is independent from planning boundaries';
    const boundaryVersion = (await state()).teamVersion;
    const boundary = { action: 'change_periods', version: boundaryVersion, periods: [{ periodId: period.id, version: period.version, startOn: period.startOn, endOn: shiftDate(period.endOn, 1) }, { periodId: next.id, version: next.version, startOn: shiftDate(next.startOn, 1), endOn: next.endOn }] };
    const boundaryImpact = v2ImpactSchema.parse(await call('impact', leader, boundary));
    await call('planning', leader, { ...boundary, operationId: randomUUID(), confirmation: boundaryImpact.confirmation });
    assert.equal((await state()).naturalWeekStart, initial.naturalWeekStart);
    stage = 'private isolation';
    const privateResult = v2ResultSchema.parse(await call('tasks', developer, { action: 'create_private', operationId: randomUUID(), task: { title: '不可向管理者展示的私人内容' } }));
    assert.equal((await state()).tasks.some((task) => task.id === privateResult.objectIds[0]), false);
    await call(`history?taskId=${privateResult.objectIds[0]}`, leader, undefined, 404);
    stage = 'milestone and operator audit';
    const milestoneResult = v2ResultSchema.parse(await call('projects', lead, { action: 'create_milestone', operationId: randomUUID(), projectId, title: '阶段验收', ownerId: lead.id, expectedOn: null }));
    const milestoneId = milestoneResult.objectIds[0]; assert.ok(milestoneId);
    await call('impact', leader, { action: 'complete_milestone', milestoneId, version: 0 }, 403);
    const finishIntent = { action: 'complete_milestone', milestoneId, version: 0 };
    const finish = v2ImpactSchema.parse(await call('impact', lead, finishIntent));
    await call('projects', lead, { ...finishIntent, operationId: randomUUID(), confirmation: finish.confirmation });
    await call('tasks', lead, { action: 'create_project', operationId: randomUUID(), task: { ...taskInput, milestoneId } }, 409);
    const audit = z.array(z.object({ count: z.coerce.number() })).parse(await source.query('SELECT COUNT(*) AS count FROM v2_object_events WHERE object_id=?', [milestoneId])); assert.equal(audit[0]?.count, 2);
    stage = 'milestone unlink confirmation cannot be bypassed by edit';
    const linkedTask = (await state()).tasks.find((row) => row.id === secondId); assert.ok(linkedTask);
    await call('edit', lead, { action: 'save_task', operationId: randomUUID(), taskId: secondId, version: linkedTask.version, status: 'completed', details: { ...detail, title: linkedTask.title, milestoneId } });
    const unlinkVersion = linkedTask.version + 1;
    const unlinkEdit = { action: 'save_task', operationId: randomUUID(), taskId: secondId, version: unlinkVersion, details: { ...detail, title: linkedTask.title } };
    await call('edit', lead, unlinkEdit, 409);
    await call('tasks', lead, { action: 'update_project', operationId: randomUUID(), taskId: secondId, version: unlinkVersion, title: linkedTask.title, priority: 2, executorId: developer.id, milestoneId: null }, 409);
    const unlinkPreview = v2ImpactSchema.parse(await call('impact', lead, { action: 'unlink_milestone', taskId: secondId, version: unlinkVersion }));
    await call('edit', lead, { ...unlinkEdit, milestoneConfirmation: unlinkPreview.confirmation });
    assert.equal((await state()).tasks.find((row) => row.id === secondId)?.milestoneId, null);
    stage = 'team roles and member removal';
    const project = (await state()).projects.find((row) => row.id === projectId); assert.ok(project);
    const withoutDeveloper = { projectId, version: project.version, members: project.members.filter((row) => row.accountId !== developer.id) };
    const blockedMember = v2MemberImpactSchema.parse(await call('members-impact', leader, withoutDeveloper)); assert.ok(blockedMember.blockers.some((row) => row.kind === 'task' && row.id === taskId));
    await call('team', leader, { ...withoutDeveloper, action: 'update_project', name: project.name, operationId: randomUUID() }, 409);
    await call('members-impact', lead, withoutDeveloper, 403);
    const multiple = { projectId, version: project.version, members: project.members.map((row) => row.accountId === developer.id ? { ...row, roles: ['project_lead', 'developer'] } : row) };
    await call('team', leader, { ...multiple, action: 'update_project', name: project.name, operationId: randomUUID() });
    assert.equal((await state()).projects.find((row) => row.id === projectId)?.members.filter((row) => row.roles.includes('project_lead')).length, 2);
    await call('team', leader, { ...multiple, action: 'update_project', name: project.name, operationId: randomUUID() }, 409);
    const noRoles = v2MemberImpactSchema.parse(await call('members-impact', leader, { ...multiple, version: project.version + 1, members: [{ accountId: developer.id, roles: ['developer'] }] })); assert.equal(noRoles.blockers.filter((row) => row.kind === 'role').length, 2);
    await call('team', leader, { action: 'set_message', operationId: randomUUID(), version: (await state()).teamVersion, message: '   ' }); assert.equal((await state()).teamMessage, '');
    stage = 'deleted backlog cannot revive';
    const backlog = v2ResultSchema.parse(await call('projects', manager, { action: 'create_backlog', operationId: randomUUID(), projectId, title: '待建删除回归', priority: 3 }));
    const backlogId = backlog.objectIds[0]; assert.ok(backlogId);
    const deleteBacklog = { action: 'delete_backlog', backlogId, version: 0 };
    const deletion = v2ImpactSchema.parse(await call('impact', manager, deleteBacklog));
    const deleteCommand = { ...deleteBacklog, operationId: randomUUID(), confirmation: deletion.confirmation };
    await call('projects', manager, deleteCommand); await call('projects', manager, deleteCommand);
    await call('projects', manager, { action: 'edit_backlog', operationId: randomUUID(), backlogId, version: 1, title: '不能复活', priority: 1 }, 409);
    stage = 'shared text permissions and conflicts';
    const weeklyPath = `weekly?summaryPeriodId=${period.id}&planPeriodId=${next.id}`;
    const weekly = v2WeeklyStateSchema.parse(await call(weeklyPath, leader));
    const save = { action: 'save', operationId: randomUUID(), summaryPeriodId: period.id, planPeriodId: next.id, version: 0, sourceHash: weekly.currentSourceHash, body: '团队手工稿含受限项目内容' };
    await call('report', leader, save); await call('report', leader, { ...save, operationId: randomUUID() }, 409); await call('report', developer, { ...save, operationId: randomUUID() }, 403);
    const restricted = v2WeeklyStateSchema.parse(await call(weeklyPath, developer)); assert.equal(restricted.canEditText, false); assert.doesNotMatch(restricted.text.body, /团队手工稿|受限项目/);
    const latest = (await state()).tasks.find((task) => task.id === taskId); assert.ok(latest);
    await call('tasks', lead, { action: 'set_status', operationId: randomUUID(), taskId, version: latest.version, status: 'completed' });
    const stale = v2WeeklyStateSchema.parse(await call(weeklyPath, leader)); assert.equal(stale.text.stale, true); assert.equal(stale.text.body, save.body);
    await call('report', leader, { ...save, action: 'regenerate', operationId: randomUUID(), version: 1 }, 409);
    stage = 'sorting defaults, manual and reset';
    await verifySorting({ source, leader, lead, manager, developer, projectId, hiddenProjectId, teamId, periodId: period.id, nextId: next.id, call, state });
    stage = 'revocation before idempotence';
    await source.query('DELETE FROM project_members WHERE project_id=? AND account_id=?', [projectId, lead.id]);
    await call('tasks', lead, command, 403);
    console.log('V2 API smoke passed: shared task, strict permissions, atomic batch, concurrent conflict, real history, last arrangement, private isolation, milestone audit, protected shared text and immediate revocation.');
  } catch (error) {
    console.error(`V2 API smoke failed at ${stage}.`);
    throw error;
  } finally {
    await app?.close();
    await source.transaction(async (db) => {
      const taskRows = z.array(z.object({ id: z.string() })).parse(await db.query(`SELECT id FROM v2_tasks WHERE team_id=? OR executor_id IN (${actors.map(() => '?').join(',')})`, [teamId, ...actors.map((actor) => actor.id)]));
      for (const { id } of taskRows) {
        await db.query('DELETE FROM v2_task_events WHERE task_id=?', [id]); await db.query('DELETE FROM v2_arrangement_history WHERE task_id=?', [id]); await db.query('DELETE FROM v2_arrangements WHERE task_id=?', [id]); await db.query('DELETE FROM v2_placements WHERE task_id=?', [id]);
      }
      await db.query('DELETE FROM v2_backlog WHERE project_id IN (?,?)', [projectId, hiddenProjectId]);
      for (const { id } of taskRows) await db.query('DELETE FROM v2_tasks WHERE id=?', [id]);
      for (const actor of actors) {
        await db.query('DELETE FROM v2_operations WHERE actor_id=?', [actor.id]); await db.query('DELETE FROM v2_categories WHERE owner_id=?', [actor.id]); await db.query('DELETE FROM v2_personal_views WHERE owner_id=?', [actor.id]); await db.query('DELETE FROM login_sessions WHERE account_id=?', [actor.id]); await db.query('DELETE FROM audit_events WHERE actor_id=?', [actor.id]);
      }
      for (const table of ['v2_report_texts', 'v2_shared_orders', 'v2_object_events', 'v2_periods', 'v2_team_settings']) await db.query(`DELETE FROM ${table} WHERE team_id=?`, [teamId]);
      await db.query('DELETE FROM v2_milestones WHERE project_id IN (?,?)', [projectId, hiddenProjectId]); await db.query('DELETE FROM project_members WHERE project_id IN (?,?)', [projectId, hiddenProjectId]); await db.query('DELETE FROM projects WHERE id IN (?,?)', [projectId, hiddenProjectId]);
      await db.query('UPDATE accounts SET team_id=NULL WHERE team_id=?', [teamId]); await db.query('DELETE FROM teams WHERE id=?', [teamId]);
      for (const actor of actors) await db.query('DELETE FROM accounts WHERE id=?', [actor.id]);
    });
    const remaining = z.array(z.object({ count: z.coerce.number() })).parse(await source.query('SELECT COUNT(*) AS count FROM teams WHERE id=?', [teamId])); assert.equal(remaining[0]?.count, 0);
    await source.destroy(); console.log('V2 API fixture and listener cleanup verified.');
  }
}

void smoke().catch((error: unknown) => { if (error instanceof assert.AssertionError) console.error(error.message); else console.error('V2 API verification failed; sensitive diagnostics suppressed.'); process.exitCode = 1; });
