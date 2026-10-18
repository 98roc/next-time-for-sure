import type { OrganizationSnapshot } from '@ntfs/contracts';

export type PolicyActor = { id: string; teamId: string | null; isSuperAdmin: boolean };

/** 基础成员管理仅属于当前团队负责人，超管不取得团队内业务权限。 */
export function isTeamLeader(actor: PolicyActor, snapshot: OrganizationSnapshot, teamId: string): boolean {
  return !actor.isSuperAdmin && actor.teamId === teamId && snapshot.teams.some((team) => team.id === teamId && team.leaderId === actor.id);
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
