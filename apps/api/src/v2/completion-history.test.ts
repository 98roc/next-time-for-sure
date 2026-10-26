import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { V2Task, V2TaskEvent, V2Period, V2Arrangement } from '@ntfs/contracts';
import { taskEventAt } from './completion-history.js';
import { dailyRows } from './daily-report.js';
import { rolloverSource } from './task-rollover.js';

const teamId = randomUUID(), ownerId = randomUUID();
const task: V2Task = { id: randomUUID(), kind: 'project', teamId, projectId: randomUUID(), creatorId: ownerId, executorId: ownerId, title: '补录测试', priority: 3, milestoneId: null, status: 'in_progress', completedAt: null, createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z', deletedAt: null, version: 0 };
const makeEvent = (snapshot: V2Task, action: V2TaskEvent['action']): V2TaskEvent => ({ id: randomUUID(), taskId: task.id, sequence: snapshot.version, actorId: ownerId, occurredAt: snapshot.updatedAt, snapshot, action, beforeStatus: 'in_progress', executorName: '执行人', actorName: '执行人' });

test('周一补录周日完成只纠正完成归属，操作时间、旧名称和之后重开保留', () => {
  const completed: V2Task = { ...task, version: 2, status: 'completed', completedAt: '2026-10-25T10:00:00.000Z', updatedAt: '2026-10-26T01:00:00.000Z' };
  const events = [makeEvent(task, 'created'), makeEvent({ ...task, title: '周一改名', version: 1, updatedAt: '2026-10-26T00:00:00.000Z' }, 'updated'), makeEvent(completed, 'status_changed')];
  assert.equal(taskEventAt(events, '2026-10-25T16:00:00.000Z')?.snapshot.status, 'completed');
  assert.equal(taskEventAt(events, '2026-10-25T16:00:00.000Z')?.snapshot.title, task.title);
  assert.equal(events[2]?.occurredAt, '2026-10-26T01:00:00.000Z');
  assert.equal(dailyRows(events, [], '2026-10-24T16:00:00.000Z', '2026-10-25T16:00:00.000Z').length, 1);
  assert.equal(dailyRows(events, [], '2026-10-25T16:00:00.000Z', '2026-10-26T16:00:00.000Z').length, 0);
  events.push(makeEvent({ ...task, version: 3, updatedAt: '2026-10-27T01:00:00.000Z' }, 'status_changed'));
  assert.equal(taskEventAt(events, '2026-10-25T16:00:00.000Z')?.snapshot.status, 'completed');
  assert.equal(taskEventAt(events, '2026-10-28T00:00:00.000Z')?.snapshot.status, 'in_progress');
});

test('已完成任务修正到次日从原日期移除，同轮次重复修正取最后一次', () => {
  const done = { ...task, version: 1, status: 'completed' as const, completedAt: '2026-10-24T10:00:00.000Z', updatedAt: '2026-10-26T01:00:00.000Z' };
  const events = [makeEvent(task, 'created'), makeEvent(done, 'status_changed'), makeEvent({ ...done, version: 2, completedAt: '2026-10-25T10:00:00.000Z', updatedAt: '2026-10-26T02:00:00.000Z' }, 'completion_corrected')];
  assert.equal(taskEventAt(events, '2026-10-24T16:00:00.000Z')?.snapshot.status, 'in_progress');
  assert.equal(taskEventAt(events, '2026-10-25T16:00:00.000Z')?.snapshot.status, 'completed');
});

test('顺延覆盖未开始和进行中、保留零投入，已完成及已有后续安排不追加', () => {
  const old: V2Period = { id: randomUUID(), teamId, startOn: '2026-10-19', endOn: '2026-10-25', version: 0 };
  const current: V2Period = { ...old, id: randomUUID(), startOn: '2026-10-26', endOn: '2026-11-01' };
  const future: V2Period = { ...old, id: randomUUID(), startOn: '2026-11-02', endOn: '2026-11-08' };
  const row: V2Arrangement = { taskId: task.id, periodId: old.id, plannedDays: 0, workNote: '原周期内容', position: 0, version: 0 };
  for (const status of ['not_started', 'in_progress'] as const) assert.equal(rolloverSource({ ...task, status }, [row], [old, current, future], current)?.plannedDays, 0);
  assert.equal(rolloverSource({ ...task, status: 'completed' }, [row], [old, current], current), undefined);
  for (const periodId of [current.id, future.id]) assert.equal(rolloverSource(task, [row, { ...row, periodId }], [old, current, future], current), undefined);
});
