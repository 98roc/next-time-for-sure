import assert from 'node:assert/strict';
import { app, BrowserWindow, session } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';
import { siteStorage } from '../dist/config.js';

let stage = 'input';
/** 真正 Electron 进程运行现有主入口；隔离用户目录与会话，凭据仅从父进程环境读取后删除。 */
async function main() {
  const fixture = JSON.parse(process.env.NTFS_RUNTIME_FIXTURE);
  delete process.env.NTFS_RUNTIME_FIXTURE;
  stage = 'configuration';
  app.setPath('userData', fixture.directory);
  process.env.DESKTOP_WEB_URL = fixture.url; process.env.DESKTOP_UPDATE_URL = '';
  await app.whenReady();
  stage = 'cookies';
  const business = session.fromPartition(siteStorage(fixture.url).partition);
  await business.cookies.set({ url: fixture.url, name: 'ntfs_session', value: fixture.token, httpOnly: true, sameSite: 'lax' });
  app.on('browser-window-created', (_event, window) => window.hide());
  await import('../dist/main.js');
  stage = 'main-window';
  let window;
  for (let attempt = 0; attempt < 100; attempt++) {
    window = BrowserWindow.getAllWindows()[0];
    if (window?.webContents.getURL().startsWith(fixture.url) && !window.webContents.isLoading()) break;
    await delay(200);
  }
  assert.ok(window);
  stage = 'security';
  const preferences = window.webContents.getLastWebPreferences();
  assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.sandbox, true);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await window.webContents.executeJavaScript('document.body.innerText.includes("我的工作")')) break;
    await delay(200);
  }
  assert.equal(await window.webContents.executeJavaScript('document.body.innerText.includes("我的工作")'), true);
  assert.equal(await window.webContents.executeJavaScript('typeof require'), 'undefined');
  stage = 'renderer-write';
  const result = await window.webContents.executeJavaScript(`(async () => {
    const request = async (path, body) => {
      const response = await fetch('/api/v1/' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': ${JSON.stringify(fixture.csrf)} }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!response.ok) throw new Error('HTTP_' + response.status);
      return response.json();
    };
    const workspace = await request('v2/workspace');
    const task = workspace.tasks.find(row => row.title === 'Electron 隔离验收');
    if (!task) throw new Error('TASK_MISSING');
    await request('v2/tasks', { action: 'set_status', operationId: crypto.randomUUID(), taskId: task.id, version: task.version, status: 'in_progress' });
    const updated = await request('v2/workspace');
    return { status: updated.tasks.find(row => row.id === task.id).status, taskId: task.id };
  })()`);
  assert.equal(result.status, 'in_progress');
  stage = 'lifecycle';
  const isolated = session.fromPartition(`persist:other-${Date.now()}`);
  assert.equal((await isolated.cookies.get({ name: 'ntfs_session' })).length, 0);
  window.close(); await delay(100); assert.equal(window.isDestroyed(), false); assert.equal(window.isVisible(), false);
  console.log('ELECTRON_RUNTIME_PASS');
  app.quit();
}

void main().catch(error => { console.error(`ELECTRON_RUNTIME_FAILED stage=${stage} type=${error.name}`); app.exit(1); });
