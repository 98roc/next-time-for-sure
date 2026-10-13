import assert from 'node:assert/strict';
import test from 'node:test';
import type { OrganizationSnapshot } from '@ntfs/contracts';
import { defaultPermissions } from '@ntfs/contracts';
import { hasPermission, visibleOrganization } from './policy.js';

/** 使用不同作用范围验证权限合并，防止角色配置变成全局授权。 */
test('role union stays within team, group and project scope', () => {
  const data: OrganizationSnapshot = {
    accounts: [], teams: [{ id: 'team', name: '团队', leaderId: 'leader', version: 0 }],
    groups: [{ id: 'group', teamId: 'team', name: '小组', leaderId: 'member', memberIds: ['member'], version: 0 }],
    projects: [
      { id: 'project', teamId: 'team', name: '项目', version: 0, members: [{ accountId: 'member', roles: ['project_manager', 'project_lead', 'developer'] }] },
      { id: 'other', teamId: 'team', name: '其他项目', version: 0, members: [] },
    ],
    policies: [
      { role: 'team_leader', permissions: defaultPermissions.team_leader, version: 0 },
      { role: 'group_leader', permissions: ['work.assign', 'members.manage'], version: 0 },
      { role: 'project_lead', permissions: ['milestones.manage'], version: 0 },
      { role: 'project_manager', permissions: ['requests.accept'], version: 0 },
    ],
  };
  const actor = { id: 'member', teamId: 'team', isSuperAdmin: false };
  assert.equal(hasPermission(actor, data, 'requests.accept', { teamId: 'team', projectId: 'project' }), true);
  assert.equal(hasPermission(actor, data, 'milestones.manage', { teamId: 'team', projectId: 'project' }), true);
  assert.equal(hasPermission(actor, data, 'requests.accept', { teamId: 'team', projectId: 'other' }), false);
  assert.equal(hasPermission(actor, data, 'work.assign', { teamId: 'team', groupId: 'group' }), true);
  assert.equal(hasPermission(actor, data, 'work.assign', { teamId: 'team', groupId: 'another' }), false);
  assert.equal(hasPermission(actor, data, 'members.manage', { teamId: 'team' }), false);
  assert.equal(hasPermission(actor, data, 'work.assign', { teamId: 'foreign', groupId: 'group' }), false);
  assert.equal(hasPermission({ ...actor, isSuperAdmin: true, teamId: null }, data, 'work.assign', { teamId: 'team' }), false);
  assert.deepEqual(visibleOrganization(actor, data).projects.map((project) => project.id), ['project']);
  assert.equal(visibleOrganization({ ...actor, teamId: null }, data).projects.length, 0);
});
