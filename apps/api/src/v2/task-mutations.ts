import { notifyTask } from './notifications.js';
import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { V2ProjectTaskInput, V2Task, V2TaskCommand } from '@ntfs/contracts';
import { checkRule, requireProject, requireProjectMember, type V2Context } from './context.js';
import { canCreateProjectTask } from './permissions.js';
import { V2TaskRepository } from './task.repository.js';
import { V2PersonalRepository } from './personal.repository.js';
import { V2PlanningRepository } from './planning.repository.js';
import { V2ProjectRepository } from './project.repository.js';
import { milestoneAfterTaskChange, rearrangeTask, transitionTask, validateMilestoneLink } from './task-rules.js';

/** 共用任务创建服务，供项目、我的工作、周计划批量和待建转换调用。 */
export async function createProjectTask(manager: EntityManager, context: V2Context, input: V2ProjectTaskInput, creatorId = context.actor.id, categoryId?: string, fromBacklog = false): Promise<V2Task> {
  const project = requireProject(context, input.projectId);
  if (!canCreateProjectTask(context.actor, project, input.executorId)) throw new ForbiddenException('没有安排该执行人的权限。');
  requireProjectMember(context, project, input.executorId);
  const periods = await new V2PlanningRepository(manager).periods(project.teamId);
  if (!periods.some((period) => period.id === input.periodId)) throw new ConflictException('日期区间不存在或不属于本团队。');
  if (categoryId && input.executorId !== context.actor.id) throw new ForbiddenException('不能指定他人的个人分类。');
  const personal = new V2PersonalRepository(manager);
  await personal.ensure(input.executorId);
  const category = categoryId ? (await personal.categories(input.executorId)).find((row) => row.id === categoryId) : undefined;
  if (categoryId && !category) throw new ConflictException('个人分类已变化。');
  const status = category?.status ?? 'not_started';
  if (input.milestoneId) {
    const milestone = await new V2ProjectRepository(manager).milestone(input.milestoneId);
    if (!milestone) throw new ConflictException('里程碑不存在。');
    checkRule(() => validateMilestoneLink({ projectId: project.id, status }, milestone));
  }
  const now = new Date().toISOString();
  const task: V2Task = { id: randomUUID(), kind: 'project', teamId: project.teamId, projectId: project.id, creatorId, executorId: input.executorId, milestoneId: input.milestoneId, title: input.title, priority: input.priority, status, version: 0, completedAt: status === 'completed' ? now : null, deletedAt: null, createdAt: now, updatedAt: now };

  // 任务、首个安排、状态事件和个人位置共同提交，任一失败回滚整条任务。
  const tasks = new V2TaskRepository(manager);
  await tasks.insert(task, context.actor.id);
  await tasks.addArrangement(task, input.periodId, input.plannedDays, context.actor.id, now);
  await personal.place(task, undefined, categoryId);
  await notifyTask(manager, context, task, 'created', fromBacklog);
  if (task.status === 'completed') await notifyTask(manager, context, task, 'completed');
  return task;
}

