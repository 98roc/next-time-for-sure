import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { issuedTokenSchema, personalTokensSchema, v2WorkspaceSchema } from '@ntfs/contracts';
import { z } from 'zod';
import { withFixture } from '../testing/fixture.js';
import { digest } from './password.js';

/** 真 Token 复用 V2 服务，验证到期、撤销、停用及项目撤权；凭据不落盘。 */
await withFixture(async ({ base, call, source, developer, leader, projectId, otherProjectId }) => {
  const create = async (name: string, expiresAt: string | null = null) => {
    const response = await call('tokens', developer, { name, expiresAt, permanentConfirmed: expiresAt === null }); assert.equal(response.status, 200);
    return issuedTokenSchema.parse(await response.json());
  };
  assert.equal((await call('tokens', developer, { name: '未确认永久', expiresAt: null, permanentConfirmed: false })).status, 400);
  const issued = await create('V2协议验证'), auth = { ...developer, bearer: issued.token, cookie: '', csrf: '' };
  const workspace = async () => v2WorkspaceSchema.parse(await (await call('v2/workspace', auth)).json());
  const initial = await workspace(); assert.equal(initial.projects.some((row) => row.id === otherProjectId), false);
  assert.equal((await call('tokens', auth)).status, 403);
  assert.equal((await call('tokens', { ...developer, bearer: issued.token }, { name: '不能生成', expiresAt: null, permanentConfirmed: true })).status, 403);
  assert.equal((await call('tokens/revoke', auth, { id: issued.id })).status, 403);
  assert.equal((await call('tokens', { ...developer, cookie: `ntfs_session=bearer:${issued.token}`, csrf: '' })).status, 401);
  assert.equal((await call('tokens/revoke', leader, { id: issued.id })).status, 403);
  const period = initial.periods.find((row) => row.startOn <= initial.today && row.endOn >= initial.today); assert.ok(period);
  const command = { action: 'create_project', operationId: randomUUID(), task: { projectId, title: 'Token V2任务', executorId: developer.id, periodId: period.id, priority: 3, milestoneId: null, plannedDays: 1 } };
  assert.equal((await call('v2/tasks', auth, command)).status, 200); assert.equal((await call('v2/tasks', auth, command)).status, 200);
  assert.equal((await workspace()).tasks.filter((row) => row.title === command.task.title).length, 1);
  assert.equal((await call('v2/tasks', auth, { ...command, operationId: randomUUID(), task: { ...command.task, projectId: otherProjectId } })).status, 403);
  if (process.argv.includes('--mcp')) await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../../mcp/dist/business-probe.js', import.meta.url))], { env: { ...process.env, MCP_API_URL: base, NTFS_ACCESS_TOKEN: issued.token, NTFS_TEST_PROJECT: projectId, NTFS_TEST_FOREIGN_PROJECT: otherProjectId }, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('MCP probe timed out')); }, 60000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); }); child.once('exit', (code) => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new Error('MCP probe failed')); });
  });
  const list = personalTokensSchema.parse(await (await call('tokens', developer)).json()); assert.equal(JSON.stringify(list).includes(issued.token), false);
  const rows = z.array(z.object({ token_hash: z.string() })).parse(await source.query('SELECT token_hash FROM personal_tokens WHERE id=?', [issued.id])); assert.equal(rows[0]?.token_hash, digest(issued.token));
  const expired = await create('到期验证', new Date(Date.now() + 60000).toISOString());
  await source.query('UPDATE personal_tokens SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?', [expired.id]);
  assert.equal((await call('v2/workspace', { ...auth, bearer: expired.token })).status, 401);
  await source.query('UPDATE accounts SET disabled=1 WHERE id=?', [developer.id]); assert.equal((await call('v2/workspace', auth)).status, 401);
  await source.query('UPDATE accounts SET disabled=0 WHERE id=?', [developer.id]);
  await source.query('DELETE FROM project_members WHERE project_id=? AND account_id=?', [projectId, developer.id]);
  assert.equal((await workspace()).projects.some((row) => row.id === projectId), false);
  assert.equal((await call('v2/tasks', auth, command)).status, 403);
  assert.equal((await call('tokens/revoke', developer, { id: issued.id })).status, 200); assert.equal((await call('v2/workspace', auth)).status, 401);
  console.log('PASS: token digest, permanent confirmation, V2 idempotence and scope, no Token management, expiry, disable, revoke and immediate project revocation.');
});
