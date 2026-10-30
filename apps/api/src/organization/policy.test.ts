import assert from 'node:assert/strict';
import test from 'node:test';
import type { OrganizationSnapshot } from '@ntfs/contracts';
import { hasOtherAdministrator, isTeamLeader, visibleOrganization } from './policy.js';

test('团队管理即时检查实际负责人，系统角色不自动授予团队管理职责', () => {
  const data: OrganizationSnapshot = { accounts: [], teams: [{ id: 'team', name: '团队', leaderId: 'leader', version: 0 }], projects: [
    { id: 'project', teamId: 'team', name: '项目', version: 0, members: [{ accountId: 'member', roles: ['project_lead'] }] },
    { id: 'other', teamId: 'team', name: '其他项目', version: 0, members: [] },
  ] };
  const actor = { id: 'member', teamId: 'team', isSuperAdmin: false };
  assert.equal(isTeamLeader(actor, data, 'team'), false);
  assert.equal(isTeamLeader({ ...actor, id: 'leader' }, data, 'team'), true);
  assert.equal(isTeamLeader({ ...actor, id: 'leader', teamId: 'other' }, data, 'team'), false);
  assert.equal(isTeamLeader({ ...actor, id: 'leader', isSuperAdmin: true }, data, 'team'), true);
  assert.deepEqual(visibleOrganization(actor, data).projects.map((project) => project.id), ['project']);
  assert.equal(visibleOrganization({ ...actor, teamId: null }, data).projects.length, 0);
  assert.equal(visibleOrganization({ ...actor, isSuperAdmin: true }, data).projects.length, 0);
});

test('最后一个可用管理员不能由已停用或普通账号替代', () => {
  const admin = { id: 'admin', loginName: 'admin', displayName: '管理员', teamId: null, isSuperAdmin: true, disabled: false, version: 0 };
  const data: OrganizationSnapshot = { teams: [], projects: [], accounts: [admin] };
  assert.equal(hasOtherAdministrator(data, admin.id), false);
  assert.equal(hasOtherAdministrator({ ...data, accounts: [admin, { ...admin, id: 'other', disabled: true }] }, admin.id), false);
  assert.equal(hasOtherAdministrator({ ...data, accounts: [admin, { ...admin, id: 'other', isSuperAdmin: false }] }, admin.id), false);
  assert.equal(hasOtherAdministrator({ ...data, accounts: [admin, { ...admin, id: 'other' }] }, admin.id), true);
});
