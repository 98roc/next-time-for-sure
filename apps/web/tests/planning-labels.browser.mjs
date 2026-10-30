import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sortingFixture } from './sorting-fixture.mjs';

// 使用真实React组件验证交互和布局；写入、迁移与权限另由HTTP/MySQL脚本覆盖。
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createServer } = await import('vite');
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const evidence = fileURLToPath(new URL('../../../.cache/planning-labels-evidence/', import.meta.url));
await mkdir(evidence, { recursive: true });
let browser;
try {
  const fixture = sortingFixture(), w = fixture.workspace, commands = [], errors = [];
  const task = { ...w.tasks[0], title: '计划外周期标签验收' }, [current, next] = w.periods;
  w.tasks = [task]; w.projects = w.projects.slice(0, 1);
  w.categories = [{ id: randomUUID(), ownerId: task.executorId, name: '处理中', status: 'in_progress', isDefault: true, position: 0, version: 0 }];
  w.placements = [{ taskId: task.id, categoryId: w.categories[0].id, position: 0 }];
  w.arrangements = [current, next].map((period, index) => ({ taskId: task.id, periodId: period.id, plannedDays: index ? 1 : null, workNote: '完成接口联调与样例核验', unplanned: !index, position: 0, version: 0 }));
  w.planningLabels = w.arrangements.map(({ taskId, periodId, unplanned }) => ({ taskId, periodId, unplanned }));
  fixture.weekly.projectOrder.ids = [task.projectId];
  fixture.weekly.summary = [{ ...fixture.summary[0], planning: 'unplanned' }];
  await server.listen();
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/v1/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON(); commands.push(command);
      if (command.action === 'save_task') {
        for (const patch of command.planningLabels ?? []) {
          Object.assign(w.arrangements.find(row => row.periodId === patch.periodId), { unplanned: patch.unplanned });
          Object.assign(w.planningLabels.find(row => row.periodId === patch.periodId), { unplanned: patch.unplanned });
          if (patch.periodId === current.id) fixture.weekly.summary[0].planning = patch.unplanned ? 'unplanned' : 'planned';
        }
        task.version++;
      } else assert.equal(command.action, 'create_batch');
      return route.fulfill({ json: { objectIds: [task.id] } });
    }
    const data = pathname.endsWith('/auth/me') ? fixture.identity : pathname.endsWith('/workspace') ? w : pathname.endsWith('/weekly') ? fixture.weekly : pathname.endsWith('/summary') ? fixture.weekly.summary : pathname.endsWith('/history') ? [] : pathname.endsWith('/notifications') ? { accountId: task.executorId, cursor: '0', page: 1, total: 0, messages: [] } : null;
    return route.fulfill({ status: data ? 200 : 404, json: data ?? { message: 'Unmocked read' } });
  });
  const active = page.locator('dialog [data-active="true"]');
  const open = () => page.getByRole('button', { name: task.title, exact: true }).first().click();
  const close = () => active.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.goto(`http://127.0.0.1:${address.port}/weekly-plans`);
  await open();
  const check = index => active.getByRole('checkbox', { name: `计划外 ${index}`, exact: true });
  assert.equal(await check(1).isChecked(), true); assert.equal(await check(2).isChecked(), false);
  const row = active.locator('.v2-task-arrangement').first();
  const bottoms = await row.locator('select,input,button').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().bottom));
  assert.ok(Math.max(...bottoms) - Math.min(...bottoms) < 20, '桌面每条安排的所有控件应位于一行');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: evidence + '/editor-desktop-dark.png', fullPage: true });
  await check(1).uncheck(); await active.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('dialog').waitFor({ state: 'hidden' });
  assert.deepEqual(commands.at(-1).planningLabels, [{ periodId: current.id, unplanned: false }]);
  assert.equal(commands.at(-1).arrangements, undefined, '历史未估算时只保存标签');
  await open(); assert.equal(await check(1).isChecked(), false);
  await check(2).check(); await active.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.w-column').nth(1).getByText('计划外', { exact: true }).count(), 1);
  // 保持里程碑与备注各占一行；内容较多时滚动，标题和底部操作始终可见。
  Object.assign(task, { status: 'completed', actualDays: 1, aiContribution: 'high', startedAt: '2026-10-19T01:00:00.000Z', completedAt: '2026-10-19T10:00:00.000Z' });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.reload();
  await open();
  await page.screenshot({ path: evidence + '/editor-completed-compact-dark.png', fullPage: true });
  const milestone = await active.locator('.v2-editor-basics .v2-full select').boundingBox();
  const remark = await active.locator('.v2-task-remark').boundingBox();
  const basics = await active.locator('.v2-editor-basics').boundingBox();
  assert.ok(milestone && remark && basics && milestone.width >= basics.width - 2 && remark.y >= milestone.y + milestone.height, '里程碑整行，备注在下一行');
  const header = await active.locator('.v2-dialog-header').boundingBox(), footer = await active.locator('.v2-dialog-footer').boundingBox();
  assert.ok(header && footer && header.y >= 0 && footer.y + footer.height <= 768, '内容滚动时仍保留标题和底部操作');
  assert.equal(await active.getByRole('button', { name: '此刻', exact: true }).count(), 0);
  const metaPosition = await active.locator('.v2-task-meta').boundingBox(), formPosition = await active.locator('form').boundingBox();
  assert.ok(metaPosition && formPosition && metaPosition.y < formPosition.y, '项目、创建人和操作历史放在表单上方');
  await close();
  await open();
  for (const width of [736,390,320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await active.locator('.v2-content').evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${width}px不能横向溢出`);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: evidence + '/editor-mobile-light.png', fullPage: true });
  await close();

  // 普通执行人可以改标签，不能调整周期；重开仍保留各周期独立值。
  w.teamLeader = false; w.projects[0].canManage = false;
  await page.reload(); await open();
  assert.equal(await active.getByLabel('日期区间 1', { exact: true }).isDisabled(), true);
  assert.equal(await check(1).isEnabled(), true); assert.equal(await check(2).isChecked(), true);
  await close();
  w.teamLeader = true; w.projects[0].canManage = true;
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.reload();
  await page.getByRole('button', { name: '＋ 批量新增', exact: true }).first().click();
  const records = active.locator('.v2-record');
  assert.equal(await records.first().getByRole('checkbox').isChecked(), false);
  await records.first().getByRole('button', { name: '＋ 追加安排', exact: true }).click();
  assert.equal(await records.first().getByRole('checkbox', { name: '计划外 2', exact: true }).isChecked(), false);
  await records.first().getByRole('button', { name: '取消第1条周期安排', exact: true }).click();
  assert.equal(await records.first().getByRole('checkbox').isChecked(), true, '自动默认随最终首个周期变化；人工选择才固定');
  await records.first().getByLabel('日期区间 1', { exact: true }).selectOption(current.id);
  assert.equal(await records.first().getByRole('checkbox').isChecked(), true);
  await records.first().getByRole('checkbox').uncheck();
  await records.first().getByLabel('日期区间 1', { exact: true }).selectOption(next.id);
  await records.first().getByLabel('日期区间 1', { exact: true }).selectOption(current.id);
  assert.equal(await records.first().getByRole('checkbox').isChecked(), false);
  await records.first().getByLabel('任务名称', { exact: true }).fill('明确取消默认标签');
  await records.first().getByLabel('本周期预计投入（人天）1', { exact: true }).fill('1');
  await active.getByRole('button', { name: '＋ 添加一行', exact: true }).click();
  await records.nth(1).getByLabel('任务名称', { exact: true }).fill('独立默认标签');
  await records.nth(1).getByLabel('日期区间 1', { exact: true }).selectOption(current.id);
  await records.nth(1).getByLabel('本周期预计投入（人天）1', { exact: true }).fill('0.5');
  assert.equal(await records.nth(1).getByRole('checkbox').isChecked(), true);
  await active.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('dialog').waitFor({ state: 'hidden' });
  assert.equal(commands.at(-1).tasks[0].unplanned, false);
  assert.equal(commands.at(-1).tasks[1].unplanned, undefined, '未人工调整时由后端按真实创建时刻填默认值');
  assert.deepEqual(errors, []);
  console.log('Planning labels browser passed: one-row desktop layout, period isolation, saving with unknown estimate, persisted clear, plan badge, executor permissions, 736/390/320px layouts and independent batch defaults.');
} finally { await browser?.close(); await server.close(); }
