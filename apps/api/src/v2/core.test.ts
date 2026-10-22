import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { v2DateSchema, v2ProjectTaskInputSchema, v2PrivateTaskInputSchema, v2TaskCommandSchema, v2TaskEventSchema, v2TaskSchema, type V2Category, type V2TaskEvent, type V2ArrangementHistory, type V2Milestone, type V2Period, type V2Task } from '@ntfs/contracts';
import { naturalWeek, periodWindow, shanghaiDate, validatePeriodChanges } from './calendar.js';
import { canChangeTaskStatus, canConfirmMilestone, canCreateProjectTask, canDeleteTask, canManageProject, canViewTask, type V2Actor, type V2ProjectAccess } from './permissions.js';
import { summarizePeriod } from './history.js';
import { milestoneAfterTaskChange, rearrangeTask, transitionTask, validateMilestoneCompletion, validateMilestoneLink } from './task-rules.js';
import { destinationCategory, removeCategory, validateCategories } from './personal-view.js';

const team = randomUUID(), projectId = randomUUID(), executor = randomUUID(), manager = randomUUID(), lead = randomUUID(), leader = randomUUID(), creator = randomUUID();
const project: V2ProjectAccess = { id: projectId, teamId: team, teamLeaderId: leader, members: [{ accountId: executor, roles: ['developer'] }, { accountId: creator, roles: ['developer'] }, { accountId: manager, roles: ['project_manager'] }, { accountId: lead, roles: ['project_lead'] }] };
const actor = (id: string): V2Actor => ({ id, teamId: team, disabled: false, isSuperAdmin: false });
const period: V2Period = { id: randomUUID(), teamId: team, startOn: '2026-10-12', endOn: '2026-10-18', version: 0 };
const second: V2Period = { ...period, id: randomUUID(), startOn: '2026-10-19', endOn: '2026-10-25' };
const third: V2Period = { ...period, id: randomUUID(), startOn: '2026-10-26', endOn: '2026-11-01' };
const initial: V2Task = { id: randomUUID(), kind: 'project', teamId: team, projectId, creatorId: creator, executorId: executor, milestoneId: null, title: '状态历史验收', priority: 3, status: 'not_started', version: 0, completedAt: null, deletedAt: null, createdAt: '2026-10-09T04:00:00.000Z', updatedAt: '2026-10-09T04:00:00.000Z' };

/** 测试夹具保持真实事件契约，事件不直接复用可变当前状态。 */
function event(task: V2Task, at: string, action: V2TaskEvent['action'], beforeStatus: V2TaskEvent['beforeStatus']): V2TaskEvent {
  return v2TaskEventSchema.parse({ id: randomUUID(), taskId: task.id, sequence: task.version, actorId: lead, occurredAt: at, action, beforeStatus, snapshot: task });
}
function arrangement(task: V2Task, target: V2Period, from = '2026-10-10T00:00:00.000Z'): V2ArrangementHistory {
  return { id: randomUUID(), taskId: task.id, periodId: target.id, validFrom: from, validUntil: null, provenance: 'scheduled', plannedDays: null };
}

test('V2 输入拒绝多人、无区间、旧审批和私人项目字段，不将空估算变为零', () => {
  const fields = { projectId, title: '事项', executorId: executor, periodId: period.id };
  assert.equal(v2ProjectTaskInputSchema.parse(fields).plannedDays, null);
  assert.equal(v2ProjectTaskInputSchema.parse({ ...fields, plannedDays: 0 }).plannedDays, 0);
  for (const invalid of [{ ...fields, periodId: undefined }, { ...fields, executorId: [executor, lead] }, { ...fields, plannedDays: 0.123 }, { ...fields, description: '旧说明' }]) assert.equal(v2ProjectTaskInputSchema.safeParse(invalid).success, false);
  assert.equal(v2PrivateTaskInputSchema.safeParse({ title: '私人', projectId }).success, false);
  assert.equal(v2TaskCommandSchema.safeParse({ operationId: randomUUID(), action: 'accept_request' }).success, false);
  assert.equal(v2DateSchema.safeParse('2026-02-30').success, false);
  assert.equal(v2TaskSchema.safeParse({ ...initial, status: 'cancelled' }).success, false);
});

