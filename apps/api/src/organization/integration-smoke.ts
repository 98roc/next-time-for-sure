import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { organizationSnapshotSchema } from '@ntfs/contracts';
import type { OrganizationCommand } from '@ntfs/contracts';
import { z } from 'zod';
import { AppModule } from '../app.module.js';
import { loadEnvironment } from '../config/environment.js';
import { createDataSource } from '../database/data-source.js';
import { IdentityRepository } from '../identity/identity.repository.js';
import { IdentityService } from '../identity/identity.service.js';
import { digest, hashPassword } from '../identity/password.js';
import { SafeExceptionFilter } from '../safe-exception.filter.js';

export type Session = { cookie: string; csrf: string };
export type WorkFixture = { call: (path: string, auth?: Session, body?: unknown) => Promise<Response>; leader: Session; developer: Session; admin: Session; manager: Session; projectId: string; otherProjectId: string; ownerId: string };

/** 真实数据库及HTTP组织验收；测试数据有唯一前缀，仅清理本次创建的记录。 */
export async function smoke(verifyWork?: (fixture: WorkFixture) => Promise<void>): Promise<void> {
  const source = createDataSource(loadEnvironment());
  await source.initialize();
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new SafeExceptionFilter());
  const prefix = `verify.${randomBytes(8).toString('hex')}`;
  const superId = randomUUID();
  const password = randomBytes(24).toString('hex');
  const replacement = randomBytes(24).toString('hex');
  let base = '';
  const retainedAccounts = new Set<string>();
  let retainTeam = false;
  const inspect = process.argv.includes('--inspect-ui');
  const inspectPath = fileURLToPath(new URL('../../../../.cache/ui-inspection.json', import.meta.url));
  let inspectFileCreated = false;

  /** 会话夹具仅用于组织测试，登录及密码认证由identity:smoke独立验证。 */
  async function session(id: string): Promise<Session> {
    const token = randomBytes(32).toString('hex'); const csrf = randomBytes(32).toString('hex');
    await new IdentityRepository(source.manager).createSession(digest(token), id, csrf);
    return { cookie: `ntfs_session=${token}`, csrf };
  }
  async function call(path: string, auth?: Session, body?: unknown) {
    return fetch(`${base}/api/v1/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Cookie: auth?.cookie ?? '', 'X-CSRF-Token': auth?.csrf ?? '' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  }
  async function command(auth: Session, body: OrganizationCommand, expected = 204) {
    const response = await call('organization/commands', auth, body);
    assert.equal(response.status, expected, `${body.action}: expected ${expected}, got ${response.status}`);
  }
  async function snapshot(auth: Session) {
    const response = await call('organization', auth); assert.equal(response.status, 200);
    return organizationSnapshotSchema.parse(await response.json());
  }

  try {
    await source.query('INSERT INTO accounts (id, login_name, display_name, password_hash, is_super_admin, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))', [superId, `${prefix}.admin`, '临时验收超管', await hashPassword(password)]);
    await app.listen(inspect ? 3100 : 0, '127.0.0.1'); base = await app.getUrl();
    const admin = await session(superId);
    const revoked = await session(superId);
    const revokedToken = revoked.cookie.slice('ntfs_session='.length);
    await source.transaction('REPEATABLE READ', async (manager) => {
      assert.ok(await new IdentityRepository(manager).session(digest(revokedToken)));
      await new IdentityRepository(source.manager).revoke(digest(revokedToken));
      await assert.rejects(app.get(IdentityService).authenticate(manager, revokedToken), /登录已失效/);
    });
    assert.equal((await call('organization')).status, 401);
    await command(admin, { action: 'create_team', name: `${prefix}.team`, leader: { loginName: `${prefix}.leader`, displayName: '验收负责人', password } });
    await command(admin, { action: 'create_team', name: `${prefix}.foreign`, leader: { loginName: `${prefix}.foreign`, displayName: '其他团队负责人', password } });
    const initial = await snapshot(admin);
    const team = initial.teams.find((entry) => entry.name === `${prefix}.team`);
    const foreign = initial.teams.find((entry) => entry.name === `${prefix}.foreign`);
    assert.ok(team && foreign);
    let leader = await session(team.leaderId);
    assert.equal((await call('organization', leader)).status, 403);
    assert.equal((await call('auth/password', leader, { currentPassword: password, newPassword: replacement })).status, 204);
    assert.equal((await call('organization', leader)).status, 401);
    leader = await session(team.leaderId);
    await command(leader, { action: 'create_member', teamId: team.id, loginName: `${prefix}.member`, displayName: '多组研发成员', password });
    await command(leader, { action: 'create_member', teamId: foreign.id, loginName: `${prefix}.illegal`, displayName: '越权成员', password }, 403);
    let state = await snapshot(leader);
    assert.equal(state.teams.length, 1); assert.equal(state.accounts.some((entry) => entry.id === foreign.leaderId), false);
    const member = state.accounts.find((entry) => entry.loginName === `${prefix}.member`); assert.ok(member);
    let developer = await session(member.id);
    assert.equal((await call('auth/password', developer, { currentPassword: password, newPassword: replacement })).status, 204);
    developer = await session(member.id);
    await command(developer, { action: 'create_group', teamId: team.id, name: '越权小组', leaderId: member.id, memberIds: [member.id] }, 403);
    await command(leader, { action: 'create_group', teamId: team.id, name: '小组甲', leaderId: member.id, memberIds: [member.id, team.leaderId] });
    await command(leader, { action: 'create_group', teamId: team.id, name: '小组乙', leaderId: team.leaderId, memberIds: [member.id, team.leaderId] });
    await command(leader, { action: 'create_group', teamId: team.id, name: '跨团队小组', leaderId: foreign.leaderId, memberIds: [foreign.leaderId] }, 400);
    state = await snapshot(leader);
    assert.equal(state.groups.filter((group) => group.memberIds.includes(member.id)).length, 2);
    const group = state.groups[0]; assert.ok(group);
    const update: OrganizationCommand = { action: 'update_group', groupId: group.id, name: '并发保存', leaderId: group.leaderId, memberIds: group.memberIds, version: group.version };
    const competing = await Promise.all([call('organization/commands', leader, update), call('organization/commands', leader, update)]);
    assert.deepEqual(competing.map((response) => response.status).sort(), [204, 409]);
    await command(leader, { action: 'create_project', teamId: team.id, name: '多角色项目', managerId: member.id, leadId: member.id, developerIds: [member.id] });
    await command(leader, { action: 'create_project', teamId: team.id, name: '其他项目', managerId: team.leaderId, leadId: team.leaderId, developerIds: [] });
    const own = await snapshot(developer); assert.equal(own.projects.length, 1);
    let project = own.projects[0]; assert.ok(project); assert.equal(project.members[0]?.roles.length, 3);
    const testProjectId = project.id;
    if (verifyWork) {
      const other = (await snapshot(leader)).projects.find((entry) => entry.id !== testProjectId); assert.ok(other);
      const managerId = randomUUID();
      await source.query('INSERT INTO accounts (id, login_name, display_name, password_hash, team_id, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))', [managerId, `${prefix}.manager`, '仅项目经理验收账号', await hashPassword(password), team.id]);
      await command(leader, { action: 'set_project_member', projectId: project.id, accountId: managerId, roles: ['project_manager'], version: project.version });
      await verifyWork({ call, leader, developer, admin, manager: await session(managerId), projectId: project.id, otherProjectId: other.id, ownerId: member.id });
      if (inspect) {
        // 临时浏览器夹具只写忽略文件；输入回车后按原流程撤销会话并清理全部随机数据。
        await writeFile(inspectPath, JSON.stringify({ loginName: `${prefix}.member`, password: replacement, projectId: project.id, base }), { flag: 'wx', mode: 0o600 });
        inspectFileCreated = true;
        const input = createInterface({ input: process.stdin, output: process.stdout });
        try { await input.question('UI inspection fixture ready on port 3100. Press Enter to clean up.\n'); }
        finally { input.close(); }
      }
      project = (await snapshot(leader)).projects.find((entry) => entry.id === testProjectId); assert.ok(project);
    }
    await command(developer, { action: 'set_project_member', projectId: project.id, accountId: member.id, roles: ['developer'], version: project.version }, 403);
    await command(leader, { action: 'set_project_member', projectId: project.id, accountId: member.id, roles: ['developer'], version: project.version }, 400);
    await command(leader, { action: 'set_project_member', projectId: project.id, accountId: team.leaderId, roles: ['developer'], version: project.version });
    await command(leader, { action: 'set_project_member', projectId: project.id, accountId: team.leaderId, roles: ['developer'], version: project.version }, 409);
    await command(leader, { action: 'set_role_permissions', role: 'developer', permissions: ['members.manage'], version: 0 }, 403);
    state = await snapshot(leader);
    const beforeReset = state.accounts.find((entry) => entry.id === member.id); assert.ok(beforeReset);
    await command(leader, { action: 'reset_password', accountId: member.id, password, version: beforeReset.version });
    assert.equal((await call('auth/me', developer)).status, 401);
    developer = await session(member.id);
    assert.equal((await call('organization', developer)).status, 403);
    state = await snapshot(leader);
    const beforeDisable = state.accounts.find((entry) => entry.id === member.id); assert.ok(beforeDisable);
    await command(leader, { action: 'set_disabled', accountId: member.id, disabled: true, version: beforeDisable.version });
    assert.equal((await call('auth/me', developer)).status, 401);
    await command(leader, { action: 'set_disabled', accountId: member.id, disabled: false, version: beforeDisable.version + 1 });
    assert.equal((await call('auth/me', developer)).status, 401);
    await command(admin, { action: 'set_leader', teamId: team.id, accountId: member.id, version: team.version });
    await command(leader, { action: 'create_member', teamId: team.id, loginName: `${prefix}.revoked`, displayName: '已失权', password }, 403);
    const audits: unknown = await source.query('SELECT COUNT(*) AS count FROM audit_events WHERE actor_id IN (?, ?)', [superId, team.leaderId]);
    assert.ok((z.array(z.object({ count: z.coerce.number() })).parse(audits)[0]?.count ?? 0) >= 10);
    if (process.argv.includes('--keep-demo')) {
      // 只保留可试用的本团队数据；恢复负责人并重置随机临时密码。
      await command(admin, { action: 'set_leader', teamId: team.id, accountId: team.leaderId, version: team.version + 1 });
      const demo = await snapshot(admin);
      for (const account of demo.accounts.filter((entry) => entry.teamId === team.id)) {
        await command(admin, { action: 'reset_password', accountId: account.id, password, version: account.version });
      }
      const path = fileURLToPath(new URL('../../../../.demo-credentials.local', import.meta.url));
      await writeFile(path, `示例团队负责人\nloginName=${prefix}.leader\npassword=${password}\n\n示例研发成员（兼任项目经理和项目研发负责人）\nloginName=${prefix}.member\npassword=${password}\n\n首次登录须修改临时密码。改密后可删除此文件。\n`, { flag: 'wx', mode: 0o600 });
      retainedAccounts.add(team.leaderId); retainedAccounts.add(member.id); retainTeam = true;
      await source.query('UPDATE teams SET name = ? WHERE id = ?', ['示例研发团队', team.id]);
      console.log('Retained demo: 1 team, 2 members, 2 groups, 2 projects. Credentials saved only to ignored .demo-credentials.local.');
    }
    console.log('PASS: real HTTP + MySQL organization scope, mandatory password change, multi-group membership, merged project roles, concurrent 409, password reset, disable/re-enable, immediate leader revocation and audit');
  } finally {
    if (inspectFileCreated) await unlink(inspectPath);
    await app.close();
    // 按唯一随机账号前缀定位本次数据；先解除循环外键，再清理关联记录。
    await source.transaction(async (manager) => {
      const rows: unknown = await manager.query('SELECT id FROM accounts WHERE login_name LIKE ?', [`${prefix}.%`]);
      const ids = z.array(z.object({ id: z.string() })).parse(rows).map((entry) => entry.id).filter((id) => !retainedAccounts.has(id));
      const teamNames = [retainTeam ? `${prefix}.none` : `${prefix}.team`, `${prefix}.foreign`];
      for (const id of ids) {
        await manager.query('DELETE pr FROM personal_progress pr JOIN personal_items i ON i.id = pr.item_id WHERE i.owner_id = ?', [id]);
        await manager.query('DELETE FROM personal_items WHERE owner_id = ?', [id]);
        await manager.query('DELETE FROM personal_categories WHERE owner_id = ?', [id]);
        await manager.query('DELETE FROM personal_events WHERE owner_id = ?', [id]);
      }
      await manager.query('DELETE pr FROM assignment_progress pr JOIN task_assignments a ON a.id = pr.assignment_id JOIN team_tasks w ON w.id = a.task_id JOIN projects p ON p.id = w.project_id JOIN teams t ON t.id = p.team_id WHERE t.name IN (?, ?)', teamNames);
      await manager.query('DELETE a FROM task_assignments a JOIN team_tasks w ON w.id = a.task_id JOIN projects p ON p.id = w.project_id JOIN teams t ON t.id = p.team_id WHERE t.name IN (?, ?)', teamNames);
      await manager.query('DELETE e FROM work_events e JOIN projects p ON p.id = e.project_id JOIN teams t ON t.id = p.team_id WHERE t.name IN (?, ?)', teamNames);
      await manager.query('UPDATE team_tasks w JOIN projects p ON p.id = w.project_id JOIN teams t ON t.id = p.team_id SET w.waiting_task_id = NULL WHERE t.name IN (?, ?)', teamNames);
      await manager.query('DELETE w FROM team_tasks w JOIN projects p ON p.id = w.project_id JOIN teams t ON t.id = p.team_id WHERE t.name IN (?, ?) AND w.parent_id IS NOT NULL', teamNames);
      await manager.query('DELETE w FROM team_tasks w JOIN projects p ON p.id = w.project_id JOIN teams t ON t.id = p.team_id WHERE t.name IN (?, ?)', teamNames);
      await manager.query('DELETE r FROM work_requests r JOIN projects p ON p.id = r.project_id JOIN teams t ON t.id = p.team_id WHERE t.name IN (?, ?)', teamNames);
      await manager.query('DELETE pm FROM project_members pm JOIN projects p ON p.id = pm.project_id JOIN teams t ON t.id = p.team_id WHERE t.name IN (?, ?)', teamNames);
      await manager.query('DELETE p FROM projects p JOIN teams t ON t.id = p.team_id WHERE t.name IN (?, ?)', teamNames);
      await manager.query('DELETE gm FROM group_members gm JOIN work_groups g ON g.id = gm.group_id JOIN teams t ON t.id = g.team_id WHERE t.name IN (?, ?)', teamNames);
      await manager.query('DELETE g FROM work_groups g JOIN teams t ON t.id = g.team_id WHERE t.name IN (?, ?)', teamNames);
      for (const id of ids) {
        await manager.query('DELETE FROM work_operations WHERE actor_id = ?', [id]);
        await manager.query('UPDATE accounts SET team_id = NULL WHERE id = ?', [id]);
        await manager.query('DELETE FROM login_sessions WHERE account_id = ?', [id]);
        await manager.query('DELETE FROM audit_events WHERE actor_id = ?', [id]);
      }
      await manager.query('DELETE FROM teams WHERE name IN (?, ?)', teamNames);
      for (const id of ids) await manager.query('DELETE FROM accounts WHERE id = ?', [id]);
    });
    await source.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await smoke();
