import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// 使用项目已有的Vite编译器加载浏览器入口，不产生构建文件或引入测试专用依赖。
const { build } = createRequire(import.meta.resolve('vite'))('esbuild');
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/weekly-plans/api.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { saveWeeklyBatch } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const teamId = randomUUID();
const assignmentId = randomUUID();
const candidate = { assignmentId, assignmentVersion: 2, taskVersion: 3, taskId: randomUUID(), projectId: randomUUID(), projectName: '项目', taskTitle: '跨周工作', accountId: randomUUID(), displayName: '执行人', groupId: null, groupName: '团队直属', content: '', status: 'in_progress', blockedReason: '' };
const command = { action: 'save_arrangements', teamId, week: '2030-01-07', arrangements: [{ assignmentId, assignmentVersion: 1, taskVersion: 2, version: null, goal: '来源周目标', expectedProgress: 20, plannedDays: '1.50' }] };

function setup(context, { existing = false, sourceFails = false, targetFails = false } = {}) {
  const writes = [];
  const reads = [];
  context.mock.method(globalThis, 'fetch', async (path, options) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body); writes.push(body);
      if (body.week === command.week && sourceFails || body.week !== command.week && targetFails) return Response.json({ statusCode: 409, message: '安排已变化', error: 'Conflict' }, { status: 409 });
      return Response.json({ objectId: randomUUID() });
    }
    reads.push(path);
    if (path.includes('/publications?')) return Response.json({ canEdit: true, canPublish: true, publications: [], pendingCandidates: [] });
    if (path.includes('/candidates?')) return Response.json({ teamId, week: '2030-01-14', assignments: [candidate] });
    return Response.json({ draft: { id: randomUUID(), teamId, week: '2030-01-14', version: 0, hasUnpublishedChanges: false, rows: [], pending: [], arrangements: existing ? [{ id: randomUUID(), assignmentId, version: 5, goal: '目标周人工内容', expectedProgress: 30, plannedDays: '2.00', sourceWeek: null }] : [] } });
  });
  return { writes, reads };
}

test('同时安排两周：保留本周，下一周另设空目标和投入并使用最新分工版本', async (context) => {
  const { writes } = setup(context);
  await saveWeeklyBatch(command, 'test-csrf', true);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].week, '2030-01-07');
  assert.equal(writes[1].week, '2030-01-14');
  assert.deepEqual(writes[1].arrangements[0], { assignmentId, assignmentVersion: 2, taskVersion: 3, version: null, goal: '', expectedProgress: null, plannedDays: null });
  assert.ok(writes.every((entry) => entry.action === 'save_arrangements'));
});

test('后一周已有安排时不写入覆盖', async (context) => {
  const { writes } = setup(context, { existing: true });
  await saveWeeklyBatch(command, 'test-csrf', true);
  assert.equal(writes.length, 1);
});

test('后一周版本冲突明确提示前一周已保存，不重试覆盖', async (context) => {
  const { writes } = setup(context, { targetFails: true });
  await assert.rejects(() => saveWeeklyBatch(command, 'test-csrf', true), /已保存.*未完成确认/);
  assert.equal(writes.length, 2);
});

test('前一周保存失败不继续后一周', async (context) => {
  const { writes, reads } = setup(context, { sourceFails: true });
  await assert.rejects(() => saveWeeklyBatch(command, 'test-csrf', true));
  assert.equal(writes.length, 1);
  assert.equal(reads.length, 0);
});

test('单周保存不读取或写入后一周', async (context) => {
  const { writes, reads } = setup(context);
  await saveWeeklyBatch(command, 'test-csrf', false);
  assert.equal(writes.length, 1);
  assert.equal(reads.length, 0);
});