/** 单条任务变更共用事务内规则，批量创建由上层复用 createProjectTask。 */
export async function mutateTask(manager: EntityManager, context: V2Context, command: V2TaskCommand, task?: V2Task): Promise<string[]> {
  const tasks = new V2TaskRepository(manager);
  const personal = new V2PersonalRepository(manager);
  if (command.action === 'create_project') return [(await createProjectTask(manager, context, command.task, context.actor.id, command.categoryId)).id];
  if (command.action === 'create_batch') { const ids: string[] = []; for (const input of command.tasks) ids.push((await createProjectTask(manager, context, input)).id); return ids; }
  if (command.action === 'create_private') {
    await personal.ensure(context.actor.id);
    const category = command.task.categoryId ? (await personal.categories(context.actor.id)).find((row) => row.id === command.task.categoryId) : undefined;
    if (command.task.categoryId && !category) throw new ConflictException('个人分类不存在。');
    const now = new Date().toISOString();
    const status = category?.status ?? 'not_started';
    const created: V2Task = { id: randomUUID(), kind: 'private', teamId: null, projectId: null, creatorId: context.actor.id, executorId: context.actor.id, milestoneId: null, title: command.task.title, priority: command.task.priority, status, completedAt: status === 'completed' ? now : null, deletedAt: null, createdAt: now, updatedAt: now, version: 0 };
    await tasks.insert(created, context.actor.id); await personal.place(created, undefined, command.task.categoryId); return [created.id];
  }
  if (!task || task.deletedAt) throw new NotFoundException('任务已删除或不存在。');
  const now = new Date().toISOString();
  let next: V2Task = { ...task, version: task.version + 1, updatedAt: now };
  switch (command.action) {
    case 'set_status': {
      if (task.status === command.status && !command.categoryId) return [task.id];
      next = { ...checkRule(() => transitionTask(task, command.status, now)), version: task.version + 1, updatedAt: now };
      if (command.categoryId && task.executorId !== context.actor.id) throw new ForbiddenException('不能指定他人的个人分类。');
      if (task.milestoneId) {
        const repository = new V2ProjectRepository(manager), milestone = await repository.milestone(task.milestoneId);
        if (milestone) { const changed = milestoneAfterTaskChange(milestone, task, next); if (changed !== milestone) await repository.saveMilestone(changed, false, context.actor.id); }
      }
      await personal.place(next, task, command.categoryId);
      break;
    }
    case 'update_private': next = { ...next, title: command.title, priority: command.priority }; break;
    case 'update_project': {
      if (task.kind !== 'project') throw new ConflictException('私人任务不能通过编辑转入项目。');
      const project = requireProject(context, task.projectId);
      if (command.executorId !== task.executorId) requireProjectMember(context, project, command.executorId);
      if (command.milestoneId && command.milestoneId !== task.milestoneId) {
        const milestone = await new V2ProjectRepository(manager).milestone(command.milestoneId);
        if (!milestone) throw new ConflictException('里程碑不存在。');
        checkRule(() => validateMilestoneLink(task, milestone));
      }
      next = { ...task, version: task.version + 1, updatedAt: now, title: command.title, executorId: command.executorId, priority: command.priority, milestoneId: command.milestoneId };
      if (next.executorId !== task.executorId) await personal.place(next, task);
      break;
    }
    case 'delete': {
      for (const row of await tasks.arrangements([task.id])) await tasks.removeArrangement(task.id, row.periodId, now);
      await personal.removeTask(task); next = { ...next, deletedAt: now }; break;
    }
    case 'add_arrangement':
    case 'change_arrangement':
    case 'remove_arrangement': {
      if (task.kind !== 'project') throw new ConflictException('私人任务不进入团队安排。');
      const periods = await new V2PlanningRepository(manager).periods(task.teamId);
      const rows = await tasks.arrangements([task.id]);
      const target = command.action === 'change_arrangement' ? command.targetPeriodId : command.periodId;
      if (!periods.some((period) => period.id === target)) throw new ConflictException('目标区间不存在。');
      if (command.action === 'add_arrangement') {
        if (rows.some((row) => row.periodId === target)) throw new ConflictException('该区间已有安排，请直接编辑。');
        await tasks.addArrangement(task, target, command.plannedDays, context.actor.id, now);
      } else {
        checkRule(() => rearrangeTask(rows.map((row) => row.periodId), command.periodId, command.action === 'remove_arrangement' ? null : target));
        if (command.action === 'change_arrangement' && command.periodId === target) await tasks.estimate(task, target, command.plannedDays, context.actor.id, now);
        else {
          await tasks.removeArrangement(task.id, command.periodId, now);
          if (command.action === 'change_arrangement') await tasks.addArrangement(task, target, command.plannedDays, context.actor.id, now);
        }
      }
      break;
    }
  }
  await tasks.update(task, next, context.actor.id, command.action === 'set_status' && task.status !== next.status ? 'status_changed' : command.action === 'delete' ? 'deleted' : 'updated');
  if (task.status !== 'completed' && next.status === 'completed') await notifyTask(manager, context, next, 'completed');
  return [task.id];
}
