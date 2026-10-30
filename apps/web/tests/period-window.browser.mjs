import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { sortingFixture } from './sorting-fixture.mjs';

// 仅模拟 API；真实权限、持久化和并发由 period-window.integration.ts 覆盖。
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = sortingFixture(), saved = [], errors = [];
const shift = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
fixture.workspace.today = '2026-10-30';
fixture.workspace.periodWindow = { before: 1, after: 6, version: 0 };
fixture.workspace.periods = Array.from({ length: 15 }, (_, index) => ({ id: randomUUID(), teamId: fixture.workspace.team.id, startOn: shift('2026-10-26', (index - 4) * 7), endOn: shift('2026-11-01', (index - 4) * 7), version: 0 }));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5174';
await page.clock.install();
page.on('pageerror', (error) => errors.push(error.message));
await page.route('**/api/v1/**', async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (route.request().method() === 'POST') {
    const command = route.request().postDataJSON();
    if (path.endsWith('/impact')) {
      saved.push(command);
      return route.fulfill({ json: { title: '调整日期', details: ['日期边界检查'], blockers: [], confirmation: 'a'.repeat(64) } });
    }
    assert.ok(path.endsWith('/planning')); saved.push(command);
    if (command.action === 'set_period_window') {
      if (command.version !== fixture.workspace.periodWindow.version) return route.fulfill({ status: 409, json: { message: '数据已变化，请刷新后重试。' } });
      assert.deepEqual(Object.keys(command).sort(), ['action', 'after', 'before', 'operationId', 'version']);
      fixture.workspace.periodWindow = { before: command.before, after: command.after, version: command.version + 1 };
      fixture.workspace.teamVersion++;
    }
    return route.fulfill({ json: { objectIds: [fixture.workspace.team.id] } });
  }
  const data = path.endsWith('/auth/me') ? fixture.identity : path.endsWith('/workspace') ? fixture.workspace : path.endsWith('/weekly') ? fixture.weekly : null;
  return route.fulfill({ status: data ? 200 : 404, json: data ?? { message: 'Unmocked endpoint' } });
});
const active = page.locator('dialog [data-active="true"]');
const rows = active.locator('.v2-period-row');
const starts = () => rows.evaluateAll((items) => items.map((row) => { const cell = row.cells[1]; return cell.querySelector('input')?.value ?? cell.querySelector('time')?.dateTime; }));
const open = async () => { await page.getByRole('button', { name: '日期区间', exact: true }).click(); await rows.first().waitFor(); };
const save = async () => { await active.getByRole('button', { name: '保存展示范围', exact: true }).click(); await active.getByRole('button', { name: '核对日期影响', exact: true }).waitFor(); };
const refresh = async () => { const done = page.waitForResponse((response) => response.url().endsWith('/v2/workspace')); await page.clock.runFor(10010); await (await done).finished(); await page.clock.runFor(100); };
try {
  await page.goto(base + '/weekly-plans'); await open();
  assert.equal(await rows.count(), 8);
  assert.equal((await starts())[0], '2026-10-19');
  assert.equal(await rows.first().locator('input').count(), 0);
  assert.equal(await rows.first().locator('time').count(), 2);
  assert.equal(await active.locator('.v2-content button').count(), 0);
  assert.equal(await active.getByText('随当前区间滚动，收起不删除任务或历史。', { exact: true }).count(), 0);

  // 收起已改行时保留草稿，窗口保存不携带任何日期修改。
  const editedEnd = rows.last().locator('input').last();
  await editedEnd.fill('2026-12-14');
  await active.getByLabel('向后区间数量', { exact: true }).fill('5');
  await active.getByText('窗口外未保存的日期修改', { exact: true }).waitFor();
  assert.equal(await rows.count(), 8);
  assert.equal(await active.getByRole('button', { name: '核对日期影响', exact: true }).count(), 0);
  assert.equal(await active.getByRole('button', { name: '撤销日期修改', exact: true }).count(), 0);
  await save();
  assert.equal(await rows.last().locator('input').last().inputValue(), '2026-12-14');
  assert.equal(saved[0].after, 5);
  await active.getByLabel('向后区间数量', { exact: true }).fill('6'); await save();

  // 底部日期入口继续走真实影响预览协议；返回保留原日期草稿。
  await active.getByRole('button', { name: '核对日期影响', exact: true }).click();
  await active.getByRole('heading', { name: '确认调整日期区间', exact: true }).waitFor();
  await active.getByText('日期边界检查', { exact: true }).waitFor();
  const preview = saved.at(-1);
  assert.equal(preview.action, 'change_periods');
  assert.equal(preview.periods[0].endOn, '2026-12-14');
  assert.equal('before' in preview || 'after' in preview, false);
  await active.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await rows.last().locator('input').last().inputValue(), '2026-12-14');

  // 跨周轮询保持编辑锚点，撤销后立即恢复团队窗口滚动。
  fixture.workspace.today = '2026-11-02'; await refresh();
  assert.equal((await starts())[0], '2026-10-19');
  assert.equal(await rows.last().locator('input').last().inputValue(), '2026-12-14');
  await active.getByRole('button', { name: '撤销日期修改', exact: true }).click();
  assert.equal((await starts())[0], '2026-10-26');
  assert.equal(await rows.count(), 8);

  // 他人修改窗口后不覆盖本地窗口草稿，明确提供读取最新入口。
  await active.getByLabel('向前区间数量', { exact: true }).fill('3');
  fixture.workspace.periodWindow = { before: 2, after: 3, version: fixture.workspace.periodWindow.version + 1 }; await refresh();
  assert.equal(await active.getByRole('button', { name: '保存展示范围', exact: true }).isDisabled(), true);
  await active.getByRole('button', { name: '读取最新范围', exact: true }).click();
  assert.equal(await rows.count(), 6);
  await active.getByRole('button', { name: '恢复默认范围', exact: true }).click(); await save();
  assert.equal(await rows.count(), 8);

  // 两端均可缩至零，当前区间仍保留；关闭保护未保存窗口。
  await active.getByLabel('向前区间数量', { exact: true }).fill('0');
  await active.getByLabel('向后区间数量', { exact: true }).fill('0');
  assert.equal(await rows.count(), 1);
  assert.equal((await starts())[0], '2026-11-02');
  assert.equal(await active.getByLabel('向前区间数量', { exact: true }).inputValue(), '0');
  for (const invalid of ['-1', '1.5', '521']) {
    await active.getByLabel('向前区间数量', { exact: true }).fill(invalid);
    assert.equal(await active.getByLabel('向前区间数量', { exact: true }).inputValue(), '0');
  }
  await active.getByRole('button', { name: '撤销范围修改', exact: true }).click();
  assert.equal(await rows.count(), 8);
  await active.getByLabel('向后区间数量', { exact: true }).fill('0');
  await active.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.getByRole('button', { name: '确认放弃', exact: true }).click();
  await open(); assert.equal(await rows.count(), 8);

  // 390px 小屏布局与普通成员只读入口。
  await mkdir('.cache/period-window-evidence', { recursive: true });
  const footer = active.locator('.v2-dialog-footer');
  assert.equal(await footer.getByRole('button', { name: '恢复默认范围', exact: true }).count(), 1);
  assert.equal(await active.locator('.v2-content h3').count(), 0);
  await page.screenshot({ path: '.cache/period-window-evidence/desktop.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: '.cache/period-window-evidence/dark.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await active.evaluate((element) => element.scrollWidth > element.clientWidth + 1), false);
  await page.screenshot({ path: '.cache/period-window-evidence/mobile.png' });
  await page.setViewportSize({ width: 320, height: 720 });
  assert.equal(await active.locator('.v2-content').evaluate((element) => element.scrollWidth > element.clientWidth + 1), false);
  assert.equal(await footer.evaluate((element) => element.scrollWidth > element.clientWidth + 1), false);
  fixture.workspace.teamLeader = false;
  await page.reload(); await open();
  assert.equal(await rows.count(), 8);
  assert.equal(await active.getByRole('button', { name: '保存展示范围', exact: true }).count(), 0);
  assert.equal(await active.getByLabel('向前区间数量', { exact: true }).isDisabled(), true);
  assert.equal(await rows.locator('time').count(), 16);
  assert.equal(await rows.locator('input:not(:disabled)').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Period window browser passed: default, team changes, drafts, rolling, conflict, reset, zero edges, member permissions and narrow layout.');
} finally { await browser.close(); }