test('上海区间午夜为半开边界，跨月自然周不依赖本机时区', () => {
  assert.equal(shanghaiDate('2026-10-18T16:00:00.000Z'), '2026-10-19');
  assert.deepEqual(periodWindow(period), { start: '2026-10-11T16:00:00.000Z', endExclusive: '2026-10-18T16:00:00.000Z' });
  assert.deepEqual(naturalWeek('2026-11-01'), { startOn: '2026-10-26', endOn: '2026-11-01' });
});

test('日期调整保护已结束边界，拒绝缺口、重叠、删除和过期版本', () => {
  const current = [period, second, third];
  validatePeriodChanges(current, [period, { ...second, endOn: '2026-10-27' }, { ...third, startOn: '2026-10-28' }], '2026-10-20');
  assert.throws(() => validatePeriodChanges(current, [{ ...period, endOn: '2026-10-19' }, { ...second, startOn: '2026-10-20' }, third], '2026-10-20'), /已结束/);
  assert.throws(() => validatePeriodChanges(current, [period, { ...second, startOn: '2026-10-20' }, third], '2026-10-16'), /连续/);
  assert.throws(() => validatePeriodChanges(current, [period, { ...second, endOn: '2026-10-26' }, third], '2026-10-16'), /不重叠/);
  assert.throws(() => validatePeriodChanges(current, [second, third], '2026-10-16'), /不能删除/);
  assert.throws(() => validatePeriodChanges(current, [period, { ...second, version: 1 }, third], '2026-10-16'), /已变化/);
});

test('成员可看项目全部工作，经理不能编排，管理权不外溢到私人、其他项目和超管', () => {
  assert.equal(canViewTask(actor(creator), initial, project), true);
  assert.equal(canManageProject(actor(manager), project), false);
  assert.equal(canCreateProjectTask(actor(manager), project, manager), false);
  assert.equal(canCreateProjectTask(actor(executor), project, executor), true);
  assert.equal(canCreateProjectTask(actor(executor), project, lead), false);
  assert.equal(canCreateProjectTask(actor(lead), project, executor), true);
  assert.equal(canCreateProjectTask(actor(leader), project, randomUUID()), false);
  assert.equal(canChangeTaskStatus(actor(lead), initial, project), true);
  assert.equal(canChangeTaskStatus(actor(creator), initial, project), false);
  assert.equal(canChangeTaskStatus({ ...actor(executor), disabled: true }, initial, project), false);
  assert.equal(canViewTask({ ...actor(leader), isSuperAdmin: true }, initial, project), false);
  assert.equal(canViewTask({ ...actor(leader), teamId: randomUUID() }, initial, project), false);
  assert.equal(canViewTask(actor(leader), initial, { ...project, id: randomUUID() }), false);
  const privateTask: V2Task = { ...initial, kind: 'private', teamId: null, projectId: null, milestoneId: null, creatorId: executor };
  assert.equal(canViewTask(actor(leader), privateTask, project), false);
  assert.equal(canViewTask(actor(executor), privateTask), true);
});

test('完成再回退保留事件，创建人按当前未开始状态恢复删除权', () => {
  const done = transitionTask(initial, 'completed', '2026-10-12T01:00:00.000Z');
  const reopened = transitionTask(done, 'in_progress', '2026-10-13T01:00:00.000Z');
  const restarted = transitionTask(reopened, 'not_started', '2026-10-13T02:00:00.000Z');
  const completedAgain = transitionTask(reopened, 'completed', '2026-10-19T01:00:00.000Z');
  assert.equal(done.completedAt, '2026-10-12T01:00:00.000Z');
  assert.equal(reopened.completedAt, null);
  assert.equal(completedAgain.completedAt, '2026-10-19T01:00:00.000Z');
  assert.equal(canDeleteTask(actor(creator), done, project), false);
  assert.equal(canDeleteTask(actor(creator), restarted, project), true);
  assert.equal(canDeleteTask(actor(executor), restarted, project), false);
  assert.equal(canDeleteTask(actor(lead), done, project), true);
});

