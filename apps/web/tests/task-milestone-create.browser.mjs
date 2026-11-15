import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { sortingFixture } from './sorting-fixture.mjs';

// 真实表单与内存 API，分别观察目标创建、任务保存和工作区回读。
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const { workspace, identity, weekly, summary } = sortingFixture();
  const [project, otherProject, ordinaryProject] = workspace.projects;
  ordinaryProject.canManage = false;
  ordinaryProject.members[0].roles = ['developer'];
  const original = { id: randomUUID(), projectId: project.id, title: '原目标', expectedOn: workspace.today, status: 'open', needsReview: false, version: 0 };
  workspace.milestones = [original];
  const editedTask = workspace.tasks[0];
  editedTask.milestoneId = original.id;
  workspace.categories = [{ id: randomUUID(), ownerId: identity.id, name: '任务池', status: 'not_started', isDefault: true, position: 0, version: 0 }];

  const commands = [], errors = [];
  let refreshUnavailable = false, removedBeforeBatchSave = null;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, colorScheme: 'dark' });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON();
      commands.push(command);
      if (command.action === 'create_milestone') {
        const { title, projectId, expectedOn } = command;
        const id = randomUUID();
        workspace.milestones.push({ id, title, projectId, expectedOn, status: 'open', needsReview: false, version: 0 });
        refreshUnavailable = title === '独立保存的目标';
        return route.fulfill({ json: { objectIds: [id] } });
      }
      if (command.action === 'unlink_milestone') {
        return route.fulfill({ json: { title: editedTask.title, details: ['解除原目标关联。'], blockers: [], confirmation: 'a'.repeat(64) } });
      }
      if (command.action === 'create_batch' && removedBeforeBatchSave) {
        workspace.milestones = workspace.milestones.filter((row) => row.id !== removedBeforeBatchSave);
        removedBeforeBatchSave = null;
        return route.fulfill({ status: 409, json: { message: '里程碑不存在。' } });
      }
      if (command.action === 'save_task') {
        editedTask.milestoneId = command.details.milestoneId;
        editedTask.version++;
      }
      return route.fulfill({ json: { objectIds: [editedTask.id] } });
    }
    if (path.endsWith('/workspace') && refreshUnavailable) {
      return route.fulfill({ status: 503, json: { message: '暂时无法刷新工作区。' } });
    }
    const data = path.endsWith('/auth/me') ? identity : path.endsWith('/workspace') ? workspace : path.endsWith('/weekly') ? weekly : path.endsWith('/summary') ? summary : null;
    return route.fulfill({ status: data ? 200 : 404, json: data ?? { message: '未配置测试接口' } });
  });

  const dialog = page.locator('dialog[open].v2-dialog');
  const active = dialog.locator(':scope > [data-active="true"]');
  const button = (name) => active.getByRole('button', { name, exact: true });
  const select = (scope = active) => scope.getByLabel('关联里程碑', { exact: true });
  const quick = (scope = active) => scope.getByRole('button', { name: '＋ 新建里程碑', exact: true });
  const source = active.getByLabel('任务来源', { exact: true });
  const rows = active.locator('.v2-record');
  const title = (scope = active) => scope.getByLabel('任务名称', { exact: true });

  async function checkSecondaryStyle(scope = active) {
    const appearance = (locator) => locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.backgroundColor, style.color, style.borderTopColor, style.borderTopWidth, style.borderRadius, style.fontFamily];
    });
    assert.deepEqual(await appearance(quick(scope)), await appearance(button('关闭').last()));
  }

  async function create(scope, name) {
    await quick(scope).click();
    await active.getByRole('heading', { name: /新建里程碑$/u }).waitFor();
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await active.getByLabel('目标名称').fill(name);
    await button('保存并选中').click();
    await scope.getByText('里程碑已创建，保存任务后生效。', { exact: true }).waitFor();
    return workspace.milestones.find((row) => row.title === name).id;
  }

  // 尚未填写任务必填值也能建目标，刷新失败仍能选中，放弃任务后目标在原项目可用。
  await page.goto(base + '/personal');
  await page.getByRole('button', { name: '＋ 新建任务', exact: true }).click();
  assert.equal(await quick().count(), 0);
  await source.selectOption(ordinaryProject.id);
  assert.equal(await quick().count(), 0);
  await source.selectOption(project.id);
  await select().selectOption(original.id);
  await quick().click();
  await active.getByLabel('目标名称').fill('放弃的目标草稿');
  await button('取消').click();
  await page.getByRole('button', { name: '确认放弃', exact: true }).click();
  assert.equal(await select().inputValue(), original.id);
  const keptId = await create(active, '独立保存的目标');
  assert.equal(await select().inputValue(), keptId);
  assert.deepEqual(commands.map((command) => command.action), ['create_milestone']);
  refreshUnavailable = false;
  await button('重试刷新').click();
  await button('重试刷新').waitFor({ state: 'hidden' });
  await source.selectOption(otherProject.id);
  assert.equal(await select().inputValue(), '');
  assert.equal(await select().locator(`option[value="${keptId}"]`).count(), 0);
  await button('关闭').last().click();
  await page.getByRole('button', { name: '确认放弃', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });

  // 批量新建只更新发起行，其他行可手动选用，也能定位保存时失效的选项。
  await page.goto(`${base}/work?project=${project.id}`);
  await page.getByRole('button', { name: '＋ 批量新增', exact: true }).click();
  await checkSecondaryStyle(rows.first());
  await button('＋ 添加一行').click();
  await title(rows.nth(0)).fill('第一条任务');
  await title(rows.nth(1)).fill('第二条任务');
  await select(rows.nth(0)).selectOption(keptId);
  const batchId = await create(rows.nth(1), '批量行新目标');
  assert.equal(await select(rows.nth(1)).inputValue(), batchId);
  assert.equal(await select(rows.nth(0)).inputValue(), keptId);
  assert.equal(await select(rows.nth(0)).locator(`option[value="${batchId}"]`).count(), 1);
  assert.equal(await quick(rows.nth(1)).evaluate((element) => element === document.activeElement), true);
  await button('＋ 添加一行').click();
  assert.equal(await select(rows.nth(2)).inputValue(), '');
  await select(rows.nth(2)).selectOption(batchId);
  assert.equal(await select(rows.nth(2)).inputValue(), batchId);
  const removedRowMilestone = await create(rows.nth(2), '移除任务行后保留的目标');
  await rows.nth(2).getByRole('button', { name: '移除此行' }).click();
  assert.equal(await select(rows.nth(0)).locator(`option[value="${removedRowMilestone}"]`).count(), 1);
  for (const row of await rows.all()) await row.getByLabel('本周期预计投入（人天）1').fill('1');
  removedBeforeBatchSave = batchId;
  await button('保存').click();
  await rows.nth(1).getByText('选中的里程碑已不可关联，请重新选择或取消关联。').waitFor();
  assert.equal(await title(rows.nth(0)).inputValue(), '第一条任务');
  assert.equal(await title(rows.nth(1)).inputValue(), '第二条任务');
  await select(rows.nth(1)).selectOption(keptId);
  await button('保存').click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(commands.at(-1).tasks.map((row) => row.milestoneId), [keptId, keptId]);

  // 编辑替换仍先确认解除旧关联，窄屏下快捷入口可操作。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: editedTask.title, exact: true }).click();
  await page.mouse.move(0, 0);
  await checkSecondaryStyle();
  const [selectBounds, buttonBounds] = await Promise.all([select().boundingBox(), quick().boundingBox()]);
  assert.ok(selectBounds && buttonBounds && selectBounds.x + selectBounds.width <= buttonBounds.x && buttonBounds.x + buttonBounds.width <= 390);
  const editId = await create(active, '替换后的目标');
  assert.equal(editedTask.milestoneId, original.id);
  await button('保存').click();
  await button('确认保存修改').click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(editedTask.milestoneId, editId);
  assert.equal(commands.at(-1).milestoneConfirmation, 'a'.repeat(64));
  assert.deepEqual(errors, []);
  console.log('PASS task milestone creation: single, batch row, edit confirmation, permission, discard, refresh failure, stale selection and mobile');
} finally {
  await browser?.close();
  await server.close();
}
