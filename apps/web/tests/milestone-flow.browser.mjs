import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { sortingFixture } from './sorting-fixture.mjs';

// 真实组件与延迟内存 API；逐帧检查页面回闪，不接触真实业务数据。
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, colorScheme: 'dark' });
  const fixture = sortingFixture(), data = fixture.workspace, project = data.projects[0], errors = [], writes = [];
  const target = { id: randomUUID(), projectId: project.id, title: '阶段交付目标', expectedOn: data.today, status: 'open', needsReview: false, version: 0 };
  const history = { ...target, id: randomUUID(), title: '历史阶段目标', expectedOn: '2026-10-01' };
  data.milestones = [target, history];
  const task = data.tasks[0]; task.milestoneId = target.id; task.status = 'completed';
  page.on('pageerror', error => errors.push(error.message));
  let rejectWrite = false, stalePreviews = 0;
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON();
      if (path.endsWith('/impact')) {
        await new Promise(resolve => setTimeout(resolve, 700));
        const current = 'milestoneId' in command ? data.milestones.find(item => item.id === command.milestoneId) : 'taskId' in command ? data.tasks.find(item => item.id === command.taskId) : data.backlog.find(item => item.id === command.backlogId);
        if (!current || current.version !== command.version) {
          stalePreviews++;
          return route.fulfill({ status: 409, json: { message: '数据已被其他人修改，请保留草稿并刷新核对。' } });
        }
        return route.fulfill({ json: { title: target.title, details: ['保留任务、排期及历史记录。'], blockers: [], confirmation: 'a'.repeat(64) } });
      }
      if (rejectWrite) { rejectWrite = false; return route.fulfill({ status: 409, json: { message: '版本已变化，请重新核对' } }); }
      await new Promise(resolve => setTimeout(resolve, 450));
      writes.push(command);
      if (command.action === 'save_task') {
        const row = data.tasks.find(item => item.id === command.taskId); assert.ok(row);
        if (command.arrangements) data.arrangements = [...data.arrangements.filter(item => item.taskId !== row.id), ...command.arrangements.map((item, position) => ({ ...item, taskId: row.id, position, version: 0 }))];
        row.version++;
        return route.fulfill({ json: { objectIds: [row.id] } });
      }
      if (command.action === 'delete') {
        data.tasks = data.tasks.filter(item => item.id !== command.taskId);
        return route.fulfill({ json: { objectIds: [command.taskId] } });
      }
      if (command.action === 'delete_backlog') {
        data.backlog = data.backlog.filter(item => item.id !== command.backlogId);
        return route.fulfill({ json: { objectIds: [command.backlogId] } });
      }
      const row = data.milestones.find(item => item.id === command.milestoneId);
      assert.ok(row); assert.equal(command.version, row.version);
      if (command.action === 'edit_milestone') { row.title = command.title; row.expectedOn = command.expectedOn; }
      else if (command.action === 'complete_milestone') row.status = 'completed';
      else if (command.action === 'reopen_milestone') row.status = 'open';
      else if (command.action === 'delete_milestone') { data.milestones = data.milestones.filter(item => item !== row); for (const item of data.tasks) if (item.milestoneId === row.id) item.milestoneId = null; }
      else assert.fail(`Unexpected action ${command.action}`);
      row.version++;
      return route.fulfill({ json: { objectIds: [row.id] } });
    }
    if (writes.length) await new Promise(resolve => setTimeout(resolve, path.endsWith('/workspace') ? 350 : 900));
    const result = path.endsWith('/auth/me') ? fixture.identity : path.endsWith('/workspace') ? data : path.endsWith('/weekly') ? fixture.weekly : path.endsWith('/summary') ? fixture.summary : null;
    return route.fulfill({ status: result ? 200 : 404, json: result ?? { message: 'Unmocked endpoint' } });
  });
  const active = page.locator('dialog[open] > [data-active="true"]');
  const button = name => active.getByRole('button', { name, exact: true });
  const closed = () => page.locator('dialog[open]').waitFor({ state: 'hidden' });

  /** 从点击前开始记录；目标出现后不得再露出上一页、其他弹窗或改变 URL。 */
  async function transition(trigger, title, width) {
    const url = page.url();
    await page.evaluate(() => {
      window.modalFrames = [];
      const sample = () => {
        const dialogs = [...document.querySelectorAll('dialog[open]')];
        window.modalFrames.push({ url: location.href, pages: dialogs.map(dialog => {
          const active = dialog.querySelector(':scope > [data-active="true"]');
          return { title: active?.querySelector('h2')?.textContent, width: dialog.getBoundingClientRect().width, hiddenVisible: [...dialog.querySelectorAll(':scope > [hidden]')].some(el => el.getClientRects().length > 0) };
        }) });
        window.modalFrameId = requestAnimationFrame(sample);
      };
      window.modalFrameId = requestAnimationFrame(sample);
    });
    await trigger();
    await active.getByRole('heading', { name: title, exact: true }).waitFor();
    await page.waitForTimeout(300);
    const frames = await page.evaluate(() => { cancelAnimationFrame(window.modalFrameId); return window.modalFrames; });
    const first = frames.findIndex(frame => frame.pages.some(item => item.title === title));
    assert.ok(first >= 0, `没有记录目标页：${title}`);
    for (const frame of frames.slice(first)) {
      assert.equal(frame.url, url, '弹窗切换不得跳转业务页面');
      assert.equal(frame.pages.length, 1, '只能有一个可见弹窗');
      assert.equal(frame.pages[0].title, title, '目标页出现后不能回闪其他页面');
      assert.equal(frame.pages[0].hiddenVisible, false, '返回栈页面不能透出');
      if (width) assert.equal(Math.round(frame.pages[0].width), width, '首帧就应使用目标宽度');
    }
  }
  const detailTitle = `${project.name} / 里程碑`, editTitle = `${project.name} / 编辑目标`;
  const open = () => transition(() => page.getByRole('button', { name: `查看详情：${target.title}`, exact: true }).click(), detailTitle, 650);
  await page.goto(base + '/work?view=milestones');
  await open();
  await transition(() => button(task.title).click(), '编辑任务', 960);
  await transition(() => button('← 返回').click(), detailTitle, 650);
  await transition(() => button('编辑目标').click(), editTitle, 650);
  await active.getByLabel('目标名称').fill('更新名称后关闭整个流程');
  await button('保存').click(); await closed();
  assert.equal(writes.length, 1);

  await open(); await button('编辑目标').click();
  await active.getByLabel('截止日期').fill('2026-10-23');
  await transition(() => button('保存').click(), '保存目标变更', 680);
  await button('取消').click();
  assert.equal(await active.getByLabel('截止日期').inputValue(), '2026-10-23');
  await button('保存').click();
  await button('确认保存目标变更').click(); await closed();

  for (const label of ['确认完成', '重开里程碑']) {
    await open();
    await transition(() => button(label).click(), label, 680);
    if (label === '确认完成') {
      rejectWrite = true;
      await button(label).click(); await active.getByRole('alert').waitFor();
      assert.equal(await active.getByRole('heading', { name: label, exact: true }).count(), 1);
      await button('重新核对影响').click();
    }
    await button(label.startsWith('确认') ? label : `确认${label}`).click(); await closed();
  }

  // 历史列表也属于同一流程；保存后不能留下历史或详情弹窗。
  await page.getByRole('button', { name: /^历史 1/ }).click();
  await button(history.title).click(); await button('编辑目标').click();
  await active.getByLabel('目标名称').fill('历史目标已修改');
  await button('保存').click(); await closed();

  await open(); await button('编辑目标').click();
  await active.getByLabel('目标名称').fill('取消删除保留的草稿');
  await button('删除里程碑').click(); await button('取消').click();
  assert.equal(await active.getByLabel('目标名称').inputValue(), '取消删除保留的草稿');
  await button('删除里程碑').click(); await button('确认删除里程碑').click(); await closed();
  assert.equal(await page.getByRole('button', { name: `查看详情：${target.title}`, exact: true }).count(), 0);
  assert.equal(task.milestoneId, null);

  // 同一慢网条件下回归任务排期确认、删除任务、删除待建，防止只修里程碑。
  await page.goto(`${base}/work?project=${project.id}`);
  await page.getByLabel('任务状态范围').selectOption('done');
  await page.getByRole('button', { name: task.title, exact: true }).click();
  await button('取消第2条周期安排').click();
  await transition(() => button('保存').click(), '确认保存修改', 680);
  await button('确认保存修改').click(); await closed();
  await page.getByRole('button', { name: task.title, exact: true }).click();
  await transition(() => button('删除任务').click(), '删除任务', 680);
  await button('确认删除任务').click(); await closed();
  await page.goto(base + '/work');
  const backlog = data.backlog[0];
  await page.getByRole('button', { name: backlog.title, exact: true }).click();
  await transition(() => button('删除待建任务').click(), '删除待建任务', 680);
  await button('确认删除待建任务').click(); await closed();
  assert.equal(stalePreviews, 0, '成功提交后不得拿旧版本重新核对并闪出伪冲突页面');

  // 无管理权限时两个维护入口均不展示；窄屏仍只显示目标详情。
  project.canManage = false; project.canConfirmMilestone = false;
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(base + '/work?view=milestones');
  await page.getByRole('button', { name: /^历史 1/ }).click();
  await button(history.title).click();
  assert.equal(await button('删除里程碑').count(), 0); assert.equal(await button('编辑目标').count(), 0);
  assert.equal(await button('确认完成').isDisabled(), true);
  const bounds = await page.locator('dialog[open]').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert.deepEqual(errors, []);
  console.log('PASS slow modal flow: milestone edit/complete/reopen/delete close all, task arrangements/delete, backlog delete, no stale preview after success, cancellation/failure preserved, frame transitions, mobile');
} finally { await browser?.close(); await server.close(); }
