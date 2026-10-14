import type { PersonalItem } from '@ntfs/contracts';
import type { WorkAccess } from './work-access.js';

/** 私人事项只对本人开放；工作查看合并团队、项目与研发小组范围。 */
export function canViewPersonal(access: WorkAccess, item: PersonalItem): boolean {
  if (item.kind === 'private') return item.ownerId === access.actor.id;
  if (!access.actor.teamId) return false;
  const project = access.organization.projects.find((entry) => entry.id === item.projectId && entry.teamId === access.actor.teamId);
  const owner = access.organization.accounts.find((entry) => entry.id === item.ownerId && entry.teamId === access.actor.teamId);
  if (!project) return false;
  if (item.ownerId === access.actor.id) return true;
  if (access.organization.teams.some((team) => team.id === access.actor.teamId && team.leaderId === access.actor.id)) return true;
  const roles = project.members.find((entry) => entry.accountId === access.actor.id)?.roles ?? [];
  if (roles.includes('project_lead') || roles.includes('developer')) return true;
  if (!owner) return false;
  const groups = access.organization.groups.filter((group) => group.teamId === access.actor.teamId && group.memberIds.includes(item.ownerId));
  if (groups.some((group) => group.leaderId === access.actor.id)) return true;
  const developer = access.organization.projects.some((entry) => entry.teamId === access.actor.teamId && entry.members.some((member) => member.accountId === access.actor.id && (member.roles.includes('developer') || member.roles.includes('project_lead'))));
  return developer && groups.some((group) => group.memberIds.includes(access.actor.id));
}
