import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sortingFixture } from './sorting-fixture.mjs';

// 页面使用内存 API 验证交互；权限及实际落库由 view-orders.integration 验证。
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createServer } = await import('vite');
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const evidence = fileURLToPath(new URL('../../../.cache/view-orders-evidence/', import.meta.url));
await mkdir(evidence, { recursive: true });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const fixture = sortingFixture(), w = fixture.workspace, errors = [], commands = [];
  const other = { ...w.accounts[0], id: randomUUID(), loginName: 'other', displayName: '其他成员' };
  w.accounts.push(other);
  w.projects[0].members.push({ accountId: other.id, roles: ['developer'] });
  w.categories = ['not_started', 'in_progress', 'completed'].map((status, position) => ({ id: randomUUID(), ownerId: fixture.identity.id, name: ['未开始', '进行中', '已完成'][position], status, isDefault: true, position, version: 0 }));
  fixture.weekly.peopleOrder = { ids: [fixture.identity.id], version: 0, manual: false };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'POST') {
      const command = request.postDataJSON(); commands.push(command);
      if (command.action === 'reorder_projects') {
        const order = command.page === 'projects' ? w.orders[0] : fixture.weekly.projectOrder;
        order.ids = command.projectIds; order.version++; order.manual = true;
      }
      return route.fulfill({ json: { objectIds: [randomUUID()] } });
    }
    const data = path.endsWith('/auth/me') ? fixture.identity : path.endsWith('/workspace') ? w : path.endsWith('/weekly') ? fixture.weekly : path.endsWith('/summary') ? fixture.summary : null;
    return route.fulfill({ status: data ? 200 : 404, json: data ?? { message: 'Unexpected endpoint' } });
  });

  // 新入口位于个人下面；选择他人后不沿用本人的分类或完成状态。
  await page.goto(base + '/personal');
  await page.getByRole('button', { name: '＋ 新建任务', exact: true }).click();
  const source = page.getByLabel('任务来源', { exact: true });
  await source.waitFor();
  assert.deepEqual((await source.locator('option').allTextContents()).slice(0, 2), ['个人 · 仅自己可见', '他人 · 项目任务']);
  await page.getByLabel('个人分类', { exact: true }).selectOption(w.categories[2].id);
  await source.selectOption('others');
  assert.equal(await page.getByLabel('个人分类', { exact: true }).count(), 0);
  assert.deepEqual(await page.getByLabel('执行人', { exact: true }).locator('option').allTextContents(), ['请选择执行人', other.displayName]);
  await page.getByLabel('任务名称', { exact: true }).fill('工作台给他人安排');
  await page.getByLabel('执行人', { exact: true }).selectOption(other.id);
  await page.getByLabel('本周期预计投入（人天）1', { exact: true }).fill('1');
  await page.screenshot({ path: evidence + '/create-for-other.png' });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '操作成功' }).waitFor();
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(new URL(page.url()).pathname, '/personal');
  const created = commands.find(command => command.action === 'create_project');
  assert.equal(created.task.executorId, other.id);
  assert.equal(created.task.projectId, w.projects[0].id);
  assert.equal('categoryId' in created, false); assert.equal('completion' in created.task, false);

  // 普通研发保留批量新增与个人排序，执行人只有本人；完全无管理权限的入口隐藏。
  w.teamLeader = false;
  w.projects.forEach(project => { project.canManage = false; project.canConfirmMilestone = false; project.members[0].roles = ['developer']; });
  await page.reload();
  await page.getByRole('button', { name: '＋ 新建任务', exact: true }).click();
  assert.equal(await source.locator('option[value="others"]').count(), 0);
  await page.getByRole('button', { name: '关闭', exact: true }).first().click();
  assert.equal(await page.getByRole('navigation', { name: '主导航' }).getByText('团队管理', { exact: true }).count(), 0);
  await page.goto(base + '/weekly-plans');
  await page.getByRole('button', { name: '项目排序', exact: true }).waitFor();
  const handle = page.getByRole('button', { name: new RegExp(`拖动排序：${w.projects[0].name}；`) }).first();
  assert.equal(await handle.isEnabled(), true);
  await handle.focus(); await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => !document.querySelector('[aria-disabled="true"]:not(:disabled)'));
  assert.ok(commands.some(command => command.action === 'reorder_projects'));
  await page.getByRole('button', { name: '＋ 批量新增', exact: true }).first().click();
  assert.equal(await page.getByLabel('执行人', { exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel('执行人', { exact: true }).inputValue(), fixture.identity.id);
  await page.getByLabel('任务名称', { exact: true }).fill('普通研发批量新增');
  await page.getByLabel('本周期预计投入（人天）1', { exact: true }).fill('1');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('dialog[open]').waitFor({ state: 'hidden' });
  assert.equal(commands.find(command => command.action === 'create_batch').tasks[0].executorId, fixture.identity.id);
  w.projects.forEach(project => { project.canCreate = false; project.members[0].roles = ['project_manager']; });
  await page.reload();
  await page.getByRole('button', { name: '项目排序', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '＋ 批量新增', exact: true }).count(), 0);

  // 超管两个管理入口使用不同 SVG，窄屏也没有横向溢出。
  fixture.identity.isSuperAdmin = true; w.teamLeader = true;
  await page.reload();
  const nav = page.getByRole('navigation', { name: '主导航' });
  await nav.getByRole('link', { name: '账号管理', exact: true }).waitFor();
  assert.notEqual(await nav.getByRole('link', { name: '账号管理', exact: true }).locator('svg').innerHTML(), await nav.getByRole('link', { name: '团队管理', exact: true }).locator('svg').innerHTML());
  await page.screenshot({ path: evidence + '/admin-navigation.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', evidence, checks: 'other-task source, own-category exclusion, success feedback, developer batch creation, personal sorting, hidden unauthorized actions, distinct admin icons, narrow layout' }));
} finally { await browser?.close(); await server.close(); }
