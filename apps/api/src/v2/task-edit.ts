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
import { V2PlanningLabelsRepository } from './planning-labels.repository.js';
import { V2PlanningRepository } from './planning.repository.js';

/** 编辑字段分别鉴权；只读执行人不能利用合并保存获得项目管理权限。 */
export function authorizeEdit(context: V2Context, task: V2Task, command: V2TaskEdit): void {
  const base = { operationId: command.operationId, taskId: task.id, version: command.version };
  if (command.details) {
    const { kind, ...fields } = command.details;
    if (kind !== task.kind) throw new ConflictException('不能通过编辑改变任务类型。');
    if (command.details.kind === 'project') authorizeTaskCommand(context, { ...base, ...command.details, action: 'update_project' }, task);
    else authorizeTaskCommand(context, { ...base, ...fields, action: 'update_private' }, task);
  }
  // 备注与执行状态共用执行人/管理者权限；空串是清空请求，也必须鉴权。
  if (command.remark !== undefined || command.status || command.categoryId || command.completion || command.arrangements || command.planningLabels) authorizeTaskCommand(context, { ...base, action: 'set_status', status: command.status ?? task.status }, task);
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
  if (command.remark !== undefined) next = { ...next, remark: command.remark };

  // 先保存最终安排，再校验标签补丁只指向仍有效的周期；任何失败由外层事务整体回滚。
  const planningChanges = command.arrangements ? await saveArrangements(manager, context, task, command.arrangements, command.arrangementConfirmation, now) : [];
  if (command.planningLabels) {
    if (task.kind !== 'project' || command.arrangement) throw new ConflictException('计划外标签仅用于项目任务的有效周期，请分开提交单条改期。');
    const periods = await new V2PlanningRepository(manager).periods(task.teamId), rows = await tasks.arrangements([task.id]);
    const labels = new V2PlanningLabelsRepository(manager);
    for (const patch of command.planningLabels) {
      const period = periods.find((row) => row.id === patch.periodId);
      const arrangement = command.arrangements?.find((row) => row.periodId === patch.periodId);
      if (!period || !rows.some((row) => row.periodId === patch.periodId) || (arrangement?.unplanned !== undefined && arrangement.unplanned !== patch.unplanned)) throw new ConflictException('标签周期不存在、已取消或提交的标签值冲突。');
      const change = await labels.save(task, period, patch.unplanned, context.actor.id, now);
      if (change) planningChanges.push(change);
    }
  }
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
  await tasks.update(task, next, context.actor.id, task.status !== next.status ? 'status_changed' : (task.completedAt !== next.completedAt || task.startedAt !== next.startedAt) ? 'completion_corrected' : 'updated', planningChanges);
  if (planningChanges.some((row) => row.after)) await notifyTask(manager, context, next, 'planning', planningChanges.filter((row) => row.after).map((row) => row.periodId));
  if (task.status !== 'completed' && next.status === 'completed') await notifyTask(manager, context, next, 'completed');
  if (command.arrangement) await mutateTask(manager, context, { ...command.arrangement, operationId: command.operationId, action: 'change_arrangement', taskId: task.id, version: next.version }, next);
}