test('取消最后安排被拒绝，原子改排不覆盖目标已有区间', () => {
  assert.throws(() => rearrangeTask([period.id], period.id, null), /最后一个/);
  assert.deepEqual(rearrangeTask([period.id], period.id, second.id), [second.id]);
  assert.deepEqual(rearrangeTask([period.id, second.id], period.id, null), [second.id]);
  assert.throws(() => rearrangeTask([period.id, second.id], period.id, second.id), /已有安排/);
});

test('任意项目研发负责人可确认里程碑，团队负责人不自动取得确认权', () => {
  const milestone: V2Milestone = { id: randomUUID(), projectId, title: '目标', expectedOn: null, ownerId: executor, status: 'open', needsReview: false, version: 0 };
  assert.equal(canConfirmMilestone(actor(lead), milestone, project), true);
  assert.equal(canConfirmMilestone(actor(leader), milestone, project), false);
  assert.equal(canConfirmMilestone(actor(executor), milestone, project), false);
  validateMilestoneCompletion(milestone, []);
  const task: V2Task = { ...initial, milestoneId: milestone.id };
  assert.throws(() => validateMilestoneCompletion(milestone, [task]), /1 条/);
  const completed: V2Milestone = { ...milestone, status: 'completed' };
  assert.throws(() => validateMilestoneLink(task, completed), /先重开/);
  assert.throws(() => validateMilestoneLink({ ...task, projectId: randomUUID() }, milestone), /本项目/);
  const done = transitionTask(task, 'completed', '2026-10-12T01:00:00.000Z');
  const changed = milestoneAfterTaskChange(completed, done, task);
  assert.equal(changed.status, 'completed'); assert.equal(changed.needsReview, true);
});

test('历史总结涵盖跨区间持续进行，之后完成与重开不回写历史', () => {
  const started = transitionTask(initial, 'in_progress', '2026-10-13T01:00:00.000Z');
  const done = transitionTask(started, 'completed', '2026-10-28T01:00:00.000Z');
  const reopened = transitionTask(done, 'in_progress', '2026-11-03T01:00:00.000Z');
  const history = [event(initial, initial.createdAt, 'created', null), event(started, started.updatedAt, 'status_changed', 'not_started'), event(done, done.updatedAt, 'status_changed', 'in_progress'), event(reopened, reopened.updatedAt, 'status_changed', 'completed')];
  const arrangements = [arrangement(initial, period)];
  const now = '2026-11-04T01:00:00.000Z';
  const first = summarizePeriod(period, history, arrangements, now)[0];
  assert.equal(first?.status, 'in_progress'); assert.equal(first?.planning, 'planned');
  const ongoing = summarizePeriod(second, history, arrangements, now)[0];
  assert.equal(ongoing?.status, 'in_progress'); assert.equal(ongoing?.executed, true); assert.equal(ongoing?.arranged, false); assert.equal(ongoing?.planning, 'planned');
  assert.equal(summarizePeriod(third, history, arrangements, now)[0]?.status, 'completed');
  assert.equal(history[1]?.actorId, lead);
});

test('区间末午夜变化归入下一区间，相同毫秒按版本回看', () => {
  const done = transitionTask(initial, 'completed', '2026-10-18T16:00:00.000Z');
  const reopened = transitionTask(done, 'in_progress', done.updatedAt);
  const history = [event(reopened, reopened.updatedAt, 'status_changed', 'completed'), event(initial, initial.createdAt, 'created', null), event(done, done.updatedAt, 'status_changed', 'not_started')];
  assert.equal(summarizePeriod(period, history, [arrangement(initial, period)], '2026-10-20T01:00:00.000Z')[0]?.status, 'not_started');
  assert.equal(summarizePeriod(second, history, [], '2026-10-20T01:00:00.000Z')[0]?.status, 'in_progress');
});

