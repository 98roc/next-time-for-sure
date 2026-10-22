import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { v2TaskEventSchema, type V2Task } from '@ntfs/contracts';
import { dailyRows, generateDailyText } from './daily-report.js';
import { periodWindow } from './calendar.js';
import type { SubtaskSnapshot } from './personal-work.repository.js';

const ownerId = randomUUID(), projectId = randomUUID(), { start, endExclusive } = periodWindow({ startOn: '2026-10-22', endOn: '2026-10-22' });
const task: V2Task = { id: randomUUID(), title: '当时的名称', kind: 'project', teamId: randomUUID(), projectId, creatorId: ownerId, executorId: ownerId, milestoneId: null, priority: 3, status: 'completed', completedAt: start, createdAt: start, updatedAt: start, deletedAt: null, version: 1 };
const event = (snapshot: V2Task, occurredAt: string) => v2TaskEventSchema.parse({ id: randomUUID(), taskId: snapshot.id, sequence: snapshot.version, actorId: ownerId, action: 'status_changed', beforeStatus: 'in_progress', snapshot, occurredAt, projectName: '当时的项目' });
const child = (title: string, completedAt: string | null) => ({ id: randomUUID(), title, completed: completedAt !== null, completedAt });
const snapshot = (items: SubtaskSnapshot['items']): SubtaskSnapshot => ({ taskId: task.id, taskTitle: task.title, projectId, projectName: '当时的项目', version: 1, items });

test('日报按上海午夜半开区间取完成事实，父任务只计一次，未完成子项不进入正文', () => {
  const rows = dailyRows([event(task, start)], [snapshot([child('昨天的', '2026-10-21T15:59:59.999Z'), child('零点的', start), child('最后毫秒', '2026-10-22T15:59:59.999Z'), child('明天的', endExclusive), child('未完成的', null)])], start, endExclusive);
  assert.equal(rows.length, 1); assert.equal(rows[0]?.completed, true); assert.deepEqual(rows[0]?.children, ['零点的', '最后毫秒']);
  assert.equal(generateDailyText([{ id: projectId, name: '当时的项目' }], rows), '当时的项目\n1.当时的名称\n  （1）零点的\n  （2）最后毫秒');
});

test('次日重开、改名和删除不回写昨日，日内重开以当日日末状态为准', () => {
  const reopened: V2Task = { ...task, status: 'in_progress', title: '后续名称', completedAt: null, deletedAt: endExclusive, version: 2 };
  assert.equal(dailyRows([event(task, start), event(reopened, endExclusive)], [], start, endExclusive)[0]?.title, task.title);
  assert.equal(dailyRows([event(task, start), event(reopened, '2026-10-22T15:59:59.999Z')], [], start, endExclusive).length, 0);
  const rows = dailyRows([event({ ...task, status: 'not_started', completedAt: null }, start)], [snapshot([child('完成的一步', start)])], start, endExclusive);
  assert.equal(rows[0]?.completed, false); assert.doesNotMatch(generateDailyText([{ id: projectId, name: '项目' }], rows), /未开始|进行中|当日完成/u);
});

test('日报遵循项目顺序并将个人任务放末尾，空日期不伪造完成事项', () => {
  const second = randomUUID(), makeRow = (id: string | null, title: string) => ({ taskId: randomUUID(), title, projectId: id, projectName: '', completed: true, children: [] });
  const text = generateDailyText([{ id: second, name: '第二项目' }, { id: projectId, name: '第一项目' }], [makeRow(null, '私人事项'), makeRow(projectId, '任务甲'), makeRow(second, '任务乙')]);
  assert.ok(text.indexOf('第二项目') < text.indexOf('第一项目')); assert.ok(text.indexOf('第一项目') < text.indexOf('个人任务'));
  assert.equal(generateDailyText([], []), '当日暂无完成记录');
});
