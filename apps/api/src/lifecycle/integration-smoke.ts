import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { lifecyclePreviewSchema, notificationsSchema, organizationSnapshotSchema, personalSnapshotSchema, workSnapshotSchema, handoffSchema, overviewSchema, lifecycleHistorySchema } from '@ntfs/contracts';
import { createDataSource } from '../database/data-source.js';
import { loadEnvironment } from '../config/environment.js';
import { NotificationRepository } from '../notifications/notification.repository.js';
import type { LifecycleIntent } from '@ntfs/contracts';
import { smoke } from '../organization/integration-smoke.js';
import type { Session } from '../organization/integration-smoke.js';

/** 真实事务验证归档、删除、转移及成员撤权，不以静态接口存在代替运行。 */
await smoke(async ({ call, developer, leader, manager, projectId, otherProjectId, ownerId }) => {
  const org = organizationSnapshotSchema.parse(await (await call('organization', leader)).json()); const team = org.teams[0]; const group = org.groups.find((entry) => entry.leaderId === ownerId); assert.ok(team && group);
  const write = async (path: string, body: unknown, auth: Session = leader) => { const response = await call(path, auth, body); const value: unknown = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return z.object({ objectId: z.string() }).parse(value).objectId; };
  const preview = async (intent: LifecycleIntent, auth = leader) => { const response = await call('lifecycle/preview', auth, intent); assert.equal(response.status, 200); return lifecyclePreviewSchema.parse(await response.json()); };
  const execute = async (intent: LifecycleIntent, auth = leader) => { const review = await preview(intent, auth); assert.deepEqual(review.blockers, []); return write('lifecycle/commands', { intent, confirmation: review.confirmation, reason: '生命周期验收', operationId: randomUUID() }, auth); };
  const create = (title: string) => write('work/commands', { action: 'create_task', projectId, title, description: '', acceptance: '', operationId: randomUUID() }, developer);
  const task = await create('转移验收'); const assignmentId = await write('assignments/commands', { action: 'assign', taskId: task, accountId: ownerId, groupId: group.id, content: '', operationId: randomUUID() });
  const personal = await write('personal/commands', { action: 'create_personal', kind: 'work', projectId, assignmentId, title: '关联个人事项', description: '', acceptance: '', categoryId: null, operationId: randomUUID() }, developer);
  const notice = async () => notificationsSchema.parse(await (await call('notifications', developer)).json());
  // 模拟投递完成但提交前断线：通知及投递标记共同回滚，下次真实HTTP读取重试。
  const database = createDataSource(loadEnvironment()); await database.initialize();
  try {
    await assert.rejects(database.transaction(async (manager) => { await new NotificationRepository(manager).deliver(); throw new Error('simulated_delivery_interruption'); }), /simulated_delivery_interruption/);
    const rows: unknown = await database.query('SELECT COUNT(*) AS count FROM notifications n JOIN notification_outbox o ON o.id=n.event_id WHERE o.team_id=?', [team.id]);
    assert.equal(z.array(z.object({ count: z.coerce.number() })).parse(rows)[0]?.count, 0);
  } finally { await database.destroy(); }
  assert.equal((await notice()).length, 1); assert.equal((await notice()).length, 1);
  const first = (await notice())[0]; assert.ok(first);
  assert.equal((await call('notifications/read', manager, { id: first.id })).status, 403);
  assert.equal((await call('notifications/read', developer, { id: first.id })).status, 200);
  assert.ok((await notice())[0]?.readAt);
  const week = '2026-10-12';
  await write('weekly-plans/commands', { action: 'ensure_draft', teamId: team.id, week });
  await write('weekly-plans/commands', { action: 'save_arrangement', teamId: team.id, week, assignmentId, assignmentVersion: 0, taskVersion: 0, version: null, goal: '总览验收', expectedProgress: null, plannedDays: '2.50' });
  const overview = async (auth = leader) => overviewSchema.parse(await (await call(`lifecycle/overview?week=${week}`, auth)).json());
  assert.equal((await overview()).people.find((person) => person.id === ownerId)?.plannedDays, '2.50');
  assert.equal((await overview(manager)).projects.some((project) => project.id === otherProjectId), false);
  assert.equal((await call('lifecycle/overview?week=2026-10-13', leader)).status, 400);
  assert.ok((await preview({ action: 'archive_project', objectId: projectId }, developer)).blockers.length);
  assert.ok((await preview({ action: 'delete_task', objectId: task }, developer)).blockers.length);
  assert.equal((await call('lifecycle/preview', developer, { action: 'transfer_task', objectId: task, targetProjectId: otherProjectId })).status, 403);
  await execute({ action: 'transfer_task', objectId: task, targetProjectId: otherProjectId });
  const moved = personalSnapshotSchema.parse(await (await call('personal', developer)).json()).items.find((entry) => entry.id === personal); assert.equal(moved?.projectId, otherProjectId); assert.equal(moved?.status, 'not_started');
  const target = workSnapshotSchema.parse(await (await call(`work?projectId=${otherProjectId}`, developer)).json()); assert.ok(target.tasks.some((entry) => entry.id === task));
  const independent = await write('personal/commands', { action: 'create_personal', kind: 'work', projectId, assignmentId: null, title: '归档前独立工作', description: '', acceptance: '', categoryId: null, operationId: randomUUID() }, developer);
  assert.ok((await preview({ action: 'archive_project', objectId: projectId }, developer)).blockers.some((text) => text.includes('独立工作')));
  assert.equal((await call('lifecycle/preview', developer, { action: 'transfer_personal', objectId: independent, targetProjectId: otherProjectId })).status, 403);
  await write('personal/commands', { action: 'complete_personal', itemId: independent, version: 0 }, developer);
  await execute({ action: 'archive_project', objectId: projectId }, developer);
  assert.equal((await call('personal/commands', developer, { action: 'start_personal', itemId: independent, version: 1 })).status, 409);
  assert.equal((await call('work/commands', developer, { action: 'create_task', projectId, title: '不能新增', description: '', acceptance: '', operationId: randomUUID() })).status, 409);
  await execute({ action: 'restore_project', objectId: projectId }, developer);
  const changed = await create('确认范围竞争'); const staleReview = await preview({ action: 'delete_task', objectId: changed }, developer);
  await write('assignments/commands', { action: 'assign', taskId: changed, accountId: ownerId, groupId: group.id, content: '', operationId: randomUUID() });
  assert.equal((await call('lifecycle/commands', developer, { intent: { action: 'delete_task', objectId: changed }, confirmation: staleReview.confirmation, reason: '旧确认拒绝', operationId: randomUUID() })).status, 409);
  await execute({ action: 'delete_task', objectId: changed }, developer);
  const disposable = await create('未执行可删除');
  const deletion = { intent: { action: 'delete_task' as const, objectId: disposable }, confirmation: (await preview({ action: 'delete_task', objectId: disposable }, developer)).confirmation, reason: '重复收据验证', operationId: randomUUID() };
  assert.equal(await write('lifecycle/commands', deletion, developer), disposable);
  assert.equal(await write('lifecycle/commands', deletion, developer), disposable);
  assert.equal((await call('lifecycle/commands', developer, { ...deletion, reason: '不可复用为另一请求' })).status, 409);
  assert.equal(workSnapshotSchema.parse(await (await call(`work?projectId=${projectId}`, developer)).json()).tasks.some((entry) => entry.id === disposable), false);

  // 未执行的责任终止不能冒充执行；已执行后移除、退出或转交仍须保留任务。
  await database.initialize();
  try {
    for (const action of ['remove', 'exit', 'transfer'] as const) {
      for (const evidence of ['none', 'start', 'times', 'progress'] as const) {
        const candidate = await create(`责任终止删除回归-${action}-${evidence}`);
        const claimed = await write('assignments/commands', { action: 'claim', taskId: candidate, groupId: group.id, content: '', operationId: randomUUID() }, developer);
        let version = 0;
        if (evidence === 'start') {
          await write('assignments/commands', { action: 'start', assignmentId: claimed, version: version++ }, developer);
        } else if (evidence === 'times') {
          // 清空当前时间后仍由历史事件阻止删除，不能仅依赖当前快照。
          for (const startedAt of ['2026-10-01T01:00:00.000Z', null]) {
            await write('assignments/commands', { action: 'correct_times', assignmentId: claimed, version: version++, startedAt, endedAt: null }, developer);
          }
        } else if (evidence === 'progress') {
          await write('assignments/commands', { action: 'record_progress', assignmentId: claimed, version: version++, occurredOn: week, reportWeek: week, content: '已产生真实进展', operationId: randomUUID() }, developer);
        }
        await write('assignments/commands', action === 'transfer'
          ? { action, assignmentId: claimed, version, accountId: team.leaderId, groupId: null, content: '', reason: '回归验证责任转交', operationId: randomUUID() }
          : action === 'exit' ? { action, assignmentId: claimed, version, reason: '回归验证退出认领' }
            : { action, assignmentId: claimed, version }, action === 'exit' ? developer : leader);
        const intent = { action: 'delete_task' as const, objectId: candidate };
        const review = await preview(intent, developer);
        if (evidence === 'none') {
          assert.deepEqual(review.blockers, [], `${action}: 未执行分工不应阻止删除`);
          await execute(intent, developer);
          // 实际删除后回读数据库，确认分工已删除而责任变更历史仍保留。
          assert.deepEqual(await database.query('SELECT id FROM team_tasks WHERE id=?', [candidate]), []);
          assert.deepEqual(await database.query('SELECT id FROM task_assignments WHERE task_id=?', [candidate]), []);
          const events: unknown = await database.query('SELECT action FROM work_events WHERE object_id=? AND action=?', [claimed, `assignment.${action}`]);
          assert.equal(z.array(z.object({ action: z.string() })).parse(events).length, 1);
        } else {
          assert.ok(review.blockers.some((entry) => entry.includes('执行事实')), `${action}/${evidence}: 执行历史必须阻止删除`);
          assert.equal((await call('lifecycle/commands', developer, { intent, confirmation: review.confirmation, operationId: randomUUID() })).status, 409);
          const rows: unknown = await database.query('SELECT id FROM team_tasks WHERE id=?', [candidate]);
          assert.equal(z.array(z.object({ id: z.string() })).parse(rows).length, 1);
        }
      }
    }
  } finally { await database.destroy(); }
  console.log('PASS: 12 responsibility-ending deletion cases, HTTP rejection of executed work, database readback and retained audit history');

  // 多次误开始都已撤销时可以不填原因删除；旧确认仍必须失效。
  const mistaken = await create('误开始撤销后可删除');
  const mistakenIntent = { action: 'delete_task' as const, objectId: mistaken };
  const beforeStart = await preview(mistakenIntent, developer);
  for (let cycle = 0; cycle < 2; cycle++) {
    await write('tasks/commands', { action: 'start_task', taskId: mistaken, version: cycle * 2 }, developer);
    assert.ok((await preview(mistakenIntent, developer)).blockers.length);
    await write('tasks/commands', { action: 'undo_start_task', taskId: mistaken, version: cycle * 2 + 1 }, developer);
  }
  const afterUndo = await preview(mistakenIntent, developer); assert.deepEqual(afterUndo.blockers, []);
  assert.equal((await call('lifecycle/commands', developer, { intent: mistakenIntent, confirmation: beforeStart.confirmation, operationId: randomUUID() })).status, 409);
  await write('lifecycle/commands', { intent: mistakenIntent, confirmation: afterUndo.confirmation, operationId: randomUUID() }, developer);
  const afterDelete = workSnapshotSchema.parse(await (await call(`work?projectId=${projectId}`, developer)).json());
  assert.equal(afterDelete.tasks.some((entry) => entry.id === mistaken), false);
  assert.equal(afterDelete.events.filter((entry) => entry.objectId === mistaken && entry.action === 'task.undo_start_task').length, 2);
  assert.equal((await call('lifecycle/commands', leader, { intent: { action: 'archive_project', objectId: projectId }, confirmation: '0'.repeat(64), operationId: randomUUID() })).status, 400);

  // 已撤销开始不能抹去后来填写再归零的进展，也不能抹去补记时间。
  for (const kind of ['progress', 'times']) {
    const factual = await create(`撤销后${kind}历史保留`);
    await write('tasks/commands', { action: 'start_task', taskId: factual, version: 0 }, developer);
    await write('tasks/commands', { action: 'undo_start_task', taskId: factual, version: 1 }, developer);
    for (let step = 0; step < 2; step++) await write('tasks/commands', kind === 'progress'
      ? { action: 'task_progress', taskId: factual, version: 2 + step, progress: step ? 0 : 10 }
      : { action: 'task_times', taskId: factual, version: 2 + step, startedAt: step ? null : '2026-10-01T01:00:00.000Z', endedAt: null }, developer);
    assert.ok((await preview({ action: 'delete_task', objectId: factual }, developer)).blockers.some((entry) => entry.includes('执行事实')));
  }
  const executedTask = await create('个人执行历史禁止删除');
  const executedAssignment = await write('assignments/commands', { action: 'assign', taskId: executedTask, accountId: ownerId, groupId: group.id, content: '', operationId: randomUUID() });
  const executedItem = await write('personal/commands', { action: 'create_personal', kind: 'work', projectId, assignmentId: executedAssignment, title: '删除后仍保留执行历史', description: '', acceptance: '', categoryId: null, operationId: randomUUID() }, developer);
  await write('personal/commands', { action: 'personal_progress', itemId: executedItem, version: 0, occurredOn: '2026-10-14', reportWeek: week, content: '执行事实', operationId: randomUUID() }, developer);
  await execute({ action: 'delete_personal', objectId: executedItem }, developer);
  assert.ok((await preview({ action: 'delete_task', objectId: executedTask }, developer)).blockers.some((text) => text.includes('执行事实')));
  const privateId = await write('personal/commands', { action: 'create_personal', kind: 'private', projectId: null, assignmentId: null, title: '私人保留', description: '', acceptance: '', categoryId: null, operationId: randomUUID() }, developer);
  await execute({ action: 'remove_member', objectId: ownerId });
  assert.ok((await preview({ action: 'remove_project_member', objectId: ownerId, projectId })).blockers.length);
  await execute({ action: 'remove_project_member', objectId: ownerId, projectId: otherProjectId });
  assert.equal((await call(`work?projectId=${otherProjectId}`, developer)).status, 403);
  const own = personalSnapshotSchema.parse(await (await call('personal', developer)).json()); assert.equal(own.items.some((entry) => entry.id === personal), false); assert.equal(own.items.some((entry) => entry.id === privateId), true);
  assert.equal((await call('personal/commands', developer, { action: 'personal_progress', itemId: personal, version: moved?.version, occurredOn: '2026-10-14', reportWeek: '2026-10-12', content: '禁止旧团队写入', operationId: randomUUID() })).status, 403);
  assert.equal((await notice()).length, 0);
  const handoff = handoffSchema.parse(await (await call('lifecycle/handoff', leader)).json()); assert.ok(handoff.some((entry) => entry.accountId === ownerId && entry.tasks.some((item) => item.id === task)));
  await execute({ action: 'delete_personal', objectId: privateId }, developer);
  const audit = lifecycleHistorySchema.parse(await (await call('lifecycle/history', leader)).json());
  assert.ok(audit.some((entry) => entry.objectId === disposable)); assert.equal(audit.some((entry) => entry.objectId === privateId), false);
  assert.equal(audit.find((entry) => entry.objectId === mistaken)?.reason, '');
  assert.equal((await call('lifecycle/history', developer)).status, 403);
  // 夹具后续组织回归需要恢复成员；使用现有授权账号关联流程。
  const account = org.accounts.find((entry) => entry.id === ownerId); assert.ok(account);
  assert.equal((await call('organization/commands', leader, { action: 'link_member', teamId: team.id, loginName: account.loginName })).status, 204);
  console.log('PASS: transfer preserves personal facts, archive guards, restricted deletion, immediate member revocation/private retention, handoff and notification dedup/read isolation');
});