test('撤销安排不伪造计划内，迁移补录不补造历史状态，私人任务不进入总结', () => {
  const migrated = { ...initial, version: 1, updatedAt: '2026-10-16T04:00:00.000Z' };
  const history = [event(migrated, migrated.updatedAt, 'migrated', null)];
  const supplement: V2ArrangementHistory = { ...arrangement(migrated, period, migrated.updatedAt), provenance: 'migration_supplement' };
  const row = summarizePeriod(period, history, [supplement], '2026-10-17T00:00:00.000Z')[0];
  assert.equal(row?.historyIncomplete, true); assert.equal(row?.planning, 'unknown');
  assert.equal(summarizePeriod(period, history, [{ ...supplement, validFrom: '2026-10-10T00:00:00.000Z' }], '2026-10-15T00:00:00.000Z')[0]?.status, null);
  const cancelled = { ...arrangement(initial, period), validUntil: '2026-10-11T00:00:00.000Z' };
  assert.equal(summarizePeriod(period, [event(initial, initial.createdAt, 'created', null)], [cancelled], '2026-10-20T00:00:00.000Z').length, 0);
  const privateTask: V2Task = { ...initial, kind: 'private', teamId: null, projectId: null, milestoneId: null, creatorId: executor };
  assert.equal(summarizePeriod(period, [event(privateTask, privateTask.createdAt, 'created', null)], [arrangement(privateTask, period)], '2026-10-20T00:00:00.000Z').length, 0);
});

test('区间结束后迁移仍承接该区间安排，补录不补造历史状态或提前计划', () => {
  const at = '2026-10-20T04:00:00.000Z';
  const migrated = { ...initial, version: 1, updatedAt: at };
  const history = [event(migrated, at, 'migrated', null)];
  const supplement: V2ArrangementHistory = { ...arrangement(migrated, period, at), provenance: 'migration_supplement' };
  const row = summarizePeriod(period, history, [supplement], '2026-10-21T00:00:00.000Z')[0];
  assert.equal(row?.arranged, true); assert.equal(row?.status, null); assert.equal(row?.historyIncomplete, true); assert.equal(row?.planning, 'unknown');
  assert.equal(summarizePeriod(period, history, [{ ...supplement, provenance: 'migration_unknown' }], '2026-10-21T00:00:00.000Z')[0]?.planning, 'unknown');
  assert.equal(summarizePeriod(period, history, [supplement], '2026-10-19T00:00:00.000Z').length, 0);
  assert.equal(summarizePeriod(period, history, [{ ...supplement, provenance: 'scheduled' }], '2026-10-21T00:00:00.000Z').length, 0);
});

test('默认分类唯一、手动分类优先、同状态字段编辑保持位置，删除接收默认职责', () => {
  const categories: V2Category[] = ['not_started', 'in_progress', 'completed'].map((status, position) => ({ id: randomUUID(), ownerId: executor, name: status, status: status === 'not_started' ? 'not_started' : status === 'in_progress' ? 'in_progress' : 'completed', isDefault: true, position, version: 0 }));
  const ongoing = categories.find((category) => category.status === 'in_progress'); assert.ok(ongoing);
  const custom: V2Category = { ...ongoing, id: randomUUID(), name: '等待联调', isDefault: false };
  const all = [...categories, custom]; validateCategories(all, executor);
  const placement = { taskId: initial.id, categoryId: custom.id, position: 4, priority: 3 };
  assert.equal(destinationCategory(all, 'in_progress', placement, 'in_progress'), custom.id);
  assert.equal(destinationCategory(all, 'in_progress', placement, 'not_started'), ongoing.id);
  assert.equal(destinationCategory(all, 'in_progress', placement, 'not_started', custom.id), custom.id);
  assert.throws(() => validateCategories([...categories, { ...custom, isDefault: true }], executor), /唯一|仅有一个/);
  assert.equal(removeCategory(all, ongoing.id, custom.id).find((category) => category.id === custom.id)?.isDefault, true);
  assert.throws(() => removeCategory(categories, ongoing.id, ongoing.id), /最后一个/);
});


test('突发新任务仅首次当前区间计划外，已有执行偏移、延续和待建转换不算', () => {
  const createdAt = '2026-10-12T01:00:00.000Z';
  const task = { ...initial, createdAt, updatedAt: createdAt };
  const created = event(task, createdAt, 'created', null);
  const rows = [arrangement(task, period, createdAt)];
  assert.equal(summarizePeriod(period, [created], rows, '2026-10-13T00:00:00.000Z')[0]?.planning, 'unplanned');
  assert.equal(summarizePeriod(period, [{ ...created, fromBacklog: true }], rows, '2026-10-13T00:00:00.000Z')[0]?.planning, 'planned');
  const started = transitionTask(task, 'in_progress', '2026-10-13T01:00:00.000Z');
  const history = [created, event(started, started.updatedAt, 'status_changed', 'not_started')];
  assert.equal(summarizePeriod(second, history, rows, '2026-10-21T00:00:00.000Z')[0]?.planning, 'planned');
  const futureRows = [arrangement(task, second, createdAt)];
  assert.equal(summarizePeriod(period, history, futureRows, '2026-10-14T00:00:00.000Z')[0]?.planning, 'planned');
  assert.equal(summarizePeriod(period, history, [...rows.map((row) => ({ ...row, validUntil: '2026-10-14T00:00:00.000Z' })), arrangement(task, second, '2026-10-14T00:00:00.000Z')], '2026-10-21T00:00:00.000Z')[0]?.planning, 'unplanned');
});

