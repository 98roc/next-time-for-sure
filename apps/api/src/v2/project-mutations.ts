import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { V2ProjectCommand } from '@ntfs/contracts';
import { requireProject, requireProjectMember, requireVersion, type V2Context } from './context.js';
import { V2ProjectRepository } from './project.repository.js';
import { V2TaskRepository } from './task.repository.js';
import { createProjectTask } from './task-mutations.js';
import { requireTask } from './authorization.js';
import { requireConfirmation } from './impact.js';

/** 已鉴权项目命令在同一事务应用，待建转换保留创建人并记录操作人。 */
export async function mutateProject(manager: EntityManager, context: V2Context, command: V2ProjectCommand, today: string): Promise<string[]> {
  const repository = new V2ProjectRepository(manager);
  if (command.action === 'create_backlog') {
    const id = randomUUID();
    await repository.createBacklog({ id, projectId: command.projectId, creatorId: context.actor.id, title: command.title, priority: command.priority, version: 0, convertedTaskId: null, deletedAt: null }); return [id];
  }
  if ('backlogId' in command) {
    const row = await repository.backlogItem(command.backlogId);
    if (!row || row.convertedTaskId || row.deletedAt) throw new ConflictException('待建任务已转换或不存在，请刷新。');
    requireVersion(row.version, command.version);
    if (command.action === 'edit_backlog') await repository.editBacklog(row.id, command.title, command.priority);
    else if (command.action === 'delete_backlog') {
      await requireConfirmation(manager, context, { action: command.action, backlogId: row.id, version: command.version }, command.confirmation, today);
      await repository.deleteBacklog(row.id);
    } else {
      const task = await createProjectTask(manager, context, command.task, row.creatorId);
      await repository.convertBacklog(row.id, task.id, context.actor.id); return [task.id];
    }
    return [row.id];
  }
  if (command.action === 'unlink_milestone') {
    await requireConfirmation(manager, context, { action: command.action, taskId: command.taskId, version: command.version }, command.confirmation, today);
    const tasks = new V2TaskRepository(manager), task = requireTask(context, await tasks.get(command.taskId));
    if (task.deletedAt || task.kind !== 'project') throw new ConflictException('只能解除有效项目任务关联。');
    await tasks.update(task, { ...task, milestoneId: null, version: task.version + 1, updatedAt: new Date().toISOString() }, context.actor.id);
    return [task.id];
  }
  if (command.action === 'create_milestone') {
    requireProjectMember(context, requireProject(context, command.projectId), command.ownerId);
    const id = randomUUID();
    await repository.saveMilestone({ id, projectId: command.projectId, ownerId: command.ownerId, title: command.title, expectedOn: command.expectedOn, status: 'open', needsReview: false, version: 0 }, true, context.actor.id); return [id];
  }
  const milestone = await repository.milestone(command.milestoneId);
  if (!milestone) throw new ConflictException('里程碑不存在。');
  requireVersion(milestone.version, command.version);
  if (command.action === 'edit_milestone') {
    if (milestone.ownerId !== command.ownerId) requireProjectMember(context, requireProject(context, milestone.projectId), command.ownerId);
    await repository.saveMilestone({ ...milestone, title: command.title, expectedOn: command.expectedOn, ownerId: command.ownerId, version: milestone.version + 1 }, false, context.actor.id);
  } else {
    await requireConfirmation(manager, context, { action: command.action, milestoneId: milestone.id, version: command.version }, command.confirmation, today);
    await repository.saveMilestone({ ...milestone, status: command.action === 'complete_milestone' ? 'completed' : 'open', needsReview: false, version: milestone.version + 1 }, false, context.actor.id);
  }
  return [milestone.id];
}
