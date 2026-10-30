import type { OrganizationSnapshot } from '@ntfs/contracts';

export type PolicyActor = { id: string; teamId: string | null; isSuperAdmin: boolean };

/** 移除管理员资格前检查其他已启用管理员；调用方须持有组织事务锁。 */
export function hasOtherAdministrator(snapshot: OrganizationSnapshot, accountId: string): boolean {
  return snapshot.accounts.some((account) => account.id !== accountId && account.isSuperAdmin && !account.disabled);
}

/** 系统角色与团队职责独立；兼任管理员仍须是本团队实际负责人。 */
export function isTeamLeader(actor: PolicyActor, snapshot: OrganizationSnapshot, teamId: string): boolean {
  return actor.teamId === teamId && snapshot.teams.some((team) => team.id === teamId && team.leaderId === actor.id);
}

/** 目录按当前归属裁剪；超管只获得账号与团队，不读取项目业务。 */
export function visibleOrganization(actor: PolicyActor, snapshot: OrganizationSnapshot): OrganizationSnapshot {
  if (actor.isSuperAdmin) return { ...snapshot, projects: [] };
  return {
    teams: snapshot.teams.filter((team) => team.id === actor.teamId),
    accounts: snapshot.accounts.filter((account) => account.teamId === actor.teamId && actor.teamId !== null),
    projects: snapshot.projects.filter((project) => project.teamId === actor.teamId && (isTeamLeader(actor, snapshot, project.teamId) || project.members.some((member) => member.accountId === actor.id))),
  };
}
