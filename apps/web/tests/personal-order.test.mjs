import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const { build } = createRequire(import.meta.resolve('vite'))('esbuild');
const result = await build({ entryPoints: [fileURLToPath(new URL('../src/v2/personal-order.ts', import.meta.url))], bundle: true, write: false, format: 'iife', globalName: 'personal', platform: 'browser', logLevel: 'silent' });
const { projectPersonalOrder } = runInNewContext(`${result.outputFiles[0].text}\npersonal`);
const plain = (value) => JSON.parse(JSON.stringify(value));
const fixture = () => ({ categories: ['todo', 'doing', 'done'].map((id, position) => ({ id, position, isDefault: true, status: id })), placements: [
  { taskId: 'a', categoryId: 'todo', position: 0 }, { taskId: 'hidden', categoryId: 'todo', position: 1 }, { taskId: 'b', categoryId: 'todo', position: 2 }, { taskId: 'c', categoryId: 'doing', position: 3 },
] });

test('任务投影保留隐藏对象，跨列仅移动指定任务，不修改输入', () => {
  const data = fixture(), original = JSON.stringify(data);
  const view = projectPersonalOrder(data, { kind: 'task', id: 'b', scope: 'todo', beforeId: 'a' });
  assert.deepEqual(plain(view.placements.filter((row) => row.categoryId === 'todo').map((row) => row.taskId)), ['b', 'a', 'hidden']);
  const cross = projectPersonalOrder(view, { kind: 'task', id: 'b', scope: 'doing', beforeId: null });
  assert.deepEqual(plain(cross.placements.filter((row) => row.categoryId === 'doing').map((row) => row.taskId)), ['c', 'b']);
  assert.deepEqual(plain(cross.placements.filter((row) => row.categoryId === 'todo').map((row) => row.taskId)), ['a', 'hidden']);
  assert.equal(JSON.stringify(data), original);
});

test('分类投影不改变任务、默认分类及状态，无效目标不应用', () => {
  const data = fixture();
  const view = projectPersonalOrder(data, { kind: 'category', id: 'todo', scope: 'categories', beforeId: null });
  assert.deepEqual(plain(view.categories.map((row) => row.id)), ['doing', 'done', 'todo']);
  assert.equal(view.placements, data.placements);
  assert.deepEqual(plain(view.categories[2]), { ...data.categories[0], position: 2 });
  for (const drop of [{ kind: 'task', id: 'a', scope: 'missing', beforeId: null }, { kind: 'task', id: 'a', scope: 'todo', beforeId: 'missing' }, { kind: 'category', id: 'todo', scope: 'categories', beforeId: 'todo' }]) assert.equal(projectPersonalOrder(data, drop), data);
});
