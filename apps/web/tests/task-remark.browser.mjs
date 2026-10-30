import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sortingFixture } from './sorting-fixture.mjs';

// 模拟API只验证真实页面交互；持久化、权限与并发由task-remark.integration覆盖。
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { preview } = await import('vite');
const server = await preview({ root: fileURLToPath(new URL('../', import.meta.url)), preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const evidence = fileURLToPath(new URL('../../../.cache/task-remark-evidence/', import.meta.url));
await mkdir(evidence, { recursive: true });
let browser;
try {
  const fixture = sortingFixture(), w = fixture.workspace, task = w.tasks[0], commands = [], errors = [];
  w.projects = w.projects.slice(0, 1); w.tasks = [task]; w.backlog = [];
  task.remark = ''; task.status = 'not_started';
  w.arrangements = [{ taskId: task.id, periodId: w.periods[0].id, plannedDays: 1, workNote: '', position: 0, version: 0 }];
  w.categories = [{ id: randomUUID(), ownerId: fixture.identity.id, name: '任务池', status: 'not_started', isDefault: true, position: 0, version: 0 }];
  w.placements = [{ taskId: task.id, categoryId: w.categories[0].id, position: 0 }];
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON(); commands.push(command);
      if (command.action === 'save_task') { if (command.remark !== undefined) task.remark = command.remark; task.version++; }
      return route.fulfill({ json: { objectIds: [task.id] } });
    }
    const data = path.endsWith('/auth/me') ? fixture.identity : path.endsWith('/workspace') ? w : path.endsWith('/summary') ? fixture.summary : path.endsWith('/weekly') ? fixture.weekly : null;
    return route.fulfill({ status: data ? 200 : 404, json: data ?? { message: 'Unmocked read' } });
  });
  const active = page.locator('dialog [data-active="true"]');
  const open = async () => {
    await page.goto(`http://127.0.0.1:${address.port}/work?project=${task.projectId}`);
    await page.getByRole('button', { name: task.title, exact: true }).click();
    await active.getByRole('heading', { name: '编辑任务', exact: true }).waitFor();
  };
  const toggle = () => active.getByRole('button', { name: /^备注/u });
  const close = () => active.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.emulateMedia({ colorScheme: 'dark' }); await open();
  assert.equal(await toggle().getAttribute('aria-expanded'), 'false');
  assert.equal(await active.getByLabel('备注', { exact: true }).isVisible(), false);
  assert.equal(await active.getByText(/区间结束时/u).count(), 0);
  assert.equal(await toggle().innerText(), '备注');
  const geometry = await toggle().evaluate((button) => {
    const text = button.querySelector('span').getBoundingClientRect(), arrow = button.querySelector('svg').getBoundingClientRect();
    const label = button.closest('form').querySelector('.v2-field').getBoundingClientRect();
    return { gap: arrow.left - text.right, alignment: text.left - label.left, border: getComputedStyle(button).borderWidth, padding: getComputedStyle(button).paddingLeft };
  });
  assert.ok(geometry.gap >= 4 && geometry.gap <= 8); assert.ok(Math.abs(geometry.alignment) < 1);
  assert.equal(geometry.border, '0px'); assert.equal(geometry.padding, '0px');
  await page.screenshot({ path: evidence + '/collapsed-dark.png', fullPage: true });
  await toggle().focus(); await page.keyboard.press('Enter');
  await active.getByLabel('备注', { exact: true }).fill('补充背景\n验收时保留换行');
  await toggle().click(); assert.equal(await toggle().getAttribute('aria-expanded'), 'false');
  assert.match(await toggle().innerText(), /已填写/u);
  await toggle().click(); assert.equal(await active.getByLabel('备注', { exact: true }).inputValue(), '补充背景\n验收时保留换行');
  await page.screenshot({ path: evidence + '/expanded-dark.png', fullPage: true });
  await active.getByRole('button', { name: '保存', exact: true }).click(); await page.locator('dialog').waitFor({ state: 'hidden' });
  assert.equal(commands.at(-1).remark, '补充背景\n验收时保留换行');

  // 普通执行人仍能改备注，但不提交或解锁管理字段。
  w.projects[0].canManage = false;
  await open(); assert.equal(await toggle().getAttribute('aria-expanded'), 'false');
  await toggle().click(); assert.equal(await active.getByLabel('备注', { exact: true }).inputValue(), task.remark);
  await active.getByLabel('备注', { exact: true }).fill('执行人补充');
  await active.getByRole('button', { name: '保存', exact: true }).click(); await page.locator('dialog').waitFor({ state: 'hidden' });
  assert.equal(commands.at(-1).remark, '执行人补充'); assert.equal(commands.at(-1).details, undefined);

  // 只读者可展开，浅色与移动端不溢出。
  const executorId = task.executorId; task.executorId = randomUUID();
  await page.emulateMedia({ colorScheme: 'light' }); await page.setViewportSize({ width: 390, height: 844 }); await open(); await toggle().click();
  assert.equal(await active.getByLabel('备注', { exact: true }).getAttribute('readonly'), '');
  assert.equal(await active.getByRole('button', { name: '保存', exact: true }).count(), 0);
  assert.ok(await active.locator('.v2-content').evaluate((element) => element.scrollWidth <= element.clientWidth + 1));
  await page.screenshot({ path: evidence + '/readonly-mobile-light.png', fullPage: true }); await close();
  task.executorId = executorId; w.projects[0].canManage = true;

  // 批量创建每行独立折叠，私人任务也能填写备注。
  await page.setViewportSize({ width: 1440, height: 950 }); await open(); await close();
  await page.getByRole('button', { name: /批量新增/u }).click();
  await active.getByRole('button', { name: /添加一行/u }).click();
  assert.equal(await toggle().count(), 2); await toggle().first().click();
  await active.getByLabel('备注', { exact: true }).first().fill('第一条备注');
  assert.equal(await toggle().last().getAttribute('aria-expanded'), 'false');
  await page.goto(`http://127.0.0.1:${address.port}/personal`);
  await page.getByRole('button', { name: /新建任务/u }).first().click();
  await active.getByLabel('任务名称', { exact: true }).fill('个人备注任务');
  await toggle().click(); await active.getByLabel('备注', { exact: true }).fill('私人补充');
  await active.getByRole('button', { name: '保存', exact: true }).click(); await page.locator('dialog').waitFor({ state: 'hidden' });
  assert.equal(commands.at(-1).action, 'create_private'); assert.equal(commands.at(-1).task.remark, '私人补充');
  assert.deepEqual(errors, []);
  console.log('Task remark UI passed: alignment, keyboard, collapse/persistence, executor and read-only views, mobile, batch and private creation.');
} finally { await browser?.close(); await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve())); }
