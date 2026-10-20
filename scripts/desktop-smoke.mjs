import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { withFixture } from '../apps/api/dist/testing/fixture.js';
import { stopChild } from './processes.mjs';

const root = resolve('.'), requireWeb = createRequire(join(root, 'apps/web/package.json'));
const { createServer } = await import(pathToFileURL(requireWeb.resolve('vite')).href);

/** 仅清理本次创建且仍在项目缓存中的 Electron 用户目录。 */
async function cleanup(directory) {
  const actual = await realpath(directory), within = relative(await realpath(join(root, '.cache')), actual);
  if (!within.startsWith('electron-rehearsal-') || within.includes('..')) throw new Error('CLEANUP_PATH_REJECTED');
  await rm(actual, { recursive: true, maxRetries: 10, retryDelay: 500 });
}
await withFixture(async (fixture) => {
  const initial = await (await fixture.call('v2/workspace', fixture.leader)).json();
  const response = await fixture.call('v2/tasks', fixture.leader, { action: 'create_project', operationId: randomUUID(), task: { projectId: fixture.projectId, executorId: fixture.developer.id, periodId: initial.periods[0].id, title: 'Electron 隔离验收', priority: 3, milestoneId: null, plannedDays: null } });
  assert.equal(response.status, 200);
  const server = await createServer({ root: join(root, 'apps/web'), configFile: join(root, 'apps/web/vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, proxy: { '/api': { target: fixture.base, changeOrigin: false } } }, logLevel: 'error' });
  const directory = await mkdtemp(join(root, '.cache', 'electron-rehearsal-'));
  let child;
  try {
    await server.listen();
    const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}`;
    const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
    environment.NTFS_RUNTIME_FIXTURE = JSON.stringify({ directory, url, token: fixture.developer.cookie.split('=')[1], csrf: fixture.developer.csrf, leaderCookie: fixture.leader.cookie, leaderCsrf: fixture.leader.csrf, projectId: fixture.projectId, executorId: fixture.developer.id, periodId: initial.periods.find(row => row.startOn <= initial.today && row.endOn >= initial.today).id });
    child = spawn(join(root, 'apps/desktop/node_modules/electron/dist/electron.exe'), [join(root, 'apps/desktop/scripts/runtime-smoke.mjs')], { env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let passed = false;
    child.stdout.on('data', chunk => { passed ||= chunk.toString().includes('ELECTRON_RUNTIME_PASS'); });
    child.stderr.on('data', chunk => { const diagnostic = chunk.toString().match(/ELECTRON_RUNTIME_FAILED stage=[a-z-]+ type=[A-Za-z]+/); if (diagnostic) console.error(diagnostic[0]); });
    child.stdin.end();
    const timer = setTimeout(() => { void stopChild(child); }, 60000);
    try { const [code] = await once(child, 'exit'); assert.equal(code, 0); assert.equal(passed, true); } finally { clearTimeout(timer); }
    const updated = await (await fixture.call('v2/workspace', fixture.leader)).json();
    assert.equal(updated.tasks.find(row => row.title === 'Electron 隔离验收')?.status, 'in_progress');
    console.log('PASS: real Electron renderer, authenticated V2 write/API readback, sandbox, site cookies, close-to-tray, native notification show/click and offline no-replay.');
  } finally {
    if (child) await stopChild(child);
    await server.close();
    await cleanup(directory);
  }
});
