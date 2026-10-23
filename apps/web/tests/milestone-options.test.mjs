import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const { build } = createRequire(import.meta.resolve('vite'))('esbuild');
const result = await build({ entryPoints: [fileURLToPath(new URL('../src/v2/milestone-options.ts', import.meta.url))], bundle: true, write: false, format: 'iife', globalName: 'options', platform: 'browser', logLevel: 'silent' });
const { milestoneOptions } = runInNewContext(`${result.outputFiles[0].text}\noptions`);
const row = (id, expectedOn, createdAt, status = 'open', projectId = 'project') => ({ id, expectedOn, createdAt, status, projectId });
const ids = (rows, original) => Array.from(milestoneOptions(rows, 'project', original), item => item.id);

test('关联选项按日期、创建时间升序，未规划置后且不改变看板原顺序', () => {
  const rows = [
    row('unplanned-late', null, '2026-10-22T10:00:00.000Z'),
    row('late-date', '2026-11-01', '2026-10-01T10:00:00.000Z'),
    row('same-date-late', '2026-10-30', '2026-10-22T10:00:00.000Z'),
    row('first-date', '2026-10-23', '2026-10-23T10:00:00.000Z'),
    row('same-date-early', '2026-10-30', '2026-10-21T10:00:00.000Z'),
    row('unplanned-early', null, '2026-10-01T10:00:00.000Z'),
  ];
  const original = JSON.stringify(rows);
  assert.deepEqual(ids(rows), ['first-date', 'same-date-early', 'same-date-late', 'late-date', 'unplanned-early', 'unplanned-late']);
  assert.equal(JSON.stringify(rows), original);
});

test('新增排除已完成与其他项目；编辑仅保留原关联的已完成目标', () => {
  const rows = [row('completed', '2026-10-23', '2026-10-20T00:00:00.000Z', 'completed'), row('other-completed', null, '2026-10-20T00:00:00.000Z', 'completed'), row('open', null, '2026-10-20T00:00:00.000Z'), row('other-project', null, '2026-10-20T00:00:00.000Z', 'completed', 'other')];
  assert.deepEqual(ids(rows), ['open']);
  assert.deepEqual(ids(rows, 'completed'), ['completed', 'open']);
  assert.deepEqual(ids(rows, 'other-project'), ['open']);
});

test('相同创建时刻按标识稳定排序，旧快照缺时间时不伪造创建顺序', () => {
  const rows = [row('legacy', null, undefined), row('b', null, '2026-10-20T00:00:00.000Z'), row('a', null, '2026-10-20T00:00:00.000Z')];
  assert.deepEqual(ids(rows), ['a', 'b', 'legacy']);
  assert.deepEqual(ids([]), []);
});
