import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sortingFixture } from './sorting-fixture.mjs';

// 正式页面交互回归使用内存接口；真实权限、事务与审计由 milestone-editor.integration 验证。
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = sortingFixture(), data = fixture.workspace, project = data.projects[0];
data.today = data.naturalWeekStart = '2026-10-26';
data.periods.push({ ...data.periods[1], id: randomUUID(), startOn: '2026-11-02', endOn: '2026-11-08' });
fixture.weekly.summaryPeriod = data.periods[1]; fixture.weekly.planPeriod = data.periods[2];
data.orders[0].ids = data.projects.map((row) => row.id);
data.projects.reverse();
const target = (title, expectedOn, status = 'open') => ({ id: randomUUID(), projectId: project.id, title, expectedOn, status, needsReview: false, version: 0, createdAt: '2026-10-20T00:00:00.000Z' });
const planned = target('审计分支融合与功能测试', '2026-10-30');
const unplanned = target('与同域对接云资源监测并完成需求限制、云资源监测统计、闲置回收', null);
data.milestones = [planned, target('测试里程碑', '2026-10-30'), target('绩效管理接口开发', '2026-11-06'), target('绩效管理对接完成', '2026-11-13', 'completed'), target('阶段验收', '2026-11-20'), unplanned, ...Array.from({ length: 11 }, (_, index) => target(`历史目标 ${index + 1}`, `2026-10-${String(index + 1).padStart(2, '0')}`, index % 2 ? 'completed' : 'open'))];
for (const task of data.tasks.filter((row) => row.projectId === project.id)) task.milestoneId = planned.id;
const linked = data.tasks.filter((row) => row.milestoneId === planned.id);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, colorScheme: 'dark' });
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5174', errors = [], saved = [], preferences = [];
let rejectPreference = false;
page.on('pageerror', (error) => errors.push(error.message));
await page.route('**/api/v1/**', async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (route.request().method() === 'POST') {
    const command = route.request().postDataJSON();
    if (path.endsWith('/personal-settings')) {
      if (rejectPreference) { rejectPreference = false; return route.fulfill({ status: 409, json: { message: '偏好已变化，请重试' } }); }
      assert.equal(command.action, 'set_milestone_mode'); assert.equal(command.version, data.personalPreferences.version);
      preferences.push(command); data.personalPreferences.milestoneMode = command.mode; data.personalPreferences.version++;
      return route.fulfill({ json: { objectIds: [fixture.identity.id] } });
    }
    if (path.endsWith('/impact')) return route.fulfill({ json: { title: planned.title, details: ['截止日期变更', ...(command.unlinkTasks ?? []).map((row) => `解除关联：${linked.find((task) => task.id === row.taskId).title}`)], blockers: [], confirmation: 'a'.repeat(64) } });
    assert.ok(path.endsWith('/projects')); assert.equal(command.action, 'edit_milestone'); saved.push(command);
    const row = data.milestones.find((row) => row.id === command.milestoneId);
    row.title = command.title; row.expectedOn = command.expectedOn; row.version++;
    for (const item of command.unlinkTasks ?? []) { const task = data.tasks.find((task) => task.id === item.taskId); task.milestoneId = null; task.version++; }
    return route.fulfill({ json: { objectIds: [row.id] } });
  }
  const result = path.endsWith('/auth/me') ? fixture.identity : path.endsWith('/workspace') ? data : path.endsWith('/weekly') ? fixture.weekly : path.endsWith('/summary') ? fixture.summary : null;
  return route.fulfill({ status: result ? 200 : 404, json: result ?? { message: 'Unmocked endpoint' } });
});
const active = page.locator('dialog[open] [data-active="true"]');
const panel = page.getByRole('region', { name: `${project.name}里程碑`, exact: true });
const close = () => active.getByRole('button', { name: '关闭', exact: true }).last().click();
const screenshot = async (name) => { if (process.env.SCREENSHOT_DIR) { await mkdir(process.env.SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, `${name}.png`), fullPage: false }); } };
/** 连线必须铺满实际路线，不能只检查路径存在，防止被页面的 SVG 图标规则缩成16px。 */
async function verifyAxisViewport() {
  await page.waitForFunction(() => {
    const svg = document.querySelector('.v2-ms-page .v2-ms-route');
    const bounds = svg?.getBoundingClientRect(), parent = svg?.parentElement?.getBoundingClientRect();
    return bounds && parent && bounds.width > 100 && Math.abs(bounds.width - parent.width) < 1 && Math.abs(bounds.height - parent.height) < 1;
  });
}
try {
  await page.goto(base + '/work?view=milestones');
  await panel.waitFor();
  assert.equal(await page.locator('.v2-milestone-panel').first().getAttribute('aria-label'), '山东里程碑');
  assert.equal(await page.locator('.v2-milestone-panel').nth(1).locator('.v2-ms-unplanned').count(), 0);
  assert.equal(await panel.locator('.v2-ms-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await panel.locator('.v2-ms-stage').first().locator('.v2-ms-card').count(), 2);
  const heading = await panel.locator(':scope > .v2-ms-heading h3').boundingBox();
  const actions = await panel.locator(':scope > .v2-ms-heading .v2-actions').boundingBox();
  assert.ok(heading && actions && actions.x > heading.x + heading.width && Math.abs(heading.y + heading.height / 2 - actions.y - actions.height / 2) < 2, '标题与右侧按钮保持同一行居中');
  assert.equal(await panel.locator('.v2-ms-card h4 button').first().evaluate((element) => getComputedStyle(element).fontSize), '16px');
  assert.equal(await panel.locator('.v2-ms-history-button').evaluate((element) => getComputedStyle(element).borderTopWidth), '0px');
  assert.equal(await panel.locator('.v2-ms-date').first().evaluate((element) => getComputedStyle(element).height), '65px');
  assert.deepEqual(await panel.locator('.v2-ms-card').first().evaluate((element) => { const style = getComputedStyle(element); return [style.paddingTop, style.paddingRight, style.paddingBottom, style.borderRadius]; }), ['14px', '15px', '12px', '8px']);
  assert.ok((await page.locator('.v2-milestone-panel.is-empty').first().boundingBox()).height < 80);
  await panel.scrollIntoViewIfNeeded(); await screenshot('milestone-overview');

  // 换行折返为圆角且不穿过同日多目标；横向只滚动当前项目，保存失败保持原选择。
  assert.equal(await page.getByRole('button', { name: '换行时间轴', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.waitForFunction(() => document.querySelector('.v2-ms-route path')?.getAttribute('d')?.includes(' Q '));
  await verifyAxisViewport();
  assert.equal(await page.locator('dialog[open]').count(), 0);
  rejectPreference = true;
  await page.getByRole('button', { name: '横向时间轴', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '偏好已变化' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '换行时间轴', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '横向时间轴', exact: true }).click();
  await panel.locator('.is-horizontal').waitFor();
  await verifyAxisViewport();
  assert.equal(data.personalPreferences.milestoneMode, 'horizontal');
  assert.ok(await panel.locator('.v2-ms-scroll').evaluate((element) => element.scrollWidth > element.clientWidth));
  const scrollLeft = await panel.locator('.v2-ms-scroll').evaluate((element) => { element.scrollLeft = 160; return element.scrollLeft; });
  await panel.getByRole('button', { name: `查看详情：${planned.title}`, exact: true }).click(); await close();
  assert.equal(await panel.locator('.v2-ms-scroll').evaluate((element) => element.scrollLeft), scrollLeft);
  await page.reload(); await panel.locator('.is-horizontal').waitFor();
  await page.getByRole('button', { name: '换行时间轴', exact: true }).click();
  await panel.locator('.v2-ms-roadmap-wrap').waitFor();
  assert.equal(preferences.length, 2);

  // 未规划可用键盘展开，设置日期复用编辑器并正确定位焦点；取消没有写请求。
  await panel.locator('.v2-ms-toggle').focus(); await page.keyboard.press('Enter');
  await panel.getByRole('button', { name: '设置日期', exact: true }).click();
  assert.equal(await active.getByRole('heading', { name: '编辑阶段目标' }).count(), 0);
  await page.waitForFunction(() => document.activeElement?.matches('input[type=date]'), undefined, { timeout: 3000 });
  await active.getByLabel('目标名称').fill('尚未保存');
  await active.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认放弃', exact: true }).click();
  assert.equal(saved.length, 0);
  await panel.getByRole('button', { name: '设置日期', exact: true }).click();
  await active.locator('input[type=date]').fill('2026-11-06');
  await active.getByRole('button', { name: '保存', exact: true }).click();
  await active.getByRole('button', { name: '确认保存目标变更', exact: true }).click();
  await page.locator('dialog').waitFor({ state: 'hidden' });
  assert.equal(saved.length, 1); assert.equal(await panel.locator('.v2-ms-unplanned').count(), 0);

  await panel.getByRole('button', { name: `查看详情：${planned.title}`, exact: true }).click();
  assert.equal(await active.getByRole('button', { name: '确认完成', exact: true }).isDisabled(), true);
  assert.equal(await active.getByRole('button', { name: '解除关联', exact: true }).count(), 0);
  assert.equal(await active.locator('.v2-ms-detail > h3').evaluate((element) => getComputedStyle(element).fontSize), '21px');
  await screenshot('milestone-detail');
  await active.getByRole('button', { name: '编辑目标', exact: true }).click();
  assert.equal(await active.getByLabel('目标名称').evaluate((element) => getComputedStyle(element).fontSize), '16px');
  assert.equal(await active.locator('.v2-dialog-footer').evaluate((element) => getComputedStyle(element).justifyContent), 'flex-end');
  await active.getByRole('button', { name: `解除关联：${linked[0].title}`, exact: true }).click();
  assert.equal(saved.length, 1);
  await active.getByRole('button', { name: `恢复关联：${linked[0].title}`, exact: true }).click();
  assert.equal(await active.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
  await active.getByRole('button', { name: `解除关联：${linked[0].title}`, exact: true }).click();
  await active.getByLabel('目标名称').fill('审计分支融合与功能测试（调整）');
  await screenshot('milestone-edit');
  await active.getByRole('button', { name: '保存', exact: true }).click();
  await active.getByRole('button', { name: '← 返回', exact: true }).click();
  assert.equal(await active.getByLabel('目标名称').inputValue(), '审计分支融合与功能测试（调整）');
  await active.getByRole('button', { name: '保存', exact: true }).click();
  await active.getByRole('button', { name: '确认保存目标变更', exact: true }).click();
  await active.getByRole('button', { name: '编辑目标', exact: true }).waitFor();
  assert.equal(saved.length, 2); assert.equal(saved[1].unlinkTasks.length, 1); assert.equal(saved[1].confirmation, 'a'.repeat(64));
  await close();

  // 历史翻页返回原页；窄屏和浅色无全页横向溢出。
  await panel.getByRole('button', { name: /^历史 11/ }).click();
  await active.getByRole('button', { name: '下一页', exact: true }).click();
  await active.getByRole('button', { name: '历史目标 1', exact: true }).click();
  await active.getByRole('button', { name: '← 返回', exact: true }).click();
  assert.match(await active.innerText(), /第 2 \/ 2 页/); await close();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await panel.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    if (width === 390) await screenshot('milestone-mobile');
  }
  await page.emulateMedia({ colorScheme: 'light' }); await screenshot('milestone-light');

  // 周报进度表入口顺序、文字版入口及返回后筛选不丢失。
  await page.goto(base + '/weekly-plans');
  await page.getByRole('button', { name: '文字版', exact: true }).waitFor();
  assert.deepEqual(await page.locator('.w-heading button').allTextContents(), ['日期区间', '文字版', '里程碑']);
  await page.getByLabel('筛选项目').selectOption(project.id);
  const sourcePeriods = [await page.getByLabel('总结区间', { exact: true }).inputValue(), await page.getByLabel('计划区间', { exact: true }).inputValue()];
  await page.getByRole('button', { name: '里程碑', exact: true }).click();
  await page.getByRole('heading', { name: '里程碑总览', exact: true }).waitFor();
  await verifyAxisViewport();
  await page.getByRole('button', { name: '横向时间轴', exact: true }).click();
  await panel.locator('.is-horizontal').waitFor(); await verifyAxisViewport();
  await page.getByRole('button', { name: '换行时间轴', exact: true }).click();
  await panel.locator('.v2-ms-roadmap-wrap').waitFor(); await verifyAxisViewport();
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.match(page.url(), /view=milestones/);
  assert.equal(await panel.locator('.v2-ms-card h4 button').first().evaluate((element) => getComputedStyle(element).fontSize), '16px');
  assert.equal(await panel.locator('.v2-ms-project-title').first().evaluate((element) => getComputedStyle(element).fontSize), '19px');
  await screenshot('milestone-weekly'); await page.getByRole('button', { name: '← 返回周报与周计划', exact: true }).click();
  assert.equal(await page.getByLabel('筛选项目').inputValue(), project.id);
  assert.deepEqual([await page.getByLabel('总结区间', { exact: true }).inputValue(), await page.getByLabel('计划区间', { exact: true }).inputValue()], sourcePeriods);
  await page.getByRole('button', { name: '文字版', exact: true }).click();
  const sourceText = await active.locator('.v2-text-report > pre').textContent();
  await active.getByRole('button', { name: '里程碑总览', exact: true }).click();
  await page.getByRole('heading', { name: '里程碑总览', exact: true }).waitFor();
  assert.equal(await page.locator('dialog[open]').count(), 0);
  await page.getByRole('button', { name: '← 返回周报文字版', exact: true }).click();
  await active.getByRole('heading', { name: '文字版', exact: true }).waitFor();
  assert.equal(await active.locator('.v2-text-report > pre').textContent(), sourceText);
  assert.equal(await page.getByLabel('筛选项目').inputValue(), project.id);
  await active.getByRole('button', { name: '里程碑总览', exact: true }).click();
  await page.getByRole('heading', { name: '里程碑总览', exact: true }).waitFor();
  await page.goBack(); await active.getByRole('heading', { name: '文字版', exact: true }).waitFor();
  await close();

  // 单项目与总览共用模式；窄屏横向布局仍保留局部滚动，不撑开整页。
  await page.goto(`${base}/work?project=${project.id}&tab=milestones`);
  await page.getByRole('button', { name: '横向时间轴', exact: true }).click();
  await panel.locator('.is-horizontal').waitFor();
  await page.setViewportSize({ width: 390, height: 1000 });
  assert.ok(await panel.locator('.v2-ms-scroll').evaluate((element) => element.scrollWidth > element.clientWidth));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.goto(base + '/work?view=milestones');
  await panel.locator('.is-horizontal').waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS milestones: grouping, collapse, edit draft/undo/cancel/atomic submit, history, responsive, themes, weekly entry/state');
} finally { await browser.close(); }
