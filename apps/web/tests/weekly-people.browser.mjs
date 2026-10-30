import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sortingFixture } from './sorting-fixture.mjs';

// 内存接口验证组件和拖拽；落库、权限和并发由 sorting.integration.ts 验证。
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createServer } = await import('vite');
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const evidence = fileURLToPath(new URL('../../../.cache/weekly-people-evidence/', import.meta.url));
await mkdir(evidence, { recursive: true });
let browser;
try {
  const fixture = sortingFixture(), w = fixture.workspace, weekly = fixture.weekly, commands = [], errors = [];
  const accounts = ['任明', '耿龙凤', '谢鹏'].map((displayName, index) => ({ ...w.accounts[0], id: index ? randomUUID() : w.accounts[0].id, displayName }));
  w.accounts = accounts;
  w.tasks = w.tasks.slice(0, 6).map((task, index) => ({ ...task, executorId: accounts[index % 3].id }));
  w.arrangements = w.arrangements.filter((row) => w.tasks.some((task) => task.id === row.taskId));
  weekly.summary = weekly.summary.filter((row) => w.tasks.some((task) => task.id === row.taskId)).map((row) => {
    const task = w.tasks.find((task) => task.id === row.taskId), account = accounts.find((account) => account.id === task.executorId);
    return { ...row, executorId: account.id, executorName: account.displayName };
  });
  const defaults = accounts.map((account) => account.id);
  weekly.peopleOrder = { ids: [...defaults], version: 0, manual: false };
  w.periods.push({ ...w.periods[1], id: randomUUID(), startOn: '2026-11-02', endOn: '2026-11-08' });
  let failNext = false;
  await server.listen();
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, colorScheme: 'dark' });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (request.method() === 'POST') {
      const command = request.postDataJSON(); commands.push(command);
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (failNext) { failNext = false; return route.fulfill({ status: 409, json: { message: '数据已被其他人修改，请刷新核对。' } }); }
      assert.equal(command.action, 'reorder_people');
      weekly.peopleOrder = { ids: command.reset ? [...defaults] : command.executorIds, version: weekly.peopleOrder.version + 1, manual: !command.reset };
      return route.fulfill({ json: { objectIds: [] } });
    }
    const state = { ...weekly, summaryPeriod: w.periods.find((period) => period.id === url.searchParams.get('summaryPeriodId')) ?? weekly.summaryPeriod, planPeriod: w.periods.find((period) => period.id === url.searchParams.get('planPeriodId')) ?? weekly.planPeriod };
    const data = path.endsWith('/auth/me') ? fixture.identity : path.endsWith('/workspace') ? w : path.endsWith('/weekly') ? state : null;
    return route.fulfill({ status: data ? 200 : 404, json: data ?? {} });
  });
  const list = page.locator('[data-sort-scope="people"]');
  const ids = () => list.locator(':scope > .w-person-slot > section').evaluateAll((rows) => rows.map((row) => row.dataset.sortId));
  const saved = () => page.waitForFunction(() => !document.querySelector('[aria-disabled="true"]:not(:disabled)'));
  async function openPeople() {
    await page.getByRole('button', { name: '按人员', exact: true }).click();
    await list.waitFor();
  }
  async function drag(from, to, cancel = false) {
    const rows = list.locator(':scope > .w-person-slot > section'), source = rows.nth(from), target = rows.nth(to);
    await source.scrollIntoViewIfNeeded();
    const start = await source.locator('button[aria-label^="拖动排序"]').first().boundingBox(), end = await target.boundingBox();
    const count = commands.length;
    await page.mouse.move(start.x + 15, start.y + 15); await page.mouse.down();
    await page.mouse.move(end.x + 25, end.y + (to > from ? end.height - 3 : 3), { steps: 12 });
    // 动画中的内容允许移动，占位和列表边界必须稳定；静止指针不能反复换位。
    const geometry = () => list.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      slots: [...element.children].map((slot) => { const rect = slot.getBoundingClientRect(); return [rect.y, rect.height]; }),
      targets: [...element.querySelectorAll(':scope > .w-person-slot > section')].map((row) => row.style.translate),
    }));
    const first = await geometry(); await page.waitForTimeout(180);
    assert.deepEqual(await geometry(), first, '人员换位不能改变占位或使落点振荡');
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    if (cancel) { await page.waitForTimeout(100); assert.equal(commands.length, count); }
    else { await page.waitForFunction(() => document.querySelectorAll('[aria-disabled="true"]:not(:disabled)').length > 0); await saved(); }
  }
  await page.goto(`http://127.0.0.1:${address.port}/weekly-plans`);
  // 同一账号来回切换时，原有项目排序入口和模式必须仍然可用。
  await page.getByRole('button', { name: '项目排序', exact: true }).click();
  assert.equal(await page.locator('[data-sort-scope="projects"] .w-project-sort-handle').count(), w.projects.length);
  await openPeople();
  await page.getByRole('button', { name: '人员排序', exact: true }).waitFor();
  await page.getByRole('button', { name: '按项目', exact: true }).click();
  await page.getByRole('button', { name: '项目排序', exact: true }).click();
  await page.getByRole('button', { name: '完成排序', exact: true }).click();
  await openPeople();
  assert.deepEqual(await ids(), defaults);
  await page.getByRole('button', { name: '人员排序', exact: true }).click();
  assert.equal(await list.locator('.w-columns').count(), 0);
  await drag(0, 2);
  assert.deepEqual(await ids(), [defaults[1], defaults[2], defaults[0]]);
  assert.deepEqual(commands.at(-1).executorIds, await ids());
  const beforeCancel = await ids(); await drag(0, 1, true); assert.deepEqual(await ids(), beforeCancel);
  failNext = true; await drag(0, 2); assert.deepEqual(await ids(), beforeCancel);
  await page.getByRole('alert').filter({ hasText: '数据已被其他人修改' }).waitFor();
  await list.locator('button').first().focus(); await page.keyboard.press('ArrowDown'); await saved();
  assert.deepEqual(await ids(), [defaults[2], defaults[1], defaults[0]]);
  const persisted = await ids();
  const loaded = page.waitForResponse((response) => response.url().includes(`/weekly?summaryPeriodId=${w.periods[1].id}`));
  await page.getByLabel('总结区间', { exact: true }).selectOption(w.periods[1].id); await loaded;
  assert.deepEqual(await ids(), persisted);
  await page.reload(); await openPeople(); assert.deepEqual(await ids(), persisted);
  await page.getByRole('button', { name: '人员排序', exact: true }).click();
  await page.getByRole('button', { name: '人员排序选项', exact: true }).click();
  await page.getByRole('button', { name: /恢复默认排序/ }).click();
  await page.waitForFunction(() => !document.querySelector('.v2-order-popover')); await saved();
  await page.waitForTimeout(350); assert.deepEqual(await ids(), defaults); assert.equal(commands.at(-1).reset, true);
  await page.getByRole('button', { name: '完成排序', exact: true }).click();
  assert.equal(await list.locator('.w-columns').count(), 3);
  await page.getByLabel('筛选项目', { exact: true }).selectOption(w.projects[0].id);
  await page.getByRole('button', { name: '人员排序', exact: true }).click();
  assert.equal(await page.getByLabel('筛选项目', { exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '完成排序', exact: true }).click();
  assert.equal(await page.getByLabel('筛选项目', { exact: true }).inputValue(), w.projects[0].id);
  await page.screenshot({ path: evidence + '/desktop.png' });
  // 覆盖真实反馈中的两人短列表，连续上下换位保持同样的占位和动画。
  const pair = defaults.slice(0, 2);
  w.tasks = w.tasks.filter((task) => pair.includes(task.executorId));
  w.arrangements = w.arrangements.filter((row) => w.tasks.some((task) => task.id === row.taskId));
  weekly.summary = weekly.summary.filter((row) => pair.includes(row.executorId));
  weekly.peopleOrder.ids = weekly.peopleOrder.ids.filter((id) => pair.includes(id));
  await page.reload(); await openPeople();
  await page.getByRole('button', { name: '人员排序', exact: true }).click();
  const pairBefore = await ids(); assert.equal(pairBefore.length, 2);
  for (let repeat = 0; repeat < 2; repeat++) {
    await drag(0, 1); assert.deepEqual(await ids(), [...pairBefore].reverse());
    await drag(1, 0); assert.deepEqual(await ids(), pairBefore);
  }
  await page.getByRole('button', { name: '完成排序', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '人员排序', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: evidence + '/mobile.png' });
  w.teamLeader = false; await page.reload(); await openPeople();
  assert.equal(await page.getByRole('button', { name: '人员排序', exact: true }).count(), 0);
  assert.equal(await list.locator(':scope > .w-person-slot > section > .w-person-head button:enabled').count(), 0);
  await page.getByRole('button', { name: '按项目', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '项目排序', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('Weekly people browser passed: pointer/keyboard, cancel, rollback, persistence, reset, filter, read-only and 390px layout.');
} finally {
  await browser?.close(); await server.close();
}
