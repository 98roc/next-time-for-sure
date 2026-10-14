import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { issuedTokenSchema, personalTokensSchema, lifecyclePreviewSchema, workSnapshotSchema } from '@ntfs/contracts';
import { smoke } from '../organization/integration-smoke.js';
import type { Session } from '../organization/integration-smoke.js';
import { createDataSource } from '../database/data-source.js';
import { loadEnvironment } from '../config/environment.js';
import { digest } from './password.js';
import { z } from 'zod';
import { probeCodex } from './codex-probe.js';

/** 真实HTTP验证Token边界与实时撤权；随机凭据不打印、不写文件。 */
await smoke(async ({ base, call, developer, leader, projectId, otherProjectId, ownerId }) => {
  const create = async (name: string, expiresAt: string | null = null) => {
    const response = await call('tokens', developer, { name, expiresAt, permanentConfirmed: expiresAt === null }); assert.equal(response.status, 200);
    return issuedTokenSchema.parse(await response.json());
  };
  assert.equal((await call('tokens', developer, { name: '未确认永久', expiresAt: null, permanentConfirmed: false })).status, 400);
  const issued = await create('协议验证'); const auth: Session = { bearer: issued.token, cookie: '', csrf: '' };
  if (process.argv.includes('--mcp')) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('../../../mcp/dist/business-probe.js', import.meta.url))], { env: { ...process.env, MCP_API_URL: base, NTFS_ACCESS_TOKEN: issued.token, NTFS_TEST_PROJECT: projectId, NTFS_TEST_FOREIGN_PROJECT: otherProjectId }, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
      const timeout = setTimeout(() => { child.kill(); reject(new Error('MCP probe timed out')); }, 60000);
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.once('exit', (code) => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new Error('MCP probe failed')); });
    });
  }
  if (process.argv.includes('--codex')) {
    await probeCodex(base, issued.token, projectId, otherProjectId);
    const state = workSnapshotSchema.parse(await (await call(`work?projectId=${projectId}`, developer)).json());
    assert.equal(state.requests.filter((entry) => entry.title === 'Codex需求验收').length, 1);
    assert.equal(state.tasks.filter((entry) => entry.title === 'Codex任务验收').length, 1);
  }
  const list = personalTokensSchema.parse(await (await call('tokens', developer)).json()); assert.ok(list.some((entry) => entry.id === issued.id)); assert.equal(JSON.stringify(list).includes(issued.token), false);
  assert.equal((await call(`work?projectId=${projectId}`, auth)).status, 200);
  assert.equal((await call(`work?projectId=${otherProjectId}`, auth)).status, 403);
  assert.equal((await call('tokens', auth)).status, 403);
  assert.equal((await call('tokens', { ...developer, bearer: issued.token }, { name: '不能生成', expiresAt: null, permanentConfirmed: true })).status, 403);
  assert.equal((await call('tokens/revoke', auth, { id: issued.id })).status, 403);
  assert.equal((await call('tokens', { cookie: `ntfs_session=bearer:${issued.token}`, csrf: '' })).status, 401);
  assert.equal((await call('tokens/revoke', leader, { id: issued.id })).status, 403);
  const command = { action: 'create_task', projectId, title: 'Token业务写入', description: '', acceptance: '', operationId: randomUUID() };
  assert.equal((await call('work/commands', auth, command)).status, 200);
  assert.equal((await call('work/commands', auth, command)).status, 200);
  assert.equal(workSnapshotSchema.parse(await (await call(`work?projectId=${projectId}`, developer)).json()).tasks.filter((task) => task.title === command.title).length, 1);

  const database = createDataSource(loadEnvironment()); await database.initialize();
  try {
    const rows: unknown = await database.query('SELECT token_hash FROM personal_tokens WHERE id=?', [issued.id]);
    assert.equal(z.array(z.object({ token_hash: z.string() })).parse(rows)[0]?.token_hash, digest(issued.token));
    const expired = await create('到期验证', new Date(Date.now() + 60000).toISOString());
    await database.query('UPDATE personal_tokens SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?', [expired.id]);
    assert.equal((await call(`work?projectId=${projectId}`, { ...auth, bearer: expired.token })).status, 401);
    await database.query('UPDATE accounts SET disabled=1 WHERE id=?', [ownerId]);
    assert.equal((await call(`work?projectId=${projectId}`, auth)).status, 401);
    await database.query('UPDATE accounts SET disabled=0 WHERE id=?', [ownerId]);
  } finally { await database.destroy(); }
  const review = lifecyclePreviewSchema.parse(await (await call('lifecycle/preview', leader, { action: 'remove_member', objectId: ownerId })).json());
  assert.equal((await call('lifecycle/commands', leader, { intent: { action: 'remove_member', objectId: ownerId }, confirmation: review.confirmation, reason: 'Token实时撤权验收', operationId: randomUUID() })).status, 200);
  assert.equal((await call(`work?projectId=${projectId}`, auth)).status, 403);
  assert.equal((await call('tokens/revoke', developer, { id: issued.id })).status, 200);
  assert.equal((await call(`work?projectId=${projectId}`, auth)).status, 401);
  // 组织夹具后续回归需恢复成员归属，凭据仍保持已撤销。
  const source = createDataSource(loadEnvironment()); await source.initialize();
  try { await source.query('UPDATE accounts a JOIN projects p ON p.id=? SET a.team_id=p.team_id WHERE a.id=?', [projectId, ownerId]); } finally { await source.destroy(); }
  console.log('PASS: token digest only, explicit permanent confirmation, same business rules, no credential management, expiry/revocation/disable and immediate team scope enforcement');
});
