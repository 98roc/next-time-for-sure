import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { V2ProjectCommand, V2Task, V2TaskCommand } from '@ntfs/contracts';
import { requireProject, requireProjectMember, type V2Context } from './context.js';
import { canChangeTaskStatus, canConfirmMilestone, canCreateProjectTask, canManageProject, canViewTask } from './permissions.js';
import { V2ProjectRepository } from './project.repository.js';
import { V2TaskRepository } from './task.repository.js';

/** 单任务读写入口统一鉴权；不存在和越权使用相同反馈，不泄露私人任务名称。 */
export function requireTask(context: V2Context, task: V2Task | undefined): V2Task {
  if (!task || !canViewTask(context.actor, task, context.projects.find((project) => project.id === task.projectId))) throw new NotFoundException('任务不存在或无权访问。');
  return task;
}

/** 权限检查先于幂等读取；删除重试允许读保留记录，但实际变更仍检查删除状态。 */
export function authorizeTaskCommand(context: V2Context, command: V2TaskCommand, task?: V2Task): void {
  if (command.action === 'create_private') return;
  if (command.action === 'create_project' || command.action === 'create_batch') {
    for (const input of command.action === 'create_batch' ? command.tasks : [command.task]) {
      const project = requireProject(context, input.projectId);
      if (!canCreateProjectTask(context.actor, project, input.executorId)) throw new ForbiddenException('没有创建或安排该任务的权限。');
      requireProjectMember(context, project, input.executorId);
    }
    return;
  }
  const existing = requireTask(context, task);
  const project = context.projects.find((row) => row.id === existing.projectId);
  const manage = project !== undefined && canManageProject(context.actor, project);
  if (command.action === 'delete') {
    if (existing.kind === 'private' || manage || (existing.creatorId === context.actor.id && existing.status === 'not_started')) return;
  } else if (command.action === 'set_status') {
    if (canChangeTaskStatus(context.actor, existing, project)) return;
  } else if (command.action === 'update_private') {
    if (existing.kind === 'private') return;
  } else if (existing.kind === 'project' && manage) return;
  throw new ForbiddenException('没有当前任务操作权限。');
}

/** 待建创建人和项目研发角色分别授权；里程碑确认仅研发负责人。 */
export async function authorizeProjectCommand(manager: EntityManager, context: V2Context, command: V2ProjectCommand): Promise<string> {
  const repository = new V2ProjectRepository(manager);
  const backlog = 'backlogId' in command ? await repository.backlogItem(command.backlogId) : undefined;
  const milestone = 'milestoneId' in command ? await repository.milestone(command.milestoneId) : undefined;
  const task = 'taskId' in command ? requireTask(context, await new V2TaskRepository(manager).get(command.taskId)) : undefined;
  const projectId = 'projectId' in command ? command.projectId : backlog?.projectId ?? milestone?.projectId ?? task?.projectId;
  if (!projectId) throw new NotFoundException('对象不存在或无权访问。');
  const project = requireProject(context, projectId);
  const manage = canManageProject(context.actor, project);
  if (command.action === 'create_backlog') return projectId;
  if (command.action === 'convert_backlog' && command.task.projectId === projectId && canCreateProjectTask(context.actor, project, command.task.executorId)) { requireProjectMember(context, project, command.task.executorId); return projectId; }
  if ((command.action === 'edit_backlog' || command.action === 'delete_backlog') && (manage || backlog?.creatorId === context.actor.id)) return projectId;
  if ((command.action === 'complete_milestone' || command.action === 'reopen_milestone') && milestone && canConfirmMilestone(context.actor, milestone, project)) return projectId;
  if (['create_milestone', 'edit_milestone', 'unlink_milestone'].includes(command.action) && manage) return projectId;
  throw new ForbiddenException('没有此项项目操作权限。');
}
