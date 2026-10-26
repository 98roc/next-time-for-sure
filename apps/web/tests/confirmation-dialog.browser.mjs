import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { sortingFixture } from './sorting-fixture.mjs';

// 使用正式界面和内存 API，验证模态焦点及草稿保护，不写入真实业务数据。
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const evidence = fileURLToPath(new URL('../../../.cache/confirmation-dialog-evidence/', import.meta.url));
let browser;
try {
  await mkdir(evidence, { recursive: true });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, colorScheme: 'dark' });
  const fixture = sortingFixture(), errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') {
      if (path.endsWith('/impact')) return route.fulfill({ json: { title: '删除任务', details: ['删除当前任务'], blockers: [], confirmation: 'a'.repeat(64) } });
      writes.push(path);
      return route.fulfill({ json: { objectIds: [] } });
    }
    const data = path.endsWith('/auth/me') ? fixture.identity : path.endsWith('/workspace') ? fixture.workspace : path.endsWith('/weekly') ? fixture.weekly : path.endsWith('/summary') ? fixture.summary : null;
    return route.fulfill({ status: data ? 200 : 404, json: data ?? { message: 'Unmocked read' } });
  });
  const base = `http://127.0.0.1:${address.port}`;
  const active = page.locator('dialog [data-active="true"]'), confirm = page.getByRole('alertdialog');
  await page.goto(base + '/work');
  await page.getByRole('link', { name: '周报与周计划', exact: true }).click();
  await page.getByRole('button', { name: '文字版', exact: true }).click();
  await active.getByRole('button', { name: '编辑', exact: true }).click();
  await active.getByLabel('编辑文字').fill('必须保留的草稿');
  const close = active.getByRole('button', { name: '关闭', exact: true }).last();
  await close.click();
  await confirm.waitFor();
  assert.equal(await confirm.evaluate(el => el.matches(':modal')), true);
  assert.equal(await confirm.getByRole('button', { name: '取消', exact: true }).evaluate(el => el === document.activeElement), true);
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await confirm.evaluate(el => el.contains(document.activeElement)), true, '焦点不能进入底层表单');
  }
  await page.mouse.click(5, 5);
  assert.equal(await confirm.count(), 1, '遮罩不关闭确认');
  await page.screenshot({ path: evidence + '/unsaved-dark.png' });
  await page.keyboard.press('Escape');
  await confirm.waitFor({ state: 'hidden' });
  assert.equal(await close.evaluate(el => el === document.activeElement), true);
  assert.equal(await active.getByLabel('编辑文字').inputValue(), '必须保留的草稿');
  await close.click();
  await confirm.getByRole('button', { name: '关闭', exact: true }).click();
  await active.getByRole('button', { name: '取消编辑', exact: true }).click();
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await active.getByLabel('编辑文字').inputValue(), '必须保留的草稿');
  await active.getByRole('button', { name: '取消编辑', exact: true }).click();
  await confirm.getByRole('button', { name: '确认放弃', exact: true }).click();
  await active.getByRole('button', { name: '编辑', exact: true }).waitFor();

  // 浏览器历史离开在已有表单上方可见，取消保留路由和草稿。
  await active.getByRole('button', { name: '编辑', exact: true }).click();
  await active.getByLabel('编辑文字').fill('离开保护草稿');
  await page.evaluate(() => history.back());
  await confirm.getByRole('heading', { name: '离开当前页面' }).waitFor();
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  assert.ok(page.url().endsWith('/weekly-plans'));
  assert.equal(await active.getByLabel('编辑文字').inputValue(), '离开保护草稿');
  await page.evaluate(() => history.back());
  await confirm.getByRole('button', { name: '确认离开', exact: true }).click();
  await page.waitForURL('**/work');
  assert.equal(await page.locator('dialog[open]').count(), 0, '离开后必须清理旧页面的弹窗');

  // 业务确认取消回到原表单，之后关闭仍须确认未保存草稿。
  await page.getByRole('button', { name: fixture.workspace.tasks[0].title, exact: true }).first().click();
  await active.getByLabel('任务名称', { exact: true }).fill('未提交的新名称');
  await active.getByRole('button', { name: '删除任务', exact: true }).click();
  await active.getByRole('button', { name: '确认删除任务', exact: true }).waitFor();
  await active.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await active.getByLabel('任务名称', { exact: true }).inputValue(), '未提交的新名称');
  await active.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 720 });
  await confirm.waitFor();
  const box = await confirm.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 720);
  await page.screenshot({ path: evidence + '/unsaved-light-mobile.png' });
  await confirm.getByRole('button', { name: '确认放弃', exact: true }).click();
  await page.locator('dialog[open]').waitFor({ state: 'hidden' });
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  console.log('PASS: 草稿保留、取消/关闭/Escape、焦点限制、遮罩、路由离开、业务确认取消、深浅色/窄屏');
} finally {
  await browser?.close();
  await server.close();
}
