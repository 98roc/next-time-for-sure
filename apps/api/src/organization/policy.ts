import type { OrganizationSnapshot, Permission, Role } from '@ntfs/contracts';
import { fixedPermissions } from '@ntfs/contracts';

export type PolicyActor = { id: string; teamId: string | null; isSuperAdmin: boolean };

/** 合并当前作用范围内的角色操作；项目或小组角色不能扩散到团队其他范围。 */
export function hasPermission(actor: PolicyActor, snapshot: OrganizationSnapshot, permission: Permission, scope: { teamId: string; groupId?: string | null; projectId?: string }): boolean {
  if (actor.teamId !== scope.teamId) return false;
  const roles: Role[] = [];
  if (snapshot.teams.some((team) => team.id === scope.teamId && team.leaderId === actor.id)) roles.push('team_leader');
  if (scope.groupId && snapshot.groups.some((group) => group.id === scope.groupId && group.teamId === scope.teamId && group.leaderId === actor.id)) roles.push('group_leader');
  if (scope.projectId) {
    const project = snapshot.projects.find((entry) => entry.id === scope.projectId && entry.teamId === scope.teamId);
    roles.push(...(project?.members.find((member) => member.accountId === actor.id)?.roles ?? []));
  }
  return roles.some((role) => fixedPermissions[role].includes(permission));
}

/** 超管仅获得组织管理所需目录；本函数不授予任何个人工作或私人事项查看权。 */
export function visibleOrganization(actor: PolicyActor, snapshot: OrganizationSnapshot): OrganizationSnapshot {
  if (actor.isSuperAdmin) return { ...snapshot, groups: [], projects: [] };
  const teams = snapshot.teams.filter((team) => team.id === actor.teamId);
  const leader = teams.some((team) => team.leaderId === actor.id);
  return {
    teams,
    accounts: snapshot.accounts.filter((account) => account.teamId === actor.teamId && actor.teamId !== null),
    groups: snapshot.groups.filter((group) => group.teamId === actor.teamId),
    projects: snapshot.projects.filter((project) => project.teamId === actor.teamId && (leader || project.members.some((member) => member.accountId === actor.id))),
    policies: snapshot.policies,
  };
}
