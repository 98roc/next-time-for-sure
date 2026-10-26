import { reconcileCompletion } from './completion-time.js';
import { notifyTask } from './notifications.js';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { V2Task, V2TaskEdit } from '@ntfs/contracts';
import { authorizeTaskCommand } from './authorization.js';
import { checkRule, requireProject, requireProjectMember, type V2Context } from './context.js';
import { V2TaskRepository } from './task.repository.js';
import { V2PersonalRepository } from './personal.repository.js';
import { V2ProjectRepository } from './project.repository.js';
import { milestoneAfterTaskChange, transitionTask, validateMilestoneLink } from './task-rules.js';
import { mutateTask } from './task-mutations.js';
import { applyCompletion } from './task-completion.js';
import { saveArrangements } from './task-arrangements.js';

/** 编辑字段分别鉴权；只读执行人不能利用合并保存获得项目管理权限。 */
export function authorizeEdit(context: V2Context, task: V2Task, command: V2TaskEdit): void {
  const base = { operationId: command.operationId, taskId: task.id, version: command.version };
  if (command.details) {
    const { kind, ...fields } = command.details;
    if (kind !== task.kind) throw new ConflictException('不能通过编辑改变任务类型。');
    if (command.details.kind === 'project') authorizeTaskCommand(context, { ...base, ...command.details, action: 'update_project' }, task);
    else authorizeTaskCommand(context, { ...base, ...fields, action: 'update_private' }, task);
  }
  if (command.status || command.categoryId || command.completion || command.arrangements) authorizeTaskCommand(context, { ...base, action: 'set_status', status: command.status ?? task.status }, task);
  if (command.arrangement && command.arrangements) throw new ConflictException('不能同时提交单条和全量安排。');
  if (command.arrangementConfirmation) authorizeTaskCommand(context, { ...base, action: 'add_arrangement', periodId: command.arrangements?.[0]?.periodId ?? task.id, plannedDays: null }, task);
  if (command.categoryId && (command.details?.kind === 'project' ? command.details.executorId : task.executorId) !== context.actor.id) throw new ForbiddenException('不能指定他人的个人分类。');
  if (command.arrangement) authorizeTaskCommand(context, { ...base, ...command.arrangement, action: 'change_arrangement' }, task);
}

/** 合并编辑先构造最终状态，再检查里程碑与个人位置；任何安排失败回滚整次保存。 */
export async function saveTask(manager: EntityManager, context: V2Context, task: V2Task, command: V2TaskEdit): Promise<void> {
  if (task.deletedAt) throw new ConflictException('任务已删除。');
  const now = new Date().toISOString(), personal = new V2PersonalRepository(manager), projects = new V2ProjectRepository(manager), tasks = new V2TaskRepository(manager);
  let next = checkRule(() => applyCompletion(transitionTask(task, command.status ?? task.status, now), task.status, command.completion));
  if (command.arrangements) await saveArrangements(manager, context, task, command.arrangements, command.arrangementConfirmation, now);
  if (command.details?.kind === 'project' && next.kind === 'project') {
    if (command.details.executorId !== task.executorId) requireProjectMember(context, requireProject(context, next.projectId), command.details.executorId);
    next = { ...next, title: command.details.title, priority: command.details.priority, executorId: command.details.executorId, milestoneId: command.details.milestoneId };
    if (next.milestoneId && next.milestoneId !== task.milestoneId) {
      const milestone = await projects.milestone(next.milestoneId);
      if (!milestone) throw new ConflictException('里程碑不存在。');
      const finalTask = next; checkRule(() => validateMilestoneLink(finalTask, milestone));
    }
  } else if (command.details?.kind === 'private' && next.kind === 'private') next = { ...next, title: command.details.title, priority: command.details.priority };
  if (task.milestoneId && next.milestoneId === task.milestoneId) {
    const milestone = await projects.milestone(task.milestoneId);
    if (milestone) { const changed = milestoneAfterTaskChange(milestone, task, next); if (changed !== milestone) await projects.saveMilestone(changed, false, context.actor.id); }
  }
  next = { ...next, version: task.version + 1, updatedAt: now };
  await reconcileCompletion(manager, task, next, now);
  await personal.place(next, task, command.categoryId);
  await tasks.update(task, next, context.actor.id, task.status !== next.status ? 'status_changed' : task.completedAt !== next.completedAt ? 'completion_corrected' : 'updated');
  if (task.status !== 'completed' && next.status === 'completed') await notifyTask(manager, context, next, 'completed');
  if (command.arrangement) await mutateTask(manager, context, { ...command.arrangement, operationId: command.operationId, action: 'change_arrangement', taskId: task.id, version: next.version }, next);
}
