import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { PersonalItem, PersonalSnapshot, PersonalStatus } from '@ntfs/contracts';
import type { EntityManager } from 'typeorm';
import { activeProject, projectAccess } from './work-access.js';
import type { WorkAccess } from './work-access.js';
import { AssignmentRepository } from './assignment.repository.js';
import { PersonalRepository } from './personal.repository.js';
import { WorkRepository } from './work.repository.js';
import { ensureParentActive } from './task.service.js';
import { IdentityRepository } from '../identity/identity.repository.js';

/** 自动流转只在唯一目标时成立；多个分类必须由调用者明确选择。 */
export function targetCategory(categories: PersonalSnapshot['categories'], status: PersonalStatus, id?: string | null) {
  const candidates = categories.filter((entry) => entry.status === status);
  if (id) {
    const category = categories.find((entry) => entry.id === id);
    if (!category) throw new ForbiddenException('只能使用本人的分类。');
    if (category.status !== status) throw new BadRequestException('所选分类与目标状态不一致。');
    return category;
  }
  if (candidates.length !== 1) throw new ConflictException('该状态有多个分类，请选择目标分类。');
  const category = candidates[0];
  if (!category) throw new ConflictException('请先建立目标状态的分类。');
  return category;
}

/** 关联校验用于新增及恢复执行；整体结束与转交不能由个人操作绕过。 */
export async function validateLink(manager: EntityManager, access: WorkAccess, project: string, id: string, reopen: boolean): Promise<void> {
  const repository = new AssignmentRepository(manager);
  const assignment = await repository.assignment(id);
  if (!assignment || assignment.accountId !== access.actor.id) throw new ForbiddenException('只能关联本人分工。');
  const task = await repository.task(assignment.taskId);
  if (!task || task.projectId !== project) throw new BadRequestException('只能关联同一项目的分工。');
  await ensureParentActive(manager, task);
  if (['completed', 'cancelled'].includes(task.status) || ['exited', 'transferred'].includes(assignment.status) || await repository.hasChildren(task.id)) throw new ConflictException('关联范围已停止执行或已拆分，不能新增或恢复工作。');
  if (reopen && assignment.status === 'completed') {
    await repository.transition(assignment.id, 'in_progress');
    await new WorkRepository(manager).event(project, assignment.id, access.actor.id, 'assignment.restored_by_personal', { before: assignment, after: await repository.assignment(assignment.id) });
  }
}

/** 个人状态变化与分工联动共用当前事务和组织锁，不按数量推算团队整体进度。 */
export async function transitionPersonal(manager: EntityManager, access: WorkAccess, item: PersonalItem, status: PersonalStatus, category: string, position?: number): Promise<void> {
  if (status !== 'completed' && item.projectId) {
    projectAccess(access, item.projectId);
    activeProject(access, item.projectId);
    if (item.assignmentId) await validateLink(manager, access, item.projectId, item.assignmentId, true);
  }
  await new PersonalRepository(manager).transition(item.id, status, category, position);
  await syncPersonalAssignment(manager, access, { ...item, status });
}

/** 只有真实完成动作才能结束分工；删除、解除关联、普通归类不调用此方法。 */
export async function syncPersonalAssignment(manager: EntityManager, access: WorkAccess, item: PersonalItem): Promise<void> {
  if (!item.assignmentId || !item.projectId) return;
  const repository = new AssignmentRepository(manager);
  const assignment = await repository.assignment(item.assignmentId);
  if (!assignment || assignment.accountId !== access.actor.id || ['completed', 'exited', 'transferred'].includes(assignment.status)) return;
  const task = await repository.task(assignment.taskId);
  const project = access.organization.projects.find((entry) => entry.id === item.projectId);
  if (!task || project?.archived || ['completed', 'cancelled'].includes(task.status) || await repository.hasChildren(task.id)) return;
  if (task.parentId) { const parent = await repository.task(task.parentId); if (!parent || ['completed', 'cancelled'].includes(parent.status)) return; }
  const linked = await new PersonalRepository(manager).linked(assignment.id);
  const status = item.status === 'completed' && linked.length > 0 && linked.every((entry) => entry.status === 'completed') ? 'completed'
    : linked.some((entry) => entry.status !== 'not_started') && assignment.status === 'not_started' ? 'in_progress' : null;
  if (!status) return;
  await repository.transition(assignment.id, status);
  await new WorkRepository(manager).event(item.projectId, assignment.id, access.actor.id, `assignment.${status}_by_personal`, { itemId: item.id, before: assignment, after: await repository.assignment(assignment.id) });
  await new IdentityRepository(manager).audit(access.actor.id, `assignment.${status}_by_personal`, assignment.id);
}
