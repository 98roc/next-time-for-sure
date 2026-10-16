import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { confirmReport, editReport, generateReportText, presentReport, reorderScoped, reportSourceHash, type V2ReportSource } from './shared-report.js';

const teamId = randomUUID();
const source: V2ReportSource = { teamId, revision: 'source-v1', summaryPeriod: { id: randomUUID(), teamId, startOn: '2026-10-12', endOn: '2026-10-18', version: 0 }, planPeriod: { id: randomUUID(), teamId, startOn: '2026-10-19', endOn: '2026-10-25', version: 0 }, summary: [{ projectId: randomUUID(), projectName: '项目甲', tasks: [{ taskId: randomUUID(), title: '实现', executorName: '成员甲' }] }, { projectId: randomUUID(), projectName: '项目乙', tasks: [{ taskId: randomUUID(), title: '验收', executorName: '成员乙' }] }], plan: [] };

test('文字版保持项目顺序、完整区间和项目内重新编号', () => {
  assert.equal(generateReportText(source), '2026-10-12—2026-10-18\n项目甲\n1.实现 成员甲\n项目乙\n1.验收 成员乙\n\n2026-10-19—2026-10-25');
  assert.throws(() => generateReportText({ ...source, teamId: randomUUID() }), /当前团队/);
});

test('编辑期间来源改变保留人工文字与未同步提示，复制目标就是当前显示文本', () => {
  const hash = reportSourceHash(source);
  const saved = editReport(null, 0, '人工合并描述 80%', hash);
  const changed = { ...source, revision: 'source-v2' };
  assert.equal(presentReport(saved, changed).body, '人工合并描述 80%');
  assert.equal(presentReport(saved, changed).stale, true);
  const savedAgain = editReport(saved, saved.version, '再次编辑', hash);
  assert.equal(presentReport(savedAgain, changed).stale, true);
  assert.throws(() => editReport(savedAgain, saved.version, '旧窗口覆盖', hash), /其他人/);
});

test('过期重新生成被拒绝，确认新来源才替换，手工核对保留原文', () => {
  const hash = reportSourceHash(source);
  const saved = editReport(null, 0, '人工文字', hash);
  const changed = { ...source, revision: 'source-v2' };
  assert.throws(() => confirmReport(saved, saved.version, hash, changed, true), /来源已变化/);
  assert.throws(() => confirmReport(saved, 0, reportSourceHash(changed), changed, true), /其他人/);
  const verified = confirmReport(saved, saved.version, reportSourceHash(changed), changed, false);
  assert.equal(verified.body, '人工文字'); assert.equal(presentReport(verified, changed).stale, false);
  const replaced = confirmReport(verified, verified.version, reportSourceHash(changed), changed, true);
  assert.equal(replaced.manual, false); assert.equal(replaced.body, generateReportText(changed));
});

test('受限视图重排保留隐藏项目，拒绝子集、重复项、越权项和并发覆盖', () => {
  assert.deepEqual(reorderScoped(['a', 'hidden', 'b'], ['a', 'b'], ['b', 'a'], 2, 2), ['b', 'hidden', 'a']);
  for (const requested of [['a'], ['a', 'a'], ['b', 'hidden']]) assert.throws(() => reorderScoped(['a', 'hidden', 'b'], ['a', 'b'], requested, 2, 2), /完整/);
  assert.throws(() => reorderScoped(['a', 'b'], ['a', 'b'], ['b', 'a'], 2, 1), /其他人/);
});
