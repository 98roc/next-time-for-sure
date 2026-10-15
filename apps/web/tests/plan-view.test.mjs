import assert from 'node:assert/strict';
import test from 'node:test';
import { groupPlanEntries, planCounts, planEntries, publicationPlanEntries, planText } from '../src/weekly-plans/plan-view.ts';

const organization = { groups: [{ id: 'backend', name: '后端组' }, { id: 'frontend', name: '前端组' }] };
const candidate = (assignmentId, taskId, accountId, groupId) => ({ assignmentId, taskId, accountId, groupId, assignmentVersion: 0, taskVersion: 0, projectId: 'project', projectName: '项目', taskTitle: taskId === 'one' ? '档案' : '进度', displayName: '同名成员', groupName: groupId === 'backend' ? '后端组' : '前端组', content: '', status: 'not_started', blockedReason: '' });
const candidates = [candidate('a', 'one', 'person-a', 'backend'), candidate('b', 'two', 'person-b', 'backend'), candidate('c', 'two', 'person-c', 'frontend')];
const rows = candidates.map((entry) => ({ projectId: entry.projectId, projectName: entry.projectName, taskId: entry.taskId, title: entry.taskTitle, accountId: entry.accountId, person: entry.displayName, groupId: entry.groupId, text: '', plannedDays: null, status: 'not_started/not_started', sourceIds: [entry.assignmentId] }));
const arrangements = candidates.map((entry) => ({ id: `plan-${entry.assignmentId}`, assignmentId: entry.assignmentId, version: 0, goal: '', plannedDays: null, expectedProgress: null, sourceWeek: null }));
const data = () => ({ canEdit: true, candidates, draft: { rows, arrangements }, publications: [] });

test('历史汇总保留快照内容与已完成记录，三个视图不修改来源', () => {
  const snapshot = rows.map((row) => ({ ...row, title: `历史${row.title}`, status: 'completed/completed', text: '发布时目标' }));
  const original = structuredClone(snapshot);
  const entries = publicationPlanEntries(snapshot, organization);
  for (const view of ['project', 'group', 'person']) {
    const displayed = groupPlanEntries(entries, view).flatMap((group) => group.tasks.flatMap((task) => task.entries));
    assert.equal(displayed.length, 3);
    assert.ok(displayed.every((entry) => entry.text === '发布时目标' && !entry.stopped && !entry.candidate));
  }
  assert.deepEqual(snapshot, original);
  assert.deepEqual(planCounts(entries), { tasks: 2, people: 3, pending: 0 });
});

test('复制汇总每个任务只写一次标题，保留全部人员及投入', () => {
  const entries = publicationPlanEntries(rows.map((row) => ({ ...row, plannedDays: '1.5', text: '本周目标' })), organization);
  const text = planText(entries);
  assert.equal(text.match(/· 进度/g)?.length, 1);
  assert.equal(text.match(/同名成员/g)?.length, 3);
  assert.equal(text.match(/投入1.5天/g)?.length, 3);
});

test('待分配事项在安排页保留移出所需版本，发布副本不提供编辑引用', () => {
  const pending = { id: 'pending-one', taskId: 'one', version: 3, sourceWeek: null };
  const pendingRow = { ...rows[0], accountId: null, person: '待分配', sourceIds: [pending.id] };
  const state = { ...data(), draft: { rows: [pendingRow], arrangements: [], pending: [pending] } };
  assert.equal(planEntries(state, organization, false)[0].pending.version, 3);
  assert.equal(publicationPlanEntries([pendingRow], organization)[0].pending, undefined);
});

test('两个任务三条分工：项目合并标题，跨组展示不增加任务计数', () => {
  const entries = planEntries(data(), organization, false);
  assert.deepEqual(planCounts(entries), { tasks: 2, people: 3, pending: 0 });
  const projects = groupPlanEntries(entries, 'project');
  assert.equal(projects.length, 1);
  assert.deepEqual(projects[0].tasks.map((task) => task.entries.length), [1, 2]);
  assert.deepEqual(groupPlanEntries(entries, 'group').map((group) => group.tasks.length), [2, 1]);
  // 同名人员按账号聚合，不能被姓名去重合并。
  assert.equal(groupPlanEntries(entries, 'person').length, 3);
});

test('完成与转交记录保留且禁止再安排，未排分工仅出现在待安排', () => {
  const completed = { ...data(), candidates: [candidates[1]], draft: { rows: [{ ...rows[0], status: 'completed/not_started' }, { ...rows[2], status: 'in_progress/transferred' }], arrangements: [arrangements[0], arrangements[2]] } };
  const entries = planEntries(completed, organization, false);
  assert.equal(entries.length, 2);
  assert.ok(entries.every((entry) => entry.stopped && !entry.candidate));
  assert.deepEqual(planEntries(completed, organization, true).map((entry) => entry.key), ['b']);
});

test('只读视图只使用已发布副本，不混入当前草稿或未发布任务', () => {
  const state = { ...data(), canEdit: false, publications: [{ rows: [{ ...rows[0], title: '发布时的名称' }] }] };
  const entries = planEntries(state, organization, false);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, '发布时的名称');
  assert.equal(planEntries({ ...state, publications: [] }, organization, false).length, 0);
});

test('团队直属与待分配分别成组，投入和来源保留，不以重名任务合并', () => {
  const state = { ...data(), candidates: [], draft: { arrangements: [], rows: [
    { ...rows[0], title: '同名任务', groupId: null, plannedDays: '1.25' },
    { ...rows[1], title: '同名任务', groupId: null, accountId: null, person: '待分配', sourceIds: ['pending'] },
  ] } };
  const entries = planEntries(state, organization, false);
  assert.deepEqual(groupPlanEntries(entries, 'group').map((group) => group.title), ['团队直属', '待分配']);
  assert.equal(groupPlanEntries(entries, 'project')[0].tasks.length, 2);
  assert.equal(entries[0].plannedDays, '1.25');
  assert.deepEqual(planCounts(entries), { tasks: 2, people: 1, pending: 1 });
});
