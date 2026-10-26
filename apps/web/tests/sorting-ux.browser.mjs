import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sortingFixture } from './sorting-fixture.mjs';

// 使用已安装的 Playwright；可通过 PLAYWRIGHT_MODULE 指向本机工具包，不改变项目锁文件。
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
const fixture = sortingFixture(), commands = [], errors = [];
fixture.workspace.periods.push({ ...fixture.workspace.periods[1], id: '00000000-0000-4000-8000-000000000003', startOn: '2026-11-02', endOn: '2026-11-08' });
let failNext = false;
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5174';
const evidence = fileURLToPath(new URL('../../../.cache/sorting-ux-evidence/', import.meta.url));
await mkdir(evidence, { recursive: true });
page.on('pageerror', (error) => errors.push(error.message));
await page.route('**/api/v1/**', async (route) => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (request.method() === 'POST') {
    const command = request.postDataJSON(); commands.push(command);
    // 故意延迟写入，验证保存期间的即时预览与失败回退。
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (failNext) { failNext = false; return route.fulfill({ status: 409, json: { message: '排序已被其他人修改，请刷新后重试。' } }); }
    if (path.endsWith('/planning')) {
      let order;
      if (command.action === 'reorder_projects') order = command.page === 'projects' ? fixture.workspace.orders[0] : fixture.weekly.projectOrder;
      else if (command.action === 'reorder_project_items') order = fixture.workspace.orders.find((row) => row.scope === `project-page:${command.target}:${command.projectId}`);
      else order = fixture.weekly.taskOrders.find((row) => row.projectId === command.projectId && row.periodId === command.periodId);
      if (order) { order.ids = command.reset ? [...order.ids].reverse() : command.projectIds ?? command.taskIds ?? command.ids; order.manual = !command.reset; order.version++; }
    } else if (path.endsWith('/report')) {
      fixture.weekly.text = { body: command.body, version: fixture.weekly.text.version + 1, sourceHash: command.sourceHash, manual: command.action !== 'regenerate', stale: false };
    }
    return route.fulfill({ json: { objectIds: [] } });
  }
  const params = new URL(request.url()).searchParams;
  const weekly = { ...fixture.weekly, summaryPeriod: fixture.workspace.periods.find((row) => row.id === params.get('summaryPeriodId')) ?? fixture.weekly.summaryPeriod, planPeriod: fixture.workspace.periods.find((row) => row.id === params.get('planPeriodId')) ?? fixture.weekly.planPeriod };
  const data = path.endsWith('/auth/me') ? fixture.identity : path.endsWith('/workspace') ? fixture.workspace : path.endsWith('/weekly') ? weekly : path.endsWith('/summary') ? fixture.summary : null;
  return route.fulfill({ status: data ? 200 : 404, json: data ?? { message: 'Unmocked endpoint' } });
});
const ids = (scope) => page.locator(`[data-sort-scope="${scope}"]`).evaluate((list) => [...list.querySelectorAll('[data-sort-id]')].filter((row) => row.closest('[data-sort-scope]') === list).map((row) => row.dataset.sortId));
async function waitSaved() { await page.waitForFunction(() => !document.querySelector('[aria-disabled="true"]:not(:disabled)')); }
async function drag(scope, from, to, { cancel = false, outside = false, stationary = false } = {}) {
  const list = page.locator(`[data-sort-scope="${scope}"]`);
  const rows = list.locator(':scope > [data-sort-id], :scope > div > [data-sort-id], :scope > .nt-scroll > table > tbody > [data-sort-id], :scope > table > tbody > [data-sort-id]');
  const source = rows.nth(from), destination = rows.nth(to);
  await source.scrollIntoViewIfNeeded();
  const handle = source.locator('button[aria-label^="拖动排序"]').first(), point = await handle.boundingBox(), dest = await destination.boundingBox();
  const before = await ids(scope), count = commands.length;
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2); await page.mouse.down();
  await page.mouse.move(outside ? 10 : dest.x + Math.min(80, dest.width / 2), dest.y + (to > from ? dest.height - 3 : 3), { steps: 14 });
  if (stationary) {
    const one = await list.evaluate((el) => [...el.querySelectorAll('[data-sort-id]')].map((row) => row.style.translate));
    await page.waitForTimeout(450);
    const two = await list.evaluate((el) => [...el.querySelectorAll('[data-sort-id]')].map((row) => row.style.translate));
    assert.deepEqual(two, one, '静止鼠标不能造成落点振荡');
    assert.equal(await page.locator('.v2-sort-placeholder').count(), 0);
    await page.screenshot({ path: evidence + '/drag.png' });
  }
  if (cancel) await page.keyboard.press('Escape');
  const submitted = !cancel && !outside ? page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/planning')) : null;
  await page.mouse.up();
  if (cancel || outside) { await page.waitForTimeout(100); assert.equal(commands.length, count); assert.deepEqual(await ids(scope), before); }
  else {
    await submitted;
    const expected = before.filter((_, index) => index !== from); expected.splice(to, 0, before[from]);
    assert.deepEqual(await ids(scope), expected, '接口返回前即显示新顺序');
    await waitSaved();
  }
  assert.equal(await page.locator('.v2-drag-ghost').count(), 0);
}
try {
  await page.goto(base + '/weekly-plans');
  await page.getByRole('button', { name: '项目排序', exact: true }).click();
  await drag('projects', 0, 3, { stationary: true });
  assert.equal((await ids('projects'))[3], fixture.workspace.projects[0].id);
  const savedProjects = await ids('projects');
  for (const period of [fixture.workspace.periods[1], fixture.workspace.periods[0]]) {
    const loaded = page.waitForResponse((response) => response.url().includes('/weekly?') && response.url().includes(`summaryPeriodId=${period.id}`));
    await page.getByLabel('总结区间', { exact: true }).selectOption(period.id);
    await loaded;
    assert.deepEqual(await ids('projects'), savedProjects, '切换周期保持项目顺序');
  }
  await page.reload();
  await page.getByRole('button', { name: '项目排序', exact: true }).click();
  assert.deepEqual(await ids('projects'), savedProjects, '刷新保持已保存项目顺序');
  await drag('projects', 3, 0);
  await drag('projects', 0, 2, { cancel: true });
  await drag('projects', 0, 2, { outside: true });
  const beforeFailure = await ids('projects'); failNext = true;
  await drag('projects', 0, 2);
  assert.deepEqual(await ids('projects'), beforeFailure);
  await page.getByRole('alert').filter({ hasText: '排序已被其他人修改' }).waitFor();
  const firstHandle = page.locator('[data-sort-scope="projects"] button[aria-label^="拖动排序"]').first();
  await firstHandle.focus(); await page.keyboard.press('ArrowDown'); await waitSaved();
  assert.equal(await firstHandle.evaluate(() => document.activeElement?.getAttribute('aria-label')), '拖动排序：山东；也可用上下方向键');
  await page.keyboard.press('ArrowUp'); await waitSaved();
  await page.getByRole('button', { name: '完成排序' }).click();
  const projectId = fixture.workspace.projects[0].id;
  await drag(`summary|${projectId}|`, 0, 3, { stationary: true });
  await drag(`plan|${projectId}|`, 0, 3);
  await page.locator('.v2-main').evaluate((el) => { el.scrollTop = 0; });
  await page.screenshot({ path: evidence + '/weekly.png' });
  await page.getByRole('button', { name: '文字版', exact: true }).click();
  await page.locator('dialog[open]').waitFor();
  assert.equal(await page.locator('dialog.v2-wide').count(), 1);
  await page.screenshot({ path: evidence + '/report.png' });
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('编辑文字').fill('手工编辑保留验证');
  await page.getByRole('button', { name: '关闭', exact: true }).first().click();
  await page.getByText('有未保存的修改。', { exact: true }).waitFor();
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.getByLabel('编辑文字').inputValue(), '手工编辑保留验证');
  await page.getByRole('button', { name: '保存文字', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).waitFor();
  assert.equal(fixture.weekly.text.body, '手工编辑保留验证');
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  await page.getByRole('button', { name: '确认替换', exact: true }).click();
  await page.getByRole('button', { name: '重新生成', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(fixture.weekly.text.body, fixture.weekly.generatedText);
  await page.getByRole('button', { name: '关闭', exact: true }).first().click();
  await page.goto(base + '/work');
  await page.getByRole('button', { name: '项目排序', exact: true }).click();
  await drag('project-page:projects', 0, 3, { stationary: true });
  await drag('project-page:projects', 3, 0);
  await page.getByRole('button', { name: '完成排序' }).click();
  await drag(`project-page:tasks:${projectId}`, 0, 3, { stationary: true });
  await page.locator('.v2-main').evaluate((el) => { el.scrollTop = 0; });
  assert.equal(await page.getByRole('button', { name: '恢复默认排序', exact: true }).count(), 0);
  await page.screenshot({ path: evidence + '/projects.png' });
  await page.getByRole('button', { name: '任务排序选项', exact: true }).first().click();
  await page.getByRole('button', { name: /恢复默认排序/ }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: /恢复默认排序/ }).count(), 0);
  await page.getByRole('button', { name: '任务排序选项', exact: true }).first().click();
  await page.getByRole('button', { name: /恢复默认排序/ }).click(); await waitSaved();
  assert.equal(commands.at(-1).reset, true);
  assert.equal(commands.at(-1).projectId, projectId);
  await page.getByRole('button', { name: '项目排序', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 600 });
  const compact = page.locator('[data-sort-scope="project-page:projects"] button').first();
  const compactBox = await compact.boundingBox();
  await page.mouse.move(compactBox.x + 100, compactBox.y + 20); await page.mouse.down();
  await page.mouse.move(compactBox.x + 100, 590, { steps: 12 });
  await page.waitForFunction(() => document.querySelector('.v2-main').scrollTop > 40);
  await page.waitForTimeout(600);
  const lastBox = await page.locator('[data-sort-scope="project-page:projects"]').boundingBox();
  await page.mouse.move(lastBox.x + 100, lastBox.y + lastBox.height - 2);
  await page.mouse.up(); await waitSaved();
  assert.equal((await ids('project-page:projects')).at(-1), projectId);
  await page.getByRole('button', { name: '完成排序' }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base + `/work?project=${projectId}&tab=tasks`);
  await page.getByRole('button', { name: '＋ 批量新增' }).waitFor();
  await drag(`project-page:tasks:${projectId}`, 0, 3);
  const backlogProject = fixture.workspace.projects[1].id;
  await page.goto(base + `/work?project=${backlogProject}&tab=backlog`);
  await page.getByRole('button', { name: '＋ 新增待建任务' }).waitFor();
  await drag(`project-page:backlog:${backlogProject}`, 0, 2);
  await page.goto(base + '/work');
  await page.getByRole('button', { name: '项目排序', exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: evidence + '/projects-mobile.png' });
  await page.getByRole('button', { name: '项目排序', exact: true }).click();
  await page.getByRole('button', { name: '项目排序选项', exact: true }).click();
  const menuBounds = await page.locator('.v2-order-popover').boundingBox();
  assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= 390);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.goto(base + '/weekly-plans');
  await page.getByRole('button', { name: '文字版', exact: true }).click();
  await page.screenshot({ path: evidence + '/report-mobile.png' });
  assert.equal(await page.evaluate(() => document.querySelector('dialog').getBoundingClientRect().width <= innerWidth), true);
  await page.getByRole('button', { name: '关闭', exact: true }).first().click();
  fixture.workspace.teamLeader = false; fixture.workspace.projects.forEach((project) => { project.canManage = false; }); fixture.weekly.canEditText = false;
  await page.reload();
  await page.getByRole('button', { name: '文字版', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '项目排序', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /任务排序选项/ }).count(), 0);
  await page.getByRole('button', { name: '文字版', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '编辑', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', commands: commands.length, evidence, checks: 'project/task drag, stable target, Escape/outside cancel, conflict rollback, report save/regenerate/dirty guard, keyboard focus, edge scrolling, scoped reset, readonly view, menus, narrow layout' }));
} finally { await browser.close(); }
