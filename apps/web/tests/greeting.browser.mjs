import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sortingFixture } from './sorting-fixture.mjs';

// 真实浏览器验证界面与计时行为；接口夹具与真实 HTTP/MySQL 回归分开记录。
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Los_Angeles' });
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5174';
const evidence = fileURLToPath(new URL('../../../.cache/greeting-evidence/', import.meta.url));
await mkdir(evidence, { recursive: true });
const fixture = sortingFixture(), errors = [];
fixture.workspace.teamMessages = ['今天一定，别让产品名赢了。', '一步一步，把事情做好。'];
let rejectSave = false, reads = 0;
page.on('pageerror', (error) => errors.push(error.message));
await page.addInitScript(() => { Math.random = () => 0.1; });
await page.clock.install({ time: new Date('2026-10-19T09:29:50+08:00') });
await page.route('**/api/v1/**', async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (route.request().method() === 'POST') {
    const command = route.request().postDataJSON();
    assert.equal(path, '/api/v1/v2/team'); assert.equal(command.action, 'set_messages');
    if (rejectSave) { rejectSave = false; return route.fulfill({ status: 409, json: { message: '配置已被修改，请刷新后核对。' } }); }
    fixture.workspace.teamMessages = command.messages.map((text) => text.trim()).filter(Boolean); fixture.workspace.teamVersion++;
    return route.fulfill({ json: { objectIds: [fixture.workspace.team.id] } });
  }
  if (path.endsWith('/workspace')) reads++;
  const data = path.endsWith('/auth/me') ? fixture.identity : path.endsWith('/workspace') ? fixture.workspace : path.endsWith('/summary') ? fixture.summary : null;
  return route.fulfill({ status: data ? 200 : 404, json: data ?? { message: 'Unmocked endpoint' } });
});
const phrase = page.locator('#mw-team-phrase');
const heading = page.locator('.mw-heading h1');
async function pollWorkspace() {
  const response = page.waitForResponse((response) => response.url().endsWith('/workspace'));
  await page.clock.runFor(11000); await response;
}
async function openMessages() {
  await page.getByRole('link', { name: '团队管理' }).click();
  await page.getByRole('button', { name: '首页标语', exact: true }).click();
}
try {
  await page.goto(base + '/personal');
  await heading.waitFor();
  assert.equal(await phrase.textContent(), fixture.workspace.teamMessages[0]);
  assert.match(await heading.textContent(), /^早上好，/);
  await page.evaluate(() => { Math.random = () => 0.9; });
  await page.getByRole('textbox', { name: '搜索任务' }).fill('测试搜索');
  const beforeReads = reads;
  await pollWorkspace();
  assert.ok(reads > beforeReads); assert.match(await heading.textContent(), /^上午好，/);
  assert.equal(await phrase.textContent(), fixture.workspace.teamMessages[0], '搜索及轮询不重新抽取');
  await page.getByRole('link', { name: '项目', exact: true }).click();
  await page.getByRole('link', { name: '我的工作', exact: true }).click();
  assert.equal(await phrase.textContent(), fixture.workspace.teamMessages[1], '再次进入重新抽取');
  await page.reload(); await heading.waitFor();
  assert.equal(await phrase.textContent(), fixture.workspace.teamMessages[0], '刷新重新抽取');
  await page.screenshot({ path: evidence + '/personal.png' });
  fixture.workspace.teamMessages.splice(0, 1);
  await pollWorkspace();
  await page.waitForFunction(() => document.querySelector('#mw-team-phrase')?.textContent === '一步一步，把事情做好。');
  fixture.workspace.teamMessages = [];
  await pollWorkspace(); await phrase.waitFor({ state: 'detached' });

  await openMessages();
  await page.getByRole('button', { name: '新增标语' }).click();
  await page.getByLabel('标语 1', { exact: true }).fill('先做好一件事。');
  await page.getByRole('button', { name: '新增标语' }).click();
  await page.getByLabel('标语 2', { exact: true }).fill('每一点进展都算数。');
  await page.getByRole('button', { name: '新增标语' }).click();
  await page.getByRole('button', { name: '删除标语 3', exact: true }).click();
  await page.screenshot({ path: evidence + '/messages-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: evidence + '/messages-mobile.png' });
  assert.equal(await page.locator('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
  rejectSave = true;
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '配置已被修改' }).waitFor();
  assert.equal(await page.getByLabel('标语 2', { exact: true }).inputValue(), '每一点进展都算数。');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('dialog').waitFor({ state: 'detached' });
  assert.deepEqual(fixture.workspace.teamMessages, ['先做好一件事。', '每一点进展都算数。']);
  await page.getByRole('button', { name: '首页标语', exact: true }).click();
  await page.getByLabel('标语 1', { exact: true }).fill('修改后保留。');
  await page.getByRole('button', { name: '删除标语 2', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('dialog').waitFor({ state: 'detached' });
  await page.getByRole('link', { name: '我的工作', exact: true }).click();
  assert.equal(await phrase.textContent(), '修改后保留。');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.setSystemTime(new Date('2026-10-19T21:59:59+08:00'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  assert.match(await heading.textContent(), /^晚上好，/);
  await page.clock.runFor(1000);
  assert.match(await heading.textContent(), /^夜深了，/);
  fixture.workspace.teamLeader = false;
  await page.reload(); await heading.waitFor();
  assert.equal(await page.getByRole('link', { name: '团队管理' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('Greeting/browser passed: Shanghai boundaries, random on entry/reload, stable across polling/search, deletion/empty, multi-message CRUD, conflict draft, member visibility, desktop/mobile.');
} catch (error) {
  await page.screenshot({ path: evidence + '/failure.png' });
  console.error(await page.locator('dialog').innerText().catch(() => 'No dialog'));
  throw error;
} finally { await browser.close(); }
