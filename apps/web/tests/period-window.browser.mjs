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
const rows = active.locator('.w-period-editor');
const starts = () => rows.locator('input[type="date"]').evaluateAll((inputs) => inputs.filter((_, index) => index % 2 === 0).map((input) => input.value));
const open = async () => { await page.getByRole('button', { name: '日期区间', exact: true }).click(); await rows.first().waitFor(); };
const save = async () => { await active.getByRole('button', { name: '保存窗口', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.v2-period-window')?.textContent?.includes('保存后全团队生效') === false); };
const refresh = async () => { const done = page.waitForResponse((response) => response.url().endsWith('/v2/workspace')); await page.clock.runFor(10010); await (await done).finished(); await page.clock.runFor(100); };
try {
  await page.goto(base + '/weekly-plans'); await open();
  assert.equal(await rows.count(), 8);
  assert.equal((await starts())[0], '2026-10-19');
  assert.equal(await rows.first().locator('input').first().isDisabled(), true);

  // 收起已改行时保留草稿，窗口保存不携带任何日期修改。
  const editedEnd = rows.last().locator('input').last();
  await editedEnd.fill('2026-12-14');
  await active.getByRole('button', { name: '减少后面区间', exact: true }).click();
  await active.getByText('窗口外未保存的日期修改', { exact: true }).waitFor();
  assert.equal(await rows.count(), 8);
  await save();
  assert.equal(await rows.last().locator('input').last().inputValue(), '2026-12-14');
  assert.equal(saved[0].after, 5);
  await active.getByRole('button', { name: '增加后面区间', exact: true }).click(); await save();

  // 跨周轮询保持编辑锚点，撤销后立即恢复团队窗口滚动。
  fixture.workspace.today = '2026-11-02'; await refresh();
  assert.equal((await starts())[0], '2026-10-19');
  assert.equal(await rows.last().locator('input').last().inputValue(), '2026-12-14');
  await active.getByRole('button', { name: '撤销日期修改', exact: true }).click();
  assert.equal((await starts())[0], '2026-10-26');
  assert.equal(await rows.count(), 8);

  // 他人修改窗口后不覆盖本地窗口草稿，明确提供读取最新入口。
  await active.getByRole('button', { name: '增加前面区间', exact: true }).click();
  fixture.workspace.periodWindow = { before: 2, after: 3, version: fixture.workspace.periodWindow.version + 1 }; await refresh();
  assert.equal(await active.getByRole('button', { name: '保存窗口', exact: true }).isDisabled(), true);
  await active.getByRole('button', { name: '读取最新窗口', exact: true }).click();
  assert.equal(await rows.count(), 6);
  await active.getByRole('button', { name: '恢复默认', exact: true }).click(); await save();
  assert.equal(await rows.count(), 8);

  // 两端均可缩至零，当前区间仍保留；关闭保护未保存窗口。
  await active.getByRole('button', { name: '减少前面区间', exact: true }).click();
  for (let i = 0; i < 6; i++) await active.getByRole('button', { name: '减少后面区间', exact: true }).click();
  assert.equal(await rows.count(), 1);
  assert.equal((await starts())[0], '2026-11-02');
  assert.equal(await active.getByRole('button', { name: '减少前面区间', exact: true }).isDisabled(), true);
  await active.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.getByRole('button', { name: '确认放弃', exact: true }).click();
  await open(); assert.equal(await rows.count(), 8);

  // 390px 小屏布局与普通成员只读入口。
  await mkdir('.cache/period-window-evidence', { recursive: true });
  await page.screenshot({ path: '.cache/period-window-evidence/desktop.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: '.cache/period-window-evidence/dark.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await active.evaluate((element) => element.scrollWidth > element.clientWidth + 1), false);
  await page.screenshot({ path: '.cache/period-window-evidence/mobile.png' });
  fixture.workspace.teamLeader = false;
  await page.reload(); await open();
  assert.equal(await rows.count(), 8);
  assert.equal(await active.getByRole('button', { name: '保存窗口', exact: true }).count(), 0);
  assert.equal(await active.getByRole('button', { name: '增加前面区间', exact: true }).isDisabled(), true);
  assert.equal(await rows.locator('input:not(:disabled)').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Period window browser passed: default, team changes, drafts, rolling, conflict, reset, zero edges, member permissions and narrow layout.');
} finally { await browser.close(); }
