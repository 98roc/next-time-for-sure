import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { identitySchema } from '@ntfs/contracts';
import { loadEnvironment } from '../config/environment.js';
import { createDataSource } from '../database/data-source.js';
import { hashPassword } from './password.js';

/** 独立库真实会话回归；只创建并清理本次随机测试账号及其审计、会话。 */
async function smoke(): Promise<void> {
  const source = createDataSource(loadEnvironment());
  await source.initialize();
  const id = randomUUID();
  const loginName = `test.${randomBytes(8).toString('hex')}`;
  const initial = randomBytes(24).toString('hex');
  const replacement = randomBytes(24).toString('hex');
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [fileURLToPath(new URL('../main.js', import.meta.url))], { env: { ...process.env, API_PORT: String(port) }, windowsHide: true, stdio: 'ignore' });

  /** 所有HTTP调用模拟同源JSON请求，凭据只存测试进程内存。 */
  async function call(path: string, body?: unknown, cookie = '', csrf = '', origin = base) {
    return fetch(`${base}/api/v1/auth/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
    });
  }

  async function signIn(password: string) {
    const response = await call('login', { loginName, password });
    assert.equal(response.status, 200);
    const rawCookie = response.headers.get('set-cookie');
    assert.ok(rawCookie);
    assert.ok(rawCookie.includes('HttpOnly') && rawCookie.includes('SameSite=Strict'));
    const cookie = rawCookie.split(';')[0];
    assert.ok(cookie);
    return { cookie, identity: identitySchema.parse(await response.json()) };
  }

  try {
    await source.query('INSERT INTO accounts (id, login_name, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))', [id, loginName, '临时身份回归账号', await hashPassword(initial)]);
    let available = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { if ((await fetch(`${base}/api/v1/health/live`)).ok) { available = true; break; } } catch { /* 等待启动。 */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(available);
    assert.equal((await call('me')).status, 401);
    assert.equal((await call('login', { loginName, password: initial }, '', '', 'https://external.invalid')).status, 403);
    assert.equal((await call('login', { loginName, password: 'wrong' })).status, 401);
    const first = await signIn(initial);
    const second = await signIn(initial);
    assert.equal(first.identity.mustChangePassword, true);
    assert.equal((await call('me', undefined, first.cookie)).status, 200);
    assert.equal((await call('password', { currentPassword: initial, newPassword: replacement }, first.cookie, 'wrong')).status, 403);
    assert.equal((await call('password', { currentPassword: 'wrong', newPassword: replacement }, first.cookie, first.identity.csrfToken)).status, 403);
    assert.equal((await call('password', { currentPassword: initial, newPassword: replacement }, first.cookie, first.identity.csrfToken)).status, 204);
    assert.equal((await call('me', undefined, first.cookie)).status, 401);
    assert.equal((await call('me', undefined, second.cookie)).status, 401);
    assert.equal((await call('login', { loginName, password: initial })).status, 401);
    const third = await signIn(replacement);
    assert.equal(third.identity.mustChangePassword, false);

    // 验证每次读取当前账号状态，而非信任登录时的快照。
    await source.query('UPDATE accounts SET disabled = 1 WHERE id = ?', [id]);
    assert.equal((await call('me', undefined, third.cookie)).status, 401);
    await source.query('UPDATE accounts SET disabled = 0 WHERE id = ?', [id]);
    assert.equal((await call('logout', {}, third.cookie, third.identity.csrfToken)).status, 204);
    assert.equal((await call('me', undefined, third.cookie)).status, 401);
    console.log('PASS: login, HttpOnly session, origin/CSRF rejection, password validation, all-session revocation, disabled-account rejection and logout');
  } finally {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    await source.transaction(async (manager) => {
      await manager.query('DELETE FROM login_sessions WHERE account_id = ?', [id]);
      await manager.query('DELETE FROM audit_events WHERE actor_id = ?', [id]);
      await manager.query('DELETE FROM accounts WHERE id = ? AND login_name = ?', [id, loginName]);
    });
    await source.destroy();
  }
}

await smoke();
