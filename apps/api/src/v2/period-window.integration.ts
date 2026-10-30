import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { v2ImpactSchema, type V2Workspace } from '@ntfs/contracts';
import { v2ResultSchema } from './repository-utils.js';

type Actor = { id: ReturnType<typeof randomUUID>; token: string; csrf: string };
type Harness = { source: DataSource; leader: Actor; lead: Actor; developer: Actor; teamId: string; projectId: string; call: (path: string, actor: Actor, body?: unknown, expected?: number) => Promise<unknown>; state: (actor?: Actor) => Promise<V2Workspace> };

/** 随机团队内真实 HTTP 与数据库回读，覆盖团队共享、越权、幂等、冲突及历史保留。 */
export async function verifyPeriodWindow({ source, leader, lead, developer, teamId, projectId, call, state }: Harness): Promise<void> {
  const initial = await state();
  assert.deepEqual(initial.periodWindow, { before: 1, after: 6, version: 0 });
  const current = initial.periods.find((row) => row.startOn <= initial.today && row.endOn >= initial.today);
  assert.ok(current);
  const taskId = v2ResultSchema.parse(await call('tasks', lead, { action: 'create_project', operationId: randomUUID(), task: { projectId, executorId: developer.id, periodId: current.id, title: '窗口不改变任务安排', plannedDays: 1 } })).objectIds[0];
  assert.ok(taskId);
  const before = await state();
  const command = { action: 'set_period_window', operationId: randomUUID(), version: 0, before: 4, after: 9 };
  await call('planning', developer, command, 403);
  await call('planning', lead, command, 403);
  for (const count of [-1, 0.5, 521]) await call('planning', leader, { ...command, before: count }, 400);
  await call('planning', leader, { ...command, periods: [] }, 400);

  await call('planning', leader, command);
  await call('planning', leader, command);
  const expanded = await state(developer), currentIndex = expanded.periods.findIndex((row) => row.id === current.id);
  assert.deepEqual(expanded.periodWindow, { before: 4, after: 9, version: 1 });
  assert.ok(currentIndex >= 4 && expanded.periods.length - currentIndex - 1 >= 9);
  assert.deepEqual(expanded.periods.filter((row) => initial.periods.some((old) => old.id === row.id)), initial.periods);
  assert.deepEqual(expanded.tasks.find((row) => row.id === taskId), before.tasks.find((row) => row.id === taskId));
  assert.deepEqual(expanded.arrangements.filter((row) => row.taskId === taskId), before.arrangements.filter((row) => row.taskId === taskId));

  // 同一版本两个会话提交，只能成功一次；失败不得覆盖已生效的窗口。
  const attempts = await Promise.allSettled([2, 3].map((count) => call('planning', leader, { ...command, operationId: randomUUID(), version: 1, before: count, after: 9 })));
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = attempts.find((result) => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected' && rejected.reason instanceof assert.AssertionError && rejected.reason.actual === 409);
  const concurrent = await state();
  await call('planning', leader, { ...command, operationId: randomUUID(), version: concurrent.periodWindow.version, before: 0, after: 0 });
  const shrunk = await state();
  assert.deepEqual(shrunk.periods, expanded.periods, '缩小窗口不删除区间或改变版本');
  assert.deepEqual(shrunk.arrangements, concurrent.arrangements);
  const previous = initial.periods[0]; assert.ok(previous);
  await call(`summary?periodId=${previous.id}`, leader);

  // 窗口补建之后，仍能用原日期行版本预览；全目录版本使用最新快照。
  const impact = v2ImpactSchema.parse(await call('impact', leader, { action: 'change_periods', version: shrunk.teamVersion, periods: [{ periodId: current.id, version: current.version, startOn: current.startOn, endOn: current.endOn }] }));
  assert.deepEqual(impact.blockers, []);
  await call('planning', leader, { ...command, operationId: randomUUID(), version: shrunk.periodWindow.version, before: 1, after: 6 });
  const final = await state(developer);
  const stored = z.array(z.object({ before: z.number(), after: z.number(), version: z.number() })).parse(await source.query('SELECT period_window_before AS `before`,period_window_after AS `after`,period_window_version AS version FROM v2_team_settings WHERE team_id=?', [teamId]));
  assert.deepEqual(stored[0], final.periodWindow);
  const comments = z.array(z.object({ comment: z.string() })).parse(await source.query("SELECT COLUMN_COMMENT AS comment FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='v2_team_settings' AND COLUMN_NAME LIKE 'period_window_%'"));
  assert.equal(comments.length, 3); assert.ok(comments.every((row) => /[\u4e00-\u9fff]/u.test(row.comment)));
  console.log('Period window API passed: permissions, shared settings, concurrent conflict, idempotence, expansion, retained history and Chinese database comments.');
}
