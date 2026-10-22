import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sortingFixture } from './sorting-fixture.mjs';

// 页面交互使用内存 API；真实权限、历史与数据库另由 personal-work.integration 验证。
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createServer } = await import('vite');
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const evidence = fileURLToPath(new URL('../../../.cache/personal-work-evidence/', import.meta.url));
await mkdir(evidence, { recursive: true });
let browser;
try {
  const fixture = sortingFixture(), w = fixture.workspace, errors = [], commands = [];
  w.projects = w.projects.slice(0, 2);
  const task = { ...w.tasks[0], status: 'not_started', title: '完善用户管理与权限联动' };
  const done = { ...w.tasks[1], status: 'completed', title: '当日完成任务', completedAt: `${w.today}T02:00:00.000Z` };
  const old = { ...w.tasks[2], status: 'completed', title: '昨日完成任务', completedAt: '2026-10-18T02:00:00.000Z' };
  w.tasks = [task, done, old];
  w.categories = ['not_started', 'in_progress', 'completed'].map((status, position) => ({ id: randomUUID(), ownerId: fixture.identity.id, name: ['未开始', '进行中', '已完成'][position], status, isDefault: true, position, version: 0 }));
  w.placements = w.tasks.map((row, position) => ({ taskId: row.id, ownerId: fixture.identity.id, categoryId: w.categories.find(c => c.status === row.status).id, position }));
  let subtasks = { taskId: task.id, version: 0, items: [] }, savedReport = null;
  function report(on) {
    const projects = w.personalPreferences.projectOrder?.map(id => w.projects.find(p => p.id === id)) ?? w.projects;
    const generatedText = `山东\n1.${task.title}\n${subtasks.items.filter(i => i.completed).map((i, index) => `  （${index + 1}）${i.title}`).join('\n')}\n2.当日完成任务`;
    const currentSourceHash = String(subtasks.version % 10).repeat(64);
    return { on, preferences: w.personalPreferences, projects, generatedText, currentSourceHash, text: savedReport ? { ...savedReport, stale: savedReport.sourceHash !== currentSourceHash } : { body: generatedText, manual: false, sourceHash: currentSourceHash, version: 0, stale: false } };
  }
  await server.listen();
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); commands.push(body);
      if (path.endsWith('/subtasks')) subtasks = { taskId: task.id, version: subtasks.version + 1, items: body.items.map(i => ({ ...i, completedAt: i.completed ? `${w.today}T02:00:00.000Z` : null })) };
      else if (path.endsWith('/personal-settings')) w.personalPreferences = { ...w.personalPreferences, version: w.personalPreferences.version + 1, ...(body.action === 'set_completed_mode' ? { completedMode: body.mode } : { projectOrder: body.projectIds }) };
      else if (path.endsWith('/daily')) savedReport = body.action === 'regenerate_daily' ? null : { body: body.body, sourceHash: body.sourceHash, version: body.version + 1, manual: true };
      else return route.fulfill({ status: 400, json: { message: 'Unexpected mutation' } });
      return route.fulfill({ json: { objectIds: [task.id] } });
    }
    const data = path.endsWith('/auth/me') ? fixture.identity : path.endsWith('/workspace') ? w : path.endsWith('/subtasks') ? subtasks : path.endsWith('/daily') ? report(url.searchParams.get('on')) : path.endsWith('/weekly') ? fixture.weekly : path.endsWith('/summary') ? fixture.summary : null;
    return route.fulfill({ status: data ? 200 : 404, json: data ?? { message: 'Unmocked read' } });
  });
  const active = page.locator('dialog [data-active="true"]');
  const close = async () => { await active.getByRole('button', { name: '关闭', exact: true }).last().click(); await page.locator('dialog').waitFor({ state: 'hidden' }); };
  const rows = () => active.locator('.v2-private-row');
  const names = () => rows().locator('.v2-private-name').allTextContents();
  const go = async () => page.goto(`http://127.0.0.1:${address.port}/personal`);
  await go();
  const dailyButton = page.getByRole('button', { name: '我的日报', exact: true });
  await dailyButton.waitFor(); assert.equal(await dailyButton.locator('svg').count(), 1);
  const buttonStyles = await page.locator('.mw-heading .mw-quiet').evaluateAll(buttons => buttons.map(b => { const s = getComputedStyle(b); return [s.backgroundColor, s.borderWidth, s.color]; })); assert.deepEqual(buttonStyles[0], buttonStyles[1]);
  assert.equal(await page.getByRole('button', { name: '当日完成任务', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: '昨日完成任务', exact: true }).count(), 0);
  await page.getByLabel('完成日期', { exact: true }).fill('2026-10-18');
  await page.getByRole('button', { name: '昨日完成任务', exact: true }).waitFor();
  await page.reload(); await page.getByRole('button', { name: '当日完成任务', exact: true }).waitFor();
  await page.getByLabel('已完成分类操作').click(); await page.getByRole('button', { name: '按日期区间', exact: true }).click();
  await page.getByLabel('完成日期区间', { exact: true }).waitFor();
  await page.reload(); await page.getByLabel('完成日期区间', { exact: true }).waitFor();
  await page.getByLabel('已完成分类操作').click(); await page.getByRole('button', { name: /^按日期$/ }).click();
  await page.getByLabel('完成日期', { exact: true }).waitFor();
  const card = page.locator('.mw-task').filter({ has: page.getByRole('button', { name: task.title, exact: true }) });
  assert.deepEqual(await card.locator('.mw-task-actions button').allTextContents(), ['子任务', '开始']);
  await card.getByRole('button', { name: '子任务', exact: true }).click();
  for (const title of ['修复部门与角色联动', '补充省直用户校验', '整理验证记录']) { await active.getByLabel('新增子任务名称').fill(title); await active.getByRole('button', { name: '添加', exact: true }).click(); }
  // 真指针手势验证弹窗内拖拽，避免克隆节点被误认作新行而取消手势。
  const handle = await rows().first().locator('.v2-sort-handle').boundingBox(), target = await rows().last().boundingBox(); assert.ok(handle && target);
  await page.mouse.move(handle.x + 10, handle.y + 10); await page.mouse.down(); await page.mouse.move(handle.x + 10, target.y + target.height - 3, { steps: 12 }); await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('dialog [data-active="true"] .v2-private-name')?.textContent === '补充省直用户校验');
  assert.deepEqual(await names(), ['补充省直用户校验', '整理验证记录', '修复部门与角色联动']);
  await rows().first().getByRole('checkbox').check(); await rows().last().getByRole('checkbox').check();
  await rows().nth(1).getByRole('button', { name: '编辑', exact: true }).click(); await active.getByLabel('子任务名称', { exact: true }).fill('待删除步骤');
  await rows().nth(1).getByRole('button', { name: '删除', exact: true }).click(); await active.getByRole('button', { name: '确认删除', exact: true }).click();
  await rows().first().waitFor(); assert.equal(await rows().count(), 2);
  await active.getByRole('button', { name: '关闭', exact: true }).last().click(); await page.getByText('有未保存的修改。').waitFor(); await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.screenshot({ path: evidence + '/subtasks.png', fullPage: true });
  await active.getByRole('button', { name: '保存', exact: true }).click(); await page.locator('dialog').waitFor({ state: 'hidden' });
  assert.deepEqual(subtasks.items.map(i => i.title), ['补充省直用户校验', '修复部门与角色联动']);
  await card.getByRole('button', { name: '子任务', exact: true }).click(); await rows().first().waitFor();
  await rows().first().getByRole('button', { name: '删除', exact: true }).click(); await active.getByRole('button', { name: '确认删除', exact: true }).click();
  await active.getByRole('button', { name: '保存', exact: true }).click(); await page.locator('dialog').waitFor({ state: 'hidden' });
  assert.equal(commands.at(-1).removedIds.length, 1);
  await dailyButton.click(); await active.locator('pre').waitFor();
  assert.match(await active.locator('pre').textContent(), /^山东\n/u);
  assert.match(await active.locator('pre').textContent(), /（1）修复部门与角色联动/u); assert.doesNotMatch(await active.locator('pre').textContent(), /未开始|进行中|（当日完成）|\d{4}-\d{2}-\d{2} 日报/u);
  await page.screenshot({ path: evidence + '/daily-light.png', fullPage: true });
  await active.getByRole('button', { name: '编辑', exact: true }).click(); await active.getByRole('textbox', { name: '编辑文字', exact: true }).fill('我的手工日报');
  assert.equal(await active.getByLabel('日报日期', { exact: true }).isDisabled(), true);
  await active.getByRole('button', { name: '保存文字', exact: true }).click(); await active.getByRole('button', { name: '重新生成', exact: true }).waitFor();
  await active.getByRole('button', { name: '重新生成', exact: true }).click(); await active.getByRole('button', { name: '保留原文', exact: true }).click(); assert.equal(await active.locator('pre').textContent(), '我的手工日报');
  await active.getByRole('button', { name: '重新生成', exact: true }).click(); await active.getByRole('button', { name: '确认替换', exact: true }).click(); await active.getByRole('heading', { name: '重新生成预览' }).waitFor({ state: 'hidden' });
  await active.getByLabel('日报选项').click(); await active.getByRole('button', { name: '项目排序', exact: true }).click();
  await rows().first().locator('.v2-sort-handle').focus(); await page.keyboard.press('ArrowDown');
  await active.getByRole('button', { name: '保存', exact: true }).click(); await active.getByLabel('日报日期', { exact: true }).waitFor(); assert.deepEqual(w.personalPreferences.projectOrder, [w.projects[1].id, w.projects[0].id]);
  await active.getByLabel('日报选项').click(); await active.getByRole('button', { name: '恢复跟随项目排序', exact: true }).click(); await active.getByRole('button', { name: '确认恢复', exact: true }).click(); await active.getByLabel('日报日期', { exact: true }).waitFor(); assert.equal(w.personalPreferences.projectOrder, null);
  await page.emulateMedia({ colorScheme: 'dark' }); await page.screenshot({ path: evidence + '/daily-dark.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: evidence + '/daily-mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await active.locator('.v2-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await close(); await card.getByRole('button', { name: '子任务', exact: true }).click(); await rows().first().waitFor(); await page.screenshot({ path: evidence + '/subtasks-mobile.png', fullPage: true });
  assert.ok(await active.locator('.v2-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1)); await close();
  assert.deepEqual(errors, []);
  console.log('PASS personal work UI: quiet icon, day/period persistence, private editor CRUD, pointer sorting, unsaved guard, daily numbering, text protection, project ordering, dark and narrow layouts.');
} finally { await browser?.close(); await server.close(); }
