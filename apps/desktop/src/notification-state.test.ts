import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotificationLedger, parseNotices } from './notification-state.js';

test('系统展示跨重启去重，账号隔离且展示不改变已读', () => {
  const notices = parseNotices([{ id: 'notice', eventId: 'event', title: '任务已更新', path: '/work?projectId=abc', readAt: null }]);
  const ledger = new NotificationLedger([]);
  assert.equal(ledger.candidates('first', notices).length, 1);
  ledger.record('first', 'event');
  const restored = new NotificationLedger(JSON.parse(ledger.serialize()));
  assert.equal(restored.candidates('first', notices).length, 0);
  assert.equal(restored.candidates('second', notices).length, 1);
  assert.equal(notices[0]?.readAt, null);
  assert.equal(restored.candidates('second', notices.map((item) => ({ ...item, readAt: '2026-10-14' }))).length, 0);
});

test('通知目标拒绝外站、协议相对地址和损坏数据', () => {
  for (const path of ['https://example.com', '//example.com', '/\\example.com', '/%2fexample.com']) {
    assert.throws(() => parseNotices([{ id: 'n', eventId: 'e', title: '通知', path, readAt: null }]));
  }
  assert.throws(() => parseNotices([null]));
  assert.throws(() => new NotificationLedger({ shown: [] }));
});
