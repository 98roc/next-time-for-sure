import { ForbiddenException } from '@nestjs/common';
import type { WorkAccess } from '../work/work-access.js';
import { hasPermission } from '../organization/policy.js';
import type { ReportSource } from '@ntfs/contracts';

/** 正式发布只对当前团队开放，超管没有隐式业务访问。 */
export function assertTeam(access: WorkAccess, team: string) { if (access.actor.teamId !== team) throw new ForbiddenException('没有该团队的访问权限。'); }
/** 发布是团队负责人固定职责，同时检查预设操作权限。 */
export function canPublish(access: WorkAccess, team: string) { return access.actor.teamId === team && access.organization.teams.some((entry) => entry.id === team && entry.leaderId === access.actor.id) && hasPermission(access.actor, access.organization, 'reports.publish', { teamId: team }); }
/** 关联工作按原负责小组管理，独立工作按成员所属组管理。 */
export function canEditSource(access: WorkAccess, team: string, source: Pick<ReportSource, 'groupId' | 'ownerId'> & Partial<Pick<ReportSource, 'taskId'>>) {
  if (hasPermission(access.actor, access.organization, 'work.assign', { teamId: team })) return true;
  if (source.groupId) return hasPermission(access.actor, access.organization, 'work.assign', { teamId: team, groupId: source.groupId });
  // 关联任务但没有负责小组表示团队直属，不能退回到执行人的所属组授权。
  if (source.taskId) return false;
  return access.organization.groups.some((group) => group.memberIds.includes(source.ownerId ?? '') && hasPermission(access.actor, access.organization, 'work.assign', { teamId: team, groupId: group.id }));
}
