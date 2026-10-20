import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sortingFixture } from './sorting-fixture.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createServer } = await import('vite');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const evidence = fileURLToPath(new URL('../../../.cache/messages-evidence/', import.meta.url));
await mkdir(evidence, { recursive: true });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const fixture = sortingFixture(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const task = fixture.workspace.tasks[0], project = fixture.workspace.projects[0];
  const titles = ['登录接口联调', '项目权限校验', '修复周报导出格式', '首页布局适配', '数据库迁移验证', '任务状态同步', '客户端更新验证', '里程碑详情优化', '消息分页接口', '生产环境回归', '完善任务筛选'];
  let fail = false;
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path.endsWith('/notifications')) {
      if (fail) return route.fulfill({ status: 503, json: { message: '测试连接失败' } });
      const current = Number(url.searchParams.get('page') || 1);
      return route.fulfill({ json: { accountId: fixture.identity.id, cursor: '11', page: current, total: 11, messages: Array.from({ length: current === 1 ? 10 : 1 }, (_, i) => ({ id: `${11 - (current - 1) * 10 - i}`, createdAt: '2026-10-20T01:00:00.000Z', items: [{ taskId: task.id, title: titles[(current - 1) * 10 + i], projectId: project.id, projectName: project.name, reasons: ['张三为你安排了任务'] }] })) } });
    }
    const data = path.endsWith('/auth/me') ? fixture.identity : path.endsWith('/workspace') ? fixture.workspace : path.endsWith('/summary') ? fixture.summary : path.endsWith('/history') ? [] : null;
    return route.fulfill({ status: data ? 200 : 404, json: data ?? { message: '未模拟接口' } });
  });
  await page.goto(`http://127.0.0.1:${address.port}/personal`);
  await page.getByRole('button', { name: '消息', exact: true }).click();
  await page.getByText('1 / 2').waitFor();
  assert.equal(await page.locator('.v2-messages-list>li').count(), 10);
  await page.screenshot({ path: evidence + '/desktop.png', fullPage: true });
  await page.getByRole('button', { name: '下一页消息', exact: true }).click();
  await page.getByText('2 / 2').waitFor();
  assert.equal(await page.locator('.v2-messages-list>li').count(), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: evidence + '/mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole('button', { name: '完善任务筛选', exact: true }).click();
  await page.getByRole('textbox').first().waitFor();
  await page.keyboard.press('Escape');
  await page.getByText('2 / 2').waitFor();
  fixture.workspace.tasks = [];
  await page.getByRole('button', { name: '完善任务筛选', exact: true }).click();
  await page.getByText('任务已删除或你已无权访问。').waitFor();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  fail = true;
  await page.getByRole('button', { name: '消息', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '消息加载失败' }).waitFor({ timeout: 20000 });
  assert.deepEqual(errors, []);
  console.log('PASS messages: popup, pagination, narrow layout, detail navigation, unavailable target and error feedback.');
} finally {
  await browser?.close();
  await server.close();
}
