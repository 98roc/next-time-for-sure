import type { V2Task, V2Milestone } from '@ntfs/contracts';

/** 权限输入来自事务内重新读取的账号和组织，不能采用浏览器提供的角色。 */
export type V2Actor = { id: string; teamId: string | null; disabled: boolean; isSuperAdmin: boolean };
export type V2ProjectAccess = { id: string; teamId: string; teamLeaderId: string; members: { accountId: string; roles: ('project_manager' | 'project_lead' | 'developer')[] }[] };

/** 超管只管理基础组织，不自动获得团队业务权限。 */
export function canViewProject(actor: V2Actor, project: V2ProjectAccess): boolean {
  return !actor.disabled && !actor.isSuperAdmin && actor.teamId === project.teamId && (project.teamLeaderId === actor.id || project.members.some((member) => member.accountId === actor.id));
}

/** 项目经理的查看权限不包含研发编排权限，兼任角色按作用范围合并。 */
export function canManageProject(actor: V2Actor, project: V2ProjectAccess): boolean {
  return canViewProject(actor, project) && (project.teamLeaderId === actor.id || project.members.some((member) => member.accountId === actor.id && member.roles.includes('project_lead')));
}

/** 仅经理不能直接创建或转换正式任务；研发成员只能安排给本人。 */
export function canCreateProjectTask(actor: V2Actor, project: V2ProjectAccess, executorId: string): boolean {
  return canViewProject(actor, project) && project.members.some((member) => member.accountId === executorId) && (canManageProject(actor, project) || (executorId === actor.id && project.members.some((member) => member.accountId === actor.id && member.roles.includes('developer'))));
}

/** 私人内容始终以本人为边界，不受团队管理角色扩张。 */
export function canViewTask(actor: V2Actor, task: V2Task, project?: V2ProjectAccess): boolean {
  if (actor.disabled || actor.isSuperAdmin) return false;
  return task.kind === 'private' ? task.executorId === actor.id : project?.id === task.projectId && project.teamId === task.teamId && canViewProject(actor, project);
}

/** 删除仅检查当前状态，曾经开始过不剥夺创建人回退后的删除权。 */
export function canDeleteTask(actor: V2Actor, task: V2Task, project?: V2ProjectAccess): boolean {
  if (!canViewTask(actor, task, project) || task.deletedAt) return false;
  if (task.kind === 'private') return true;
  return (project !== undefined && canManageProject(actor, project)) || (task.creatorId === actor.id && task.status === 'not_started');
}

/** 执行人或管理者可改项目状态；服务须另外记录实际操作者。 */
export function canChangeTaskStatus(actor: V2Actor, task: V2Task, project?: V2ProjectAccess): boolean {
  return canViewTask(actor, task, project) && !task.deletedAt && (task.executorId === actor.id || (task.kind === 'project' && project !== undefined && canManageProject(actor, project)));
}

/** 里程碑完成和重开仅授予本项目研发负责人，责任归属不限制其他研发负责人。 */
export function canConfirmMilestone(actor: V2Actor, milestone: V2Milestone, project: V2ProjectAccess): boolean {
  return milestone.projectId === project.id && canViewProject(actor, project) && project.members.some((member) => member.accountId === actor.id && member.roles.includes('project_lead'));
}
