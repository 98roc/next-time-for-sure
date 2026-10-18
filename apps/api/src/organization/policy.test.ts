import assert from 'node:assert/strict';
import test from 'node:test';
import type { OrganizationSnapshot } from '@ntfs/contracts';
import { isTeamLeader, visibleOrganization } from './policy.js';

test('团队管理即时检查负责人，超管与项目角色不获得团队业务权限', () => {
  const data: OrganizationSnapshot = { accounts: [], teams: [{ id: 'team', name: '团队', leaderId: 'leader', version: 0 }], projects: [
    { id: 'project', teamId: 'team', name: '项目', version: 0, members: [{ accountId: 'member', roles: ['project_lead'] }] },
    { id: 'other', teamId: 'team', name: '其他项目', version: 0, members: [] },
  ] };
  const actor = { id: 'member', teamId: 'team', isSuperAdmin: false };
  assert.equal(isTeamLeader(actor, data, 'team'), false);
  assert.equal(isTeamLeader({ ...actor, id: 'leader' }, data, 'team'), true);
  assert.equal(isTeamLeader({ ...actor, id: 'leader', teamId: 'other' }, data, 'team'), false);
  assert.equal(isTeamLeader({ ...actor, id: 'leader', isSuperAdmin: true }, data, 'team'), false);
  assert.deepEqual(visibleOrganization(actor, data).projects.map((project) => project.id), ['project']);
  assert.equal(visibleOrganization({ ...actor, teamId: null }, data).projects.length, 0);
  assert.equal(visibleOrganization({ ...actor, isSuperAdmin: true }, data).projects.length, 0);
});
