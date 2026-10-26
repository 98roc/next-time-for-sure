import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sortingFixture } from './sorting-fixture.mjs';

// 浏览器覆盖真实组件、表单提交与布局；跨周期和权限另由真实API/MySQL验证。
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createServer } = await import('vite');
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const evidence = fileURLToPath(new URL('../../../.cache/task-period-evidence/', import.meta.url));
await mkdir(evidence, { recursive: true });
let browser;
try {
  const fixture = sortingFixture(), w = fixture.workspace, errors = [], commands = [];
  const task = { ...w.tasks[0], title: '增加本部门信息化统筹处室联系人' };
  w.tasks = [task]; w.projects = w.projects.slice(0, 1);
  w.categories = ['not_started', 'in_progress', 'completed'].map((status, position) => ({ id: randomUUID(), ownerId: fixture.identity.id, name: ['任务池', '处理中', '已完成'][position], status, isDefault: true, position, version: 0 }));
  w.placements = [{ taskId: task.id, ownerId: fixture.identity.id, categoryId: w.categories[1].id, position: 0 }];
  w.arrangements = [{ taskId: task.id, periodId: w.periods[0].id, plannedDays: 0.5, workNote: '完善联系人信息', carriedFromPeriodId: null, position: 0, version: 0 }];
  await server.listen();
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON(); commands.push(command);
      if (command.action === 'set_status') { Object.assign(task, { status: command.status, completedAt: command.completion?.completedAt ?? new Date().toISOString(), actualDays: command.completion?.actualDays, aiContribution: command.completion?.aiContribution, version: task.version + 1 }); w.placements[0].categoryId = w.categories[2].id; }
      else assert.equal(command.action, 'create_project');
      return route.fulfill({ json: { objectIds: [task.id] } });
    }
    const data = path.endsWith('/auth/me') ? fixture.identity : path.endsWith('/workspace') ? w : path.endsWith('/weekly') ? fixture.weekly : path.endsWith('/summary') ? fixture.summary : null;
    return route.fulfill({ status: data ? 200 : 404, json: data ?? { message: 'Unmocked read' } });
  });
  const active = page.locator('dialog [data-active="true"]');
  await page.goto(`http://127.0.0.1:${address.port}/personal`);
  await page.locator('.mw-task').filter({ has: page.getByRole('button', { name: task.title, exact: true }) }).getByRole('button', { name: '完成', exact: true }).click();
  await active.getByLabel('累计实际投入（人天）', { exact: true }).fill('0.2');
  assert.equal(await active.locator('.v2-completion-time').getAttribute('open'), null);
  assert.match(await active.locator('time').textContent(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u);
  await page.screenshot({ path: evidence + '/completion-dark.png', fullPage: true });
  await active.locator('.v2-completion-time summary').click();
  await active.getByLabel('实际完成时间（北京时间）').fill('2026-10-20T18:30');
  await page.screenshot({ path: evidence + '/completion-expanded.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await active.locator('.v2-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await page.screenshot({ path: evidence + '/completion-mobile.png', fullPage: true });
  await active.getByRole('button', { name: '确认完成', exact: true }).click();
  await page.locator('dialog').waitFor({ state: 'hidden' });
  assert.equal(commands.at(-1).completion.completedAt, '2026-10-20T10:30:00.000Z');
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.getByRole('button', { name: '＋ 新建任务', exact: true }).click();
  await active.getByRole('heading', { name: '新建任务', exact: true }).waitFor();
  await active.getByLabel(/^任务来源/u).selectOption(w.projects[0].id);
  await active.getByLabel('任务名称', { exact: true }).fill('智能体相关代码合并审计分支并测试');
  await active.getByLabel('本周期预计投入（人天）1', { exact: true }).fill('1');
  await active.getByLabel('本期工作 1', { exact: true }).fill('完成审计分支合并，验证主要功能');
  const boxes = await active.locator('.v2-task-arrangement input, .v2-task-arrangement select').evaluateAll(els => els.map(el => ({ top: el.getBoundingClientRect().top, tag: el.tagName })));
  assert.equal(boxes.length, 3); assert.ok(boxes.every(box => Math.abs(box.top - boxes[0].top) < 2), '周期、预计投入和本期工作必须同一行');
  await page.screenshot({ path: evidence + '/planning-dark.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: evidence + '/planning-light.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await active.locator('.v2-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await page.screenshot({ path: evidence + '/planning-mobile.png', fullPage: true });
  await active.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('dialog').waitFor({ state: 'hidden' });
  assert.equal(commands.at(-1).task.workNote, '完成审计分支合并，验证主要功能');
  assert.deepEqual(errors, []);
  console.log('PASS task periods UI: concrete collapsed timestamp, editable Shanghai time payload, compact completion, same-row optional work note, dark/light/narrow layouts. Mock API only.');
} finally { await browser?.close(); await server.close(); }
