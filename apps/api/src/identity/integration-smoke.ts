import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { identitySchema } from '@ntfs/contracts';
import { z } from 'zod';
import { loadEnvironment } from '../config/environment.js';
import { createDataSource } from '../database/data-source.js';
import { digest, hashPassword } from './password.js';
import { sessionLifetimeSeconds } from './session-policy.js';

/** 独立库真实会话回归；只创建并清理本次随机测试账号及其审计、会话。 */
async function smoke(): Promise<void> {
  const source = createDataSource(loadEnvironment());
  await source.initialize();
  const id = randomUUID();
  const loginName = `test.${randomBytes(8).toString('hex')}`;
  const initial = randomBytes(24).toString('hex');
  const replacement = 'Aa1' + randomBytes(3).toString('hex').slice(0, 5);
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
  async function call(path: string, body?: unknown, cookie = '', csrf = '', origin = base, passive = false) {
    return fetch(`${base}/api/v1/auth/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, ...(passive ? { 'X-NTFS-Session-Activity': 'passive' } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
    });
  }

  async function signIn(password: string) {
    const response = await call('login', { loginName, password });
    assert.equal(response.status, 200);
    const rawCookie = response.headers.get('set-cookie');
    assert.ok(rawCookie);
    assert.ok(rawCookie.includes('HttpOnly') && rawCookie.includes('SameSite=Strict'));
    assert.ok(rawCookie.includes(`Max-Age=${sessionLifetimeSeconds}`));
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
    const firstHash = digest(first.cookie.slice('ntfs_session='.length));
    const lifetime = async () => {
      const rows: unknown = await source.query('SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), expires_at) AS remaining FROM login_sessions WHERE token_hash = ?', [firstHash]);
      return z.array(z.object({ remaining: z.coerce.number() })).parse(rows)[0]?.remaining ?? 0;
    };
    assert.ok(await lifetime() >= sessionLifetimeSeconds - 10);

    // 模拟旧12小时会话临近到期；后台轮询不续期，主动读取同步延长Cookie和数据库。
    await source.query('UPDATE login_sessions SET expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 HOUR) WHERE token_hash = ?', [firstHash]);
    const passive = await call('me', undefined, first.cookie, '', base, true);
    assert.equal(passive.status, 200); assert.equal(passive.headers.get('set-cookie'), null);
    assert.ok(await lifetime() <= 3600);
    const renewed = await call('me', undefined, first.cookie);
    assert.equal(renewed.status, 200);
    assert.ok(renewed.headers.get('set-cookie')?.includes(`Max-Age=${sessionLifetimeSeconds}`));
    assert.ok(await lifetime() >= sessionLifetimeSeconds - 10);

    // 过期会话不能复活，失败响应也不能写回Cookie。
    await source.query('UPDATE login_sessions SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE token_hash = ?', [firstHash]);
    const expired = await call('me', undefined, first.cookie);
    assert.equal(expired.status, 401); assert.equal(expired.headers.get('set-cookie'), null);
    assert.ok(await lifetime() < 0);
    await source.query('UPDATE login_sessions SET expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 HOUR) WHERE token_hash = ?', [firstHash]);
    for (const newPassword of ['Abcdef1', 'abcdefgh1', 'ABCDEFGH1', 'Abcdefgh']) {
      assert.equal((await call('password', { currentPassword: initial, newPassword }, first.cookie, first.identity.csrfToken)).status, 400);
    }
    assert.equal((await call('password', { currentPassword: initial, newPassword: replacement }, first.cookie, 'wrong')).status, 403);
    assert.equal((await call('password', { currentPassword: 'wrong', newPassword: replacement }, first.cookie, first.identity.csrfToken)).status, 403);
    const changed = await call('password', { currentPassword: initial, newPassword: replacement }, first.cookie, first.identity.csrfToken);
    assert.equal(changed.status, 204); assert.ok(changed.headers.get('set-cookie')?.includes('Max-Age=0'));
    assert.equal((await call('me', undefined, first.cookie)).status, 401);
    assert.equal((await call('me', undefined, second.cookie)).status, 401);
    assert.equal((await call('login', { loginName, password: initial })).status, 401);
    const third = await signIn(replacement);
    assert.equal(third.identity.mustChangePassword, false);

    // 验证每次读取当前账号状态，而非信任登录时的快照。
    await source.query('UPDATE accounts SET disabled = 1 WHERE id = ?', [id]);
    assert.equal((await call('me', undefined, third.cookie)).status, 401);
    await source.query('UPDATE accounts SET disabled = 0 WHERE id = ?', [id]);
    const loggedOut = await call('logout', {}, third.cookie, third.identity.csrfToken);
    assert.equal(loggedOut.status, 204); assert.ok(loggedOut.headers.get('set-cookie')?.includes('Max-Age=0'));
    assert.equal((await call('me', undefined, third.cookie)).status, 401);
    console.log('PASS: 30-day session creation and renewal, passive/expired session rejection, 8-character mixed-case password policy, origin/CSRF, revocation, disabled account and logout');
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
