import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

test('database failure reports readiness 503 while liveness stays available, without credentials', { timeout: 15000 }, async () => {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  const child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '..', 'main.js')], {
    windowsHide: true, stdio: 'ignore',
    env: { ...process.env, API_PORT: String(port), DB_HOST: '127.0.0.1', DB_PORT: '1', DB_PASSWORD: 'secret-test-only', DB_USERNAME: 'test', DB_DATABASE: 'next_time_for_sure' },
  });
  try {
    let started = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      assert.equal(child.exitCode, null, 'API exited during startup');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/health/live`, { signal: AbortSignal.timeout(300) });
        if (response.ok) { started = true; break; }
      } catch { /* 启动阶段短暂拒绝连接。 */ }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.ok(started, 'API must start even when the database is unavailable');
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`, { signal: AbortSignal.timeout(6000) });
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.doesNotMatch(body, /secret-test-only|DB_PASSWORD|mysql:\/\//);
    assert.match(body, /数据库尚未就绪/);
  } finally {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  }
});
