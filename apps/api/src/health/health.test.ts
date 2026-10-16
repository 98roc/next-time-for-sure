import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

test('database failure reports readiness 503 while liveness stays available, without credentials', { timeout: 30000 }, async () => {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  const child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '..', 'main.js')], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, API_HOST: '127.0.0.1', API_PORT: String(port), DB_HOST: '127.0.0.1', DB_PORT: '1', DB_PASSWORD: 'secret-test-only', DB_USERNAME: 'test', DB_DATABASE: 'next_time_for_sure' },
  });
  // 只记录启动阶段标志，不输出可能含数据库信息的进程日志。
  let applicationStarted = false;
  let startupFailed = false;
  child.stdout.on('data', (chunk: Buffer) => { applicationStarted ||= chunk.toString().includes('Nest application successfully started'); });
  child.stderr.on('data', (chunk: Buffer) => { startupFailed ||= chunk.toString().includes('API startup failed'); });
  let lastProbe = 'not_attempted';
  try {
    let started = false;
    // Windows 并发加载完整 Nest 模块实测可超过 6 秒；此测试验证数据库故障隔离，不作为启动性能门槛。
    const startupDeadline = Date.now() + 20000;
    while (Date.now() < startupDeadline) {
      assert.equal(child.exitCode, null, 'API exited during startup');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/health/live`, { signal: AbortSignal.timeout(300) });
        lastProbe = `HTTP_${response.status}`;
        if (response.ok) { started = true; break; }
      } catch (error) { lastProbe = error instanceof Error ? error.name : 'unknown'; }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.ok(started, `API must start even when the database is unavailable (applicationStarted=${applicationStarted}, startupFailed=${startupFailed}, lastProbe=${lastProbe})`);
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`, { signal: AbortSignal.timeout(6000) });
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.doesNotMatch(body, /secret-test-only|DB_PASSWORD|mysql:\/\//);
    assert.match(body, /数据库尚未就绪/);
  } finally {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  }
});
