import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { v2CompletionSchema, v2PrivateTaskInputSchema, type V2Task } from '@ntfs/contracts';
import { applyCompletion } from './task-completion.js';
import { transitionTask } from './task-rules.js';

const now = '2026-10-22T03:00:00.000Z';
const task: V2Task = { id: randomUUID(), kind: 'project', projectId: randomUUID(), teamId: randomUUID(), creatorId: randomUUID(), executorId: randomUUID(), milestoneId: null, title: '投入验收', priority: 3, status: 'in_progress', version: 0, createdAt: now, updatedAt: now, completedAt: null, deletedAt: null };

test('完成必填实际投入，零有效；首次完成默认高且不伪造历史结果', () => {
  const completed = transitionTask(task, 'completed', now);
  assert.throws(() => applyCompletion(completed, task.status), /累计实际投入/);
  assert.equal(applyCompletion(completed, task.status, { actualDays: 0, aiContribution: null }).aiContribution, 'high');
  assert.equal(applyCompletion(completed, 'completed').actualDays, undefined);
  assert.equal(applyCompletion(completed, 'completed').aiContribution, undefined);
  assert.throws(() => applyCompletion(completed, 'completed', { actualDays: null, aiContribution: 'low' }), /累计实际投入/);
});

test('未完成选填，重开保留累计结果，再完成不累加且保留原AI档位', () => {
  const completed = applyCompletion(transitionTask(task, 'completed', now), task.status, { actualDays: 2.5, aiContribution: 'low' });
  const reopened = applyCompletion(transitionTask(completed, 'in_progress', now), completed.status);
  assert.equal(reopened.actualDays, 2.5); assert.equal(reopened.aiContribution, 'low');
  const again = applyCompletion(transitionTask(reopened, 'completed', now), reopened.status);
  assert.equal(again.actualDays, 2.5); assert.equal(again.aiContribution, 'low');
  assert.equal(applyCompletion(task, task.status, { actualDays: null, aiContribution: 'none' }).aiContribution, 'none');
});

test('私人任务不接受结果字段，数值最多两位且拒绝负数和非有限值', () => {
  const privateTask: V2Task = { ...task, kind: 'private', teamId: null, projectId: null, milestoneId: null };
  assert.throws(() => applyCompletion(privateTask, 'in_progress', { actualDays: 0, aiContribution: 'high' }), /私人任务/);
  assert.equal(v2PrivateTaskInputSchema.safeParse({ title: '私人', completion: { actualDays: 0, aiContribution: 'none' } }).success, false);
  for (const actualDays of [-1, 0.001, NaN, Infinity, 10000]) assert.equal(v2CompletionSchema.safeParse({ actualDays, aiContribution: 'high' }).success, false);
  assert.equal(v2CompletionSchema.safeParse({ actualDays: 0.01, aiContribution: 'none' }).success, true);
});
