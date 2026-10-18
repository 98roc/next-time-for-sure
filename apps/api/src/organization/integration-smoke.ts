import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { organizationSnapshotSchema } from '@ntfs/contracts';
import { withFixture } from '../testing/fixture.js';
import { generateTemporaryPassword } from '../identity/password.js';

/** 真实 HTTP/MySQL 校验基础账号管理，V2 项目成员业务由 v2:smoke 验收。 */
await withFixture(async ({ call, source, prefix, teamId, admin, leader, developer }) => {
  const snapshot = async () => organizationSnapshotSchema.parse(await (await call('organization', admin)).json());
  const password = generateTemporaryPassword();
  assert.equal((await call('organization')).status, 401);
  for (const path of ['work/requests', 'tasks', 'assignments', 'personal', 'weekly-plans', 'reports', 'lifecycle', 'notifications']) assert.equal((await call(path, leader)).status, 404);
  assert.equal((await snapshot()).projects.length, 0);
  assert.equal((await call('organization/commands', leader, { action: 'create_account', loginName: `${prefix}.illegal`, displayName: '越权', password })).status, 403);
  assert.equal((await call('organization/commands', leader, { action: 'create_group', teamId, name: '旧小组', leaderId: leader.id, memberIds: [leader.id] })).status, 400);
  assert.equal((await call('organization/commands', leader, { action: 'create_project', teamId, name: '旧项目入口', managerId: leader.id, leadId: leader.id, developerIds: [] })).status, 400);
  assert.equal((await call('organization/commands', admin, { action: 'create_account', loginName: `${prefix}.spare`, displayName: '验收账号', password })).status, 204);
  let spare = (await snapshot()).accounts.find((row) => row.loginName === `${prefix}.spare`); assert.ok(spare);
  const edit = { action: 'update_account', accountId: spare.id, loginName: spare.loginName, displayName: '更新姓名', version: spare.version };
  const races = await Promise.all([call('organization/commands', admin, edit), call('organization/commands', admin, edit)]);
  assert.deepEqual(races.map((row) => row.status).sort(), [204, 409]);
  assert.equal((await call('organization/commands', leader, { action: 'link_member', teamId, loginName: spare.loginName })).status, 204);
  spare = (await snapshot()).accounts.find((row) => row.id === spare?.id); assert.ok(spare);
  assert.equal((await call('organization/commands', admin, { action: 'delete_account', accountId: spare.id, version: spare.version })).status, 409);
  assert.equal((await call('organization/commands', leader, { action: 'reset_password', accountId: spare.id, password, version: spare.version })).status, 204);
  const account = (await snapshot()).accounts.find((row) => row.id === developer.id); assert.ok(account);
  assert.equal((await call('organization/commands', leader, { action: 'set_disabled', accountId: account.id, version: account.version, disabled: true })).status, 204);
  assert.equal((await call('auth/me', developer)).status, 401);
  assert.equal((await call('organization/commands', leader, { action: 'set_disabled', accountId: account.id, version: account.version + 1, disabled: false })).status, 204);
  assert.equal((await call('auth/me', developer)).status, 401);
  // 独立的 V2 操作历史仍阻止物理删除，不能只检查当前项目关系。
  await source.query('UPDATE accounts SET team_id=NULL WHERE id=?', [spare.id]);
  await source.query('INSERT INTO v2_operations(actor_id,operation_id,payload_hash,result_json,created_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))', [spare.id, randomUUID(), 'a'.repeat(64), '{}']);
  assert.equal((await call('organization/commands', admin, { action: 'delete_account', accountId: spare.id, version: spare.version + 1 })).status, 409);
  await source.query('DELETE FROM v2_operations WHERE actor_id=?', [spare.id]);
  assert.equal((await call('organization/commands', admin, { action: 'delete_account', accountId: spare.id, version: spare.version + 1 })).status, 204);
  console.log('PASS: V2 account scope, old organization commands removed, concurrent conflict, history-safe deletion, reset and immediate session revocation.');
});
