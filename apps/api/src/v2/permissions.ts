import type { V2Task, V2Milestone } from '@ntfs/contracts';

/** 权限输入来自事务内重新读取的账号和组织，不能采用浏览器提供的角色。 */
export type V2Actor = { id: string; teamId: string | null; disabled: boolean; isSuperAdmin: boolean };
export type V2ProjectAccess = { id: string; teamId: string; teamLeaderId: string; members: { accountId: string; roles: ('project_manager' | 'project_lead' | 'developer')[] }[] };

/** 系统管理员可操作所有项目；普通账号仍须具有当前团队或项目职责。 */
export function canParticipateProject(actor: V2Actor, project: V2ProjectAccess): boolean {
  return !actor.disabled && (actor.isSuperAdmin || (actor.teamId === project.teamId && (project.teamLeaderId === actor.id || project.members.some((member) => member.accountId === actor.id))));
}

/** 系统管理员可跨团队读取项目，普通账号仍按当前团队和项目关系裁剪。 */
export function canViewProject(actor: V2Actor, project: V2ProjectAccess): boolean {
  return !actor.disabled && (actor.isSuperAdmin || canParticipateProject(actor, project));
}

/** 项目经理的查看权限不包含研发编排权限，兼任角色按作用范围合并。 */
export function canManageProject(actor: V2Actor, project: V2ProjectAccess): boolean {
  return canParticipateProject(actor, project) && (actor.isSuperAdmin || project.teamLeaderId === actor.id || project.members.some((member) => member.accountId === actor.id && member.roles.includes('project_lead')));
}

/** 管理员可安排本人或项目成员；普通研发成员只能安排本人，经理不能编排。 */
export function canCreateProjectTask(actor: V2Actor, project: V2ProjectAccess, executorId: string): boolean {
  const executorAllowed = project.members.some((member) => member.accountId === executorId) || (actor.isSuperAdmin && executorId === actor.id);
  return canParticipateProject(actor, project) && executorAllowed && (canManageProject(actor, project) || (executorId === actor.id && project.members.some((member) => member.accountId === actor.id && member.roles.includes('developer'))));
}

/** 私人内容始终以本人为边界，不受团队管理角色扩张。 */
export function canViewTask(actor: V2Actor, task: V2Task, project?: V2ProjectAccess): boolean {
  if (actor.disabled) return false;
  return task.kind === 'private' ? task.executorId === actor.id : project?.id === task.projectId && project.teamId === task.teamId && canViewProject(actor, project);
}

/** 删除仅检查当前状态，曾经开始过不剥夺创建人回退后的删除权。 */
export function canDeleteTask(actor: V2Actor, task: V2Task, project?: V2ProjectAccess): boolean {
  if (!canViewTask(actor, task, project) || task.deletedAt) return false;
  if (task.kind === 'private') return true;
  if (!project || !canParticipateProject(actor, project)) return false;
  return (project !== undefined && canManageProject(actor, project)) || (task.creatorId === actor.id && task.status === 'not_started');
}

/** 执行人或管理者可改项目状态；服务须另外记录实际操作者。 */
export function canChangeTaskStatus(actor: V2Actor, task: V2Task, project?: V2ProjectAccess): boolean {
  return canViewTask(actor, task, project) && !task.deletedAt && (task.kind === 'private' || (project !== undefined && canParticipateProject(actor, project))) && (task.executorId === actor.id || (task.kind === 'project' && project !== undefined && canManageProject(actor, project)));
}

/** 系统管理员或本项目研发负责人可以确认里程碑，仍须满足完成条件。 */
export function canConfirmMilestone(actor: V2Actor, milestone: Pick<V2Milestone, 'projectId'>, project: V2ProjectAccess): boolean {
  return milestone.projectId === project.id && canParticipateProject(actor, project) && (actor.isSuperAdmin || project.members.some((member) => member.accountId === actor.id && member.roles.includes('project_lead')));
}
