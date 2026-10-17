import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const { build } = createRequire(import.meta.resolve('vite'))('esbuild');
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/v2/weekly-rows.ts', import.meta.url))], bundle: true, write: false, format: 'iife', globalName: 'weekly', platform: 'browser', logLevel: 'silent' });
const { buildWeeklyRows, estimates } = runInNewContext(`${bundled.outputFiles[0].text}\nweekly`);
const plain = (value) => JSON.parse(JSON.stringify(value));

/** 页面历史必须来自服务器的区间事实，不能混入当前改名、改派或回退结果。 */
test('V2 总结使用历史名称与执行人，计划使用同一任务的当前字段', () => {
  const data = { tasks: [{ id: 't1', kind: 'project', projectId: 'p', title: '当前名称', executorId: 'new', status: 'in_progress', priority: 2 }], accounts: [{ id: 'new', displayName: '当前人员' }], arrangements: [{ taskId: 't1', periodId: 'next', plannedDays: 0 }] };
  const state = { summaryPeriod: { id: 'old' }, planPeriod: { id: 'next' }, summary: [{ taskId: 't1', projectId: 'p', title: '历史名称', executorId: 'old', executorName: '当时人员', status: 'completed', priority: 3, planning: 'planned', historyIncomplete: false }], taskOrders: [{ projectId: 'p', periodId: 'old', ids: ['t1'] }, { projectId: 'p', periodId: 'next', ids: ['t1'] }] };
  const frozen = JSON.stringify({ data, state }), rows = buildWeeklyRows(data, state);
  assert.equal(rows.ordered('summary', 'p')[0].title, '历史名称');
  assert.equal(rows.ordered('summary', 'p')[0].executorName, '当时人员');
  assert.equal(rows.ordered('summary', 'p')[0].status, 'completed');
  assert.equal(rows.ordered('plan', 'p')[0].title, '当前名称');
  assert.equal(rows.ordered('plan', 'p')[0].days, 0);
  assert.equal(JSON.stringify({ data, state }), frozen);
});

test('V2 人员视角投影共享顺序，未知历史不补当前人员且私人任务不进入计划', () => {
  const data = { tasks: [{ id: 'private', kind: 'private', title: '私人' }], accounts: [], arrangements: [{ taskId: 'private', periodId: 'next', plannedDays: null }] };
  const state = { summaryPeriod: { id: 'old' }, planPeriod: { id: 'next' }, summary: [{ taskId: 'a', projectId: 'p', executorId: 'person', title: 'A' }, { taskId: 'b', projectId: 'p', executorId: null, title: null }, { taskId: 'c', projectId: 'p', executorId: 'person', title: 'C' }], taskOrders: [{ projectId: 'p', periodId: 'old', ids: ['c', 'b', 'a'] }] };
  const rows = buildWeeklyRows(data, state);
  assert.deepEqual(plain(rows.ordered('summary', 'p', 'person').map((row) => row.id)), ['c', 'a']);
  assert.equal(rows.ordered('summary', 'p', 'unknown')[0].executorName, '历史姓名不可还原');
  assert.equal(rows.ordered('summary', 'p', 'unknown')[0].title, '历史内容不可还原');
  assert.equal(rows.plan.length, 0);
});

test('V2 投入汇总保留零估算和未估算的区别，精确显示小数合计', () => {
  assert.equal(estimates([{ days: null }, { days: 0 }, { days: 0.1 }, { days: 0.2 }]), '4 项 · 0.3 天 ＋ 1 项未估算');
});
