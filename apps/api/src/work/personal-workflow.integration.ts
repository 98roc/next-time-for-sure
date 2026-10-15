import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assignmentSnapshotSchema, personalSnapshotSchema, personalTeamWorkSchema, workSnapshotSchema, tagStateSchema } from '@ntfs/contracts';
import { smoke } from '../organization/integration-smoke.js';
import type { Session, WorkFixture } from '../organization/integration-smoke.js';
import { createDataSource } from '../database/data-source.js';
import { loadEnvironment } from '../config/environment.js';
import { writeFile, unlink } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

/** 随机真实夹具验证导入、拆分、状态分类、并发和权限，结束后统一清理。 */
export async function verifyPersonalWorkflow({ call, developer, leader, manager, projectId, otherProjectId, ownerId }: WorkFixture): Promise<void> {
  async function write(body: unknown, auth: Session = developer, expected = 200, path = 'personal/commands') {
    const response = await call(path, auth, body); const data: unknown = await response.json();
    assert.equal(response.status, expected, JSON.stringify({ body, data }));
    return expected === 200 ? z.object({ objectId: z.string() }).parse(data).objectId : '';
  }
  async function state() { return personalSnapshotSchema.parse(await (await call('personal', developer)).json()); }
  async function item(id: string) { const result = (await state()).items.find((entry) => entry.id === id); assert.ok(result); return result; }
  async function assignments() { return assignmentSnapshotSchema.parse(await (await call(`assignments?projectId=${projectId}`, developer)).json()); }
  const initial = await state(); assert.equal(initial.categories.length, 3);
  const todo = initial.categories.find((entry) => entry.status === 'not_started');
  const doing = initial.categories.find((entry) => entry.status === 'in_progress');
  const done = initial.categories.find((entry) => entry.status === 'completed'); assert.ok(todo && doing && done);
  const taskId = await write({ action: 'create_task', projectId, title: '统一工作台 · 接口开发', description: '用于个人与团队联动验收', acceptance: '', operationId: randomUUID() }, developer, 200, 'work/commands');
  const assignmentId = await write({ action: 'assign', taskId, accountId: ownerId, groupId: null, content: '实现接口并完成联调', operationId: randomUUID() }, leader, 200, 'assignments/commands');
  const catalog = personalTeamWorkSchema.parse(await (await call('personal/team-work', developer)).json());
  assert.ok(catalog.tasks.some((entry) => entry.id === taskId));
  assert.ok(!catalog.projects.some((entry) => entry.id === otherProjectId));
  const input = { action: 'import_assignment', assignmentId, split: false, categoryId: todo.id, operationId: randomUUID() };
  await write(input, manager, 403);
  const first = await write(input); assert.equal(await write(input), first);
  assert.equal(await write({ ...input, operationId: randomUUID() }), first);
  const second = await write({ ...input, split: true, title: '完成接口联调', operationId: randomUUID() });
  assert.notEqual(first, second);

  // 独立工作创建时原子保存双标签；私人事项和关联工作不允许伪造独立标签。
  const taggedInput = { action: 'create_personal', kind: 'work', projectId, assignmentId: null, title: '补充联调文档', description: '', acceptance: '', categoryId: todo.id, operationId: randomUUID(), tags: [{ dimension: 'milestone', week: null }, { dimension: 'weekly', week: '2026-10-12' }] };
  const taggedId = await write(taggedInput); assert.equal(await write(taggedInput), taggedId);
  const tags = tagStateSchema.parse(await (await call(`work-tags?objectId=${taggedId}&objectKind=personal`, developer)).json());
  assert.equal(tags.tags.filter((tag) => tag.marked).length, 2); assert.equal(tags.inherited, false);
  const count = (await state()).items.length;
  await write({ ...taggedInput, operationId: randomUUID(), kind: 'private', projectId: null }, developer, 400);
  await write({ ...taggedInput, operationId: randomUUID(), assignmentId }, developer, 400);
  assert.equal((await state()).items.length, count);
  await write({ objectId: taskId, objectKind: 'task', dimension: 'weekly', week: '2026-10-12', marked: true, version: null }, leader, 200, 'work-tags/commands');
  const inherited = tagStateSchema.parse(await (await call(`work-tags?objectId=${first}&objectKind=personal`, developer)).json());
  assert.equal(inherited.inherited, true); assert.equal(inherited.tags.some((tag) => tag.marked && tag.week === '2026-10-12'), true);

  // 状态与分类同事务更新；第一项完成不能提前结束仍有未完成事项的分工。
  await write({ action: 'start_personal', itemId: first, version: (await item(first)).version });
  assert.equal((await item(first)).categoryId, doing.id);
  assert.equal((await assignments()).assignments.find((entry) => entry.id === assignmentId)?.status, 'in_progress');
  await write({ action: 'complete_personal', itemId: first, version: (await item(first)).version });
  assert.equal((await assignments()).assignments.find((entry) => entry.id === assignmentId)?.status, 'in_progress');
  await write({ action: 'move_personal', itemId: second, categoryId: done.id, position: 0, version: (await item(second)).version });
  assert.equal((await assignments()).assignments.find((entry) => entry.id === assignmentId)?.status, 'completed');
  const team = workSnapshotSchema.parse(await (await call(`work?projectId=${projectId}`, developer)).json());
  assert.equal(team.tasks.find((entry) => entry.id === taskId)?.status, 'not_started');
  await write({ action: 'start_personal', itemId: first, version: (await item(first)).version });
  assert.equal((await assignments()).assignments.find((entry) => entry.id === assignmentId)?.status, 'in_progress');

  // 多个完成分类时，必须选择；跨状态拖拽已有明确目标，不重复确认。
  const extraDone = await write({ action: 'create_category', name: '本周交付', status: 'completed', operationId: randomUUID() });
  const before = await item(first);
  await write({ action: 'complete_personal', itemId: first, version: before.version }, developer, 409);
  assert.equal((await item(first)).version, before.version);
  const competing = await Promise.all([call('personal/commands', developer, { action: 'complete_personal', itemId: first, categoryId: extraDone, version: before.version }), call('personal/commands', developer, { action: 'complete_personal', itemId: first, categoryId: done.id, version: before.version })]);
  assert.deepEqual(competing.map((entry) => entry.status).sort(), [200, 409]);
  await write({ action: 'delete_category', categoryId: todo.id, version: todo.version }, developer, 409);
  await write({ action: 'delete_category', categoryId: extraDone, version: 0, targetCategoryId: doing.id }, developer, 400);
  await write({ action: 'delete_category', categoryId: extraDone, version: 0, targetCategoryId: done.id });
  assert.equal((await item(first)).categoryId, done.id);

  // 增加新事项自动恢复责任；解除关联与删除不代表完成。
  const third = await write({ ...input, split: true, title: '补充回归用例', operationId: randomUUID() });
  assert.equal((await assignments()).assignments.find((entry) => entry.id === assignmentId)?.status, 'in_progress');
  await write({ action: 'link_personal', itemId: third, assignmentId: null, version: (await item(third)).version });
  assert.equal((await assignments()).assignments.find((entry) => entry.id === assignmentId)?.status, 'in_progress');
  await write({ action: 'link_personal', itemId: third, assignmentId, version: (await item(third)).version });
  const fourth = await write({ ...input, split: true, title: '整理交付说明', operationId: randomUUID() });
  const finish = await Promise.all([third, fourth].map(async (id) => call('personal/commands', developer, { action: 'complete_personal', itemId: id, version: (await item(id)).version })));
  assert.deepEqual(finish.map((entry) => entry.status), [200, 200]);
  assert.equal((await assignments()).assignments.find((entry) => entry.id === assignmentId)?.status, 'completed');

  // 个人进展在团队侧按同一标识展示；数据库没有复制成第二条分工进展。
  const progressId = await write({ action: 'personal_progress', itemId: first, version: (await item(first)).version, occurredOn: '2026-10-15', reportWeek: '2026-10-12', content: '接口与联调均已完成', operationId: randomUUID() });
  const visible = assignmentSnapshotSchema.parse(await (await call(`assignments?projectId=${projectId}`, leader)).json());
  assert.equal(visible.linkedProgress.filter((entry) => entry.id === progressId).length, 1);
  assert.equal(visible.progress.filter((entry) => entry.id === progressId).length, 0);
  const managerView = assignmentSnapshotSchema.parse(await (await call(`assignments?projectId=${projectId}`, manager)).json());
  assert.equal(managerView.linkedProgress.some((entry) => entry.id === progressId), false);
  const source = createDataSource(loadEnvironment()); await source.initialize();
  try {
    const rows: unknown = await source.query('SELECT status, category_id AS categoryId FROM personal_items WHERE id=?', [first]);
    assert.deepEqual(z.array(z.object({ status: z.string(), categoryId: z.string() })).parse(rows), [{ status: 'completed', categoryId: done.id }]);
    const duplicates: unknown = await source.query('SELECT id FROM assignment_progress WHERE id=?', [progressId]); assert.deepEqual(duplicates, []);
    const storedTags: unknown = await source.query('SELECT dimension FROM work_tags WHERE object_id=? AND marked=1', [taggedId]);
    assert.equal(z.array(z.object({ dimension: z.string() })).parse(storedTags).length, 2);
  } finally { await source.destroy(); }

  // 留下可交互的多状态夹具；普通模式仍由smoke统一清理。
  await write({ action: 'start_personal', itemId: second, version: (await item(second)).version });
  await write({ ...input, split: true, title: '补充错误提示与说明', operationId: randomUUID() });
  await write({ action: 'create_category', name: '等待联调', status: 'in_progress', operationId: randomUUID() });
  const nextTask = await write({ action: 'create_task', projectId, title: '工作台响应式优化', description: '', acceptance: '', operationId: randomUUID() }, developer, 200, 'work/commands');
  await write({ action: 'assign', taskId: nextTask, accountId: ownerId, groupId: null, content: '调整手机操作布局', operationId: randomUUID() }, leader, 200, 'assignments/commands');
  console.log('PASS: default columns, permission-filtered team catalog, idempotent import, split completion/reopen, explicit multi-category choice, drag transition, concurrent completion, last-category guard and DB progress deduplication');
}

await smoke(async (fixture) => {
  await verifyPersonalWorkflow(fixture);
  if (!process.argv.includes('--inspect-personal')) return;
  const path = fileURLToPath(new URL('../../../../.cache/personal-inspection.json', import.meta.url));
  await writeFile(path, JSON.stringify({ base: fixture.base, cookie: fixture.developer.cookie, csrf: fixture.developer.csrf }), { flag: 'wx', mode: 0o600 });
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try { await input.question('Personal UI fixture ready. Press Enter to clean up.\n'); }
  finally { input.close(); await unlink(path); }
});