test('未开始移出周期立即移除总结，曾进行中再退回也不保留，周期结束不重新出现', () => {
  const started = transitionTask(initial, 'in_progress', '2026-10-13T01:00:00.000Z');
  const reset = transitionTask(started, 'not_started', '2026-10-14T01:00:00.000Z');
  const created = event(initial, initial.createdAt, 'created', null);
  const histories = [[created], [created, event(started, started.updatedAt, 'status_changed', 'not_started'), event(reset, reset.updatedAt, 'status_changed', 'in_progress')]];
  const movedAt = '2026-10-14T02:00:00.000Z';
  const rows = [{ ...arrangement(initial, period), validUntil: movedAt }, arrangement(initial, second, movedAt)];
  for (const history of histories) {
    assert.equal(summarizePeriod(period, history, rows, '2026-10-14T01:30:00.000Z')[0]?.status, 'not_started');
    for (const now of [movedAt, '2026-10-21T00:00:00.000Z']) assert.equal(summarizePeriod(period, history, rows, now).length, 0);
    assert.equal(summarizePeriod(second, history, rows, '2026-10-21T00:00:00.000Z')[0]?.status, 'not_started');
    assert.equal(summarizePeriod(period, history, [...rows, arrangement(initial, period, '2026-10-15T00:00:00.000Z')], '2026-10-16T00:00:00.000Z').length, 1);
  }
});

test('改期后回退未开始同样移除，仍进行中或已完成保留实际执行', () => {
  const movedAt = '2026-10-14T00:00:00.000Z';
  const started = transitionTask(initial, 'in_progress', '2026-10-13T01:00:00.000Z');
  const history = [event(initial, initial.createdAt, 'created', null), event(started, started.updatedAt, 'status_changed', 'not_started')];
  const rows = [{ ...arrangement(initial, period), validUntil: movedAt }, arrangement(initial, second, movedAt)];
  assert.equal(summarizePeriod(period, history, rows, movedAt)[0]?.status, 'in_progress');
  for (const status of ['not_started', 'completed'] as const) {
    const changed = transitionTask(started, status, '2026-10-15T00:00:00.000Z');
    const result = summarizePeriod(period, [...history, event(changed, changed.updatedAt, 'status_changed', 'in_progress')], rows, changed.updatedAt);
    assert.equal(result.length, status === 'completed' ? 1 : 0);
  }
});

test('区间结束后改期和回退不改写当时安排与状态，午夜取消保留前一区间', () => {
  const boundary = periodWindow(period).endExclusive;
  const created = event(initial, initial.createdAt, 'created', null);
  for (const movedAt of [boundary, '2026-10-20T00:00:00.000Z']) {
    const rows: V2ArrangementHistory[] = [{ ...arrangement(initial, period), validUntil: movedAt }, arrangement(initial, second, movedAt)];
    assert.equal(summarizePeriod(period, [created], rows, '2026-10-21T00:00:00.000Z')[0]?.status, 'not_started');
  }
  const started = transitionTask(initial, 'in_progress', '2026-10-13T00:00:00.000Z');
  const reset = transitionTask(started, 'not_started', boundary);
  const history = [created, event(started, started.updatedAt, 'status_changed', 'not_started'), event(reset, reset.updatedAt, 'status_changed', 'in_progress')];
  const rows = [{ ...arrangement(initial, period), validUntil: '2026-10-14T00:00:00.000Z' }, arrangement(initial, second)];
  assert.equal(summarizePeriod(period, history, rows, '2026-10-21T00:00:00.000Z')[0]?.status, 'in_progress');
});
