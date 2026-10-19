import assert from 'node:assert/strict';
import test from 'node:test';
import { compareTaskOrder, newestTaskIds, resolveOrder } from './sorting.js';

test('默认任务优先级优先，同级按创建时间正序，同毫秒按标识稳定排列', () => {
  const rows = [{ id: 'b', priority: 3, createdAt: '2026-01-01' }, { id: 'a', priority: 3, createdAt: '2026-01-01' }, { id: 'later', priority: 3, createdAt: '2026-01-02' }, { id: 'urgent', priority: 1, createdAt: '2026-01-03' }];
  assert.deepEqual([...rows].sort(compareTaskOrder).map((row) => row.id), ['urgent', 'a', 'b', 'later']);
  assert.equal(rows[0]?.id, 'b');
});

test('手动顺序连续新增置顶、旧相对位置保持，恢复默认后重新按业务规则排列', () => {
  const rows = [{ id: 'old', priority: 2, createdAt: '2026-01-01' }, { id: 'urgent', priority: 1, createdAt: '2026-01-02' }, { id: 'latest', priority: 5, createdAt: '2026-01-03' }];
  const defaults = [...rows].sort(compareTaskOrder).map((row) => row.id);
  const manual = resolveOrder(defaults, ['deleted', 'old'], newestTaskIds(rows));
  assert.deepEqual(manual, ['latest', 'urgent', 'old']);
  assert.deepEqual(resolveOrder(defaults, manual, newestTaskIds(rows)), manual);
  assert.deepEqual(resolveOrder(defaults, null), ['urgent', 'old', 'latest']);
});
