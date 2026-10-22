import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { sortingFixture } from './sorting-fixture.mjs';

// 回归周期行换位造成误删；接口使用内存夹具，不修改用户任务或生产数据。
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = sortingFixture(), task = fixture.workspace.tasks[0], periods = fixture.workspace.periods;
const later = { ...periods[1], id: randomUUID(), startOn: '2026-11-02', endOn: '2026-11-08' };
periods.push(later);
fixture.workspace.tasks = [task];
fixture.workspace.arrangements = [
  { taskId: task.id, periodId: periods[1].id, plannedDays: 2, position: 0, version: 0 },
  { taskId: task.id, periodId: periods[0].id, plannedDays: 1, position: 9, version: 0 },
];
fixture.workspace.categories = ['not_started', 'in_progress', 'completed'].map((status, position) => ({ id: randomUUID(), ownerId: fixture.identity.id, name: status, status, isDefault: true, position, version: 0 }));
fixture.workspace.placements = [{ taskId: task.id, ownerId: fixture.identity.id, categoryId: fixture.workspace.categories[1].id, position: 0 }];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5174', errors = [], saved = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.route('**/api/v1/**', async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (route.request().method() === 'POST') {
    const command = route.request().postDataJSON();
    if (path.endsWith('/impact')) return route.fulfill({ json: { title: task.title, details: ['周期安排变更'], blockers: [], confirmation: 'a'.repeat(64) } });
    assert.ok(path.endsWith('/edit')); assert.equal(command.action, 'save_task');
    saved.push(command);
    fixture.workspace.arrangements = command.arrangements.map((row, position) => ({ ...row, taskId: task.id, position, version: 0 }));
    task.version++;
    return route.fulfill({ json: { objectIds: [task.id] } });
  }
  const data = path.endsWith('/auth/me') ? fixture.identity : path.endsWith('/workspace') ? fixture.workspace : path.endsWith('/weekly') ? fixture.weekly : path.endsWith('/summary') ? fixture.summary : null;
  return route.fulfill({ status: data ? 200 : 404, json: data ?? { message: 'Unmocked endpoint' } });
});
const active = page.locator('dialog [data-active="true"]');
const values = () => active.locator('.v2-task-arrangement select').evaluateAll((fields) => fields.map((field) => field.value));
const estimates = () => active.locator('.v2-task-arrangement input').evaluateAll((fields) => fields.map((field) => field.value));
const close = () => active.getByRole('button', { name: '关闭', exact: true }).last().click();
async function save() {
  await active.getByRole('button', { name: '保存', exact: true }).click();
  await active.getByRole('button', { name: '确认保存修改', exact: true }).click();
  await page.locator('dialog').waitFor({ state: 'hidden' });
}
try {
  // 项目、个人及周计划两侧一致，不受入口周期和服务器数组顺序影响。
  for (const path of [`/work?project=${task.projectId}`, '/personal', '/weekly-plans']) {
    await page.goto(base + path);
    const buttons = page.getByRole('button', { name: task.title, exact: true });
    await buttons.first().waitFor();
    const count = path === '/weekly-plans' ? 2 : 1;
    for (let index = 0; index < count; index++) {
      await buttons.nth(index).click();
      assert.deepEqual(await values(), [periods[0].id, periods[1].id]);
      assert.deepEqual(await estimates(), ['1', '2']);
      await close();
    }
  }
  await page.goto(base + '/personal');
  await page.getByRole('button', { name: task.title, exact: true }).click();
  await active.getByLabel('日期区间 1', { exact: true }).selectOption(later.id);
  assert.deepEqual(await values(), [later.id, periods[1].id], '改日期期间不能突然换位');
  await active.getByRole('button', { name: '取消第2条周期安排', exact: true }).click();
  assert.deepEqual(await values(), [later.id], '删除命中的周期，不误删旁边行');
  await active.getByRole('button', { name: '＋ 追加安排', exact: true }).click();
  assert.deepEqual(await values(), [later.id, periods[0].id], '本次草稿追加到末尾');
  await save();
  assert.deepEqual(saved[0].arrangements.map((row) => row.periodId), [later.id, periods[0].id]);
  await page.getByRole('button', { name: task.title, exact: true }).click();
  assert.deepEqual(await values(), [periods[0].id, later.id], '保存重开统一按日期');
  assert.deepEqual(await estimates(), ['', ''], '改排和追加预计留空');
  await close();
  assert.deepEqual(errors, []);
  console.log('PASS: consistent period order across project/personal/both weekly sides, stable edit rows, correct deletion and chronological reopen. Mock API only.');
} finally { await browser.close(); }
