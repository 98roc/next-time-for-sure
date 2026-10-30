import assert from 'node:assert/strict';
import { test } from 'node:test';
import { missingWindowPeriods } from './period-window.js';
import { shiftDate } from './calendar.js';

test('默认八个区间，跨周只补末端，缩小保留已有目录', () => {
  const counts = { before: 1, after: 6 };
  const initial = missingWindowPeriods([], '2026-10-30', counts);
  assert.equal(initial.length, 8);
  assert.deepEqual(initial[0], { startOn: '2026-10-19', endOn: '2026-10-25' });
  assert.equal(initial.at(-1)?.endOn, '2026-12-13');
  assert.deepEqual(missingWindowPeriods(initial, '2026-10-30', counts), []);
  assert.deepEqual(missingWindowPeriods(initial, '2026-10-30', { before: 0, after: 0 }), []);
  assert.deepEqual(missingWindowPeriods(initial, '2026-11-02', counts), [{ startOn: '2026-12-14', endOn: '2026-12-20' }]);
});

test('人工长短区间按相邻关系计数，不重建自然周、不改变旧边界', () => {
  const existing = [{ startOn: '2026-10-01', endOn: '2026-10-28' }, { startOn: '2026-10-29', endOn: '2026-11-02' }, { startOn: '2026-11-03', endOn: '2026-11-04' }];
  const original = structuredClone(existing);
  assert.deepEqual(missingWindowPeriods(existing, '2026-10-30', { before: 2, after: 2 }), [
    { startOn: '2026-09-24', endOn: '2026-09-30' }, { startOn: '2026-11-05', endOn: '2026-11-11' },
  ]);
  assert.deepEqual(existing, original);
});

test('停运跨多期或目录全在未来仍补齐连续区间；零后续窗口保留周报配对', () => {
  for (const today of ['2026-01-01', '2027-02-01']) {
    const existing = [{ startOn: '2026-10-29', endOn: '2026-11-02' }];
    const periods = [...existing, ...missingWindowPeriods(existing, today, { before: 1, after: 0 })].sort((a, b) => a.startOn.localeCompare(b.startOn));
    const current = periods.findIndex((row) => row.startOn <= today && row.endOn >= today);
    assert.ok(current >= 1 && current < periods.length - 1);
    periods.slice(1).forEach((row, index) => assert.equal(row.startOn, shiftDate(periods[index]?.endOn ?? '', 1)));
  }
});
