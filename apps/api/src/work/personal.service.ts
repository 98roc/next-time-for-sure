import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PersonalCommand, PersonalItem, PersonalSnapshot } from '@ntfs/contracts';
import type { EntityManager } from 'typeorm';
import { DatabaseService } from '../database/database.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { IdentityRepository } from '../identity/identity.repository.js';
import { digest } from '../identity/password.js';
import { activeProject, loadWorkAccess, projectAccess } from './work-access.js';
import type { WorkAccess } from './work-access.js';
import { PersonalRepository } from './personal.repository.js';
import { canViewPersonal } from './personal-policy.js';
import { AssignmentRepository } from './assignment.repository.js';
import { WorkRepository } from './work.repository.js';
import { ensureParentActive } from './task.service.js';
import { hasPermission } from '../organization/policy.js';
import { notifyLateProgress } from '../notifications/progress-notifications.js';

/** 个人任务内容及实际执行只由本人维护，角色配置不能突破此边界。 */
@Injectable()
export class PersonalService {
  constructor(private readonly database: DatabaseService, private readonly identity: IdentityService) {}

  /** 先按私人边界和当前角色裁剪，再读取已授权事项的进展。 */
  async snapshot(token: string, scope: 'mine' | 'visible'): Promise<PersonalSnapshot> {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token);
      const repository = new PersonalRepository(manager);
      const candidates = await repository.candidates(access.actor.id, scope === 'mine' ? null : access.actor.teamId);
      const visible = candidates.filter((item) => canViewPersonal(access, item));
      const items: PersonalItem[] = [];
      for (const item of visible) items.push({ ...item, categoryId: item.ownerId === access.actor.id ? item.categoryId : null, stopReason: await stopReason(manager, item) });
      return { items, categories: await repository.categories(access.actor.id), progress: await repository.progressFor(items.map((item) => item.id)) };
    });
  }

  /** 个人变更历史仅供本人查询，禁止通过历史绕过私人隔离。 */
  async history(token: string, itemId: string) {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token);
      const repository = new PersonalRepository(manager);
      const item = await repository.item(itemId);
      if (!item || item.ownerId !== access.actor.id || !canViewPersonal(access, item)) throw new ForbiddenException('仅本人可查看当前有权访问的个人事项历史。');
      return repository.history(access.actor.id, itemId);
    });
  }

  /** 保存内容、状态及个人历史，关联规则和执行限制在同一事务内核验。 */
  async execute(token: string, csrf: string, command: PersonalCommand): Promise<{ objectId: string }> {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token, csrf);
      const repository = new PersonalRepository(manager);
      const item = 'itemId' in command ? await repository.item(command.itemId) : undefined;
      if (command.action === 'manage_link') {
        if (!item || item.kind !== 'work' || !item.projectId || !canViewPersonal(access, item)) throw new ForbiddenException('无权管理该工作关联。');
        const project = access.organization.projects.find((entry) => entry.id === item.projectId && entry.teamId === access.actor.teamId);
        if (!project) throw new ForbiddenException('无权管理其他团队的关联。');
        const assignments = new AssignmentRepository(manager);
        const canManage = (groupId: string | null) => hasPermission(access.actor, access.organization, 'work.assign', { teamId: project.teamId, groupId });
        if (item.assignmentId) {
          const original = await assignments.assignment(item.assignmentId);
          if (!original || !canManage(original.groupId)) throw new ForbiddenException('没有原负责小组的安排权限。');
        } else if (!canManage(null) && !access.organization.groups.some((group) => group.memberIds.includes(item.ownerId) && canManage(group.id))) throw new ForbiddenException('没有该成员所属小组的安排权限。');
        if (item.version !== command.version) throw new ConflictException('个人关联已变化，请刷新。');
        if (await stopReason(manager, item)) throw new ConflictException('原工作已停止，不能通过更换关联绕过执行限制。');
        if (command.assignmentId) {
          const target = await assignments.assignment(command.assignmentId);
          if (!target || target.accountId !== item.ownerId || !canManage(target.groupId)) throw new ForbiddenException('只能关联该成员本人且有权管理的目标分工。');
          const task = await assignments.task(target.taskId);
          if (!task || task.projectId !== item.projectId || ['completed', 'cancelled'].includes(task.status) || ['completed', 'exited', 'transferred'].includes(target.status) || await assignments.hasChildren(task.id)) throw new ConflictException('目标必须是同项目可执行的未完成分工。');
          await ensureParentActive(manager, task);
        }
        await repository.link(item.id, command.assignmentId);
        await repository.event(item.ownerId, item.id, 'manage_link', { actorId: access.actor.id, beforeAssignmentId: item.assignmentId, assignmentId: command.assignmentId });
        await new WorkRepository(manager).event(item.projectId, item.id, access.actor.id, 'personal.link_managed', { itemId: item.id, ownerId: item.ownerId, beforeAssignmentId: item.assignmentId, assignmentId: command.assignmentId });
        await new IdentityRepository(manager).audit(access.actor.id, 'personal.link_managed', item.id);
        return { objectId: item.id };
      }
      if ('itemId' in command && (!item || item.ownerId !== access.actor.id || !canViewPersonal(access, item))) throw new ForbiddenException('仅本人可修改当前有权访问的个人事项。');
      const categories = await repository.categories(access.actor.id);
      const category = 'categoryId' in command && command.categoryId ? categories.find((entry) => entry.id === command.categoryId) : undefined;
      if ('categoryId' in command && command.categoryId && !category) throw new ForbiddenException('只能使用本人的分类。');
      const history = new WorkRepository(manager);
      const hash = digest(JSON.stringify(command));
      if ('operationId' in command) {
        const previous = await history.operation(access.actor.id, command.operationId);
        if (previous) { if (previous.hash !== hash) throw new ConflictException('操作标识已用于其他内容。'); return { objectId: previous.objectId }; }
      }
      if ('version' in command && (item?.version ?? category?.version) !== command.version) throw new ConflictException('内容已变化，请刷新后操作。');
      let objectId = item?.id ?? category?.id ?? '';
      if (command.action === 'create_personal') {
        if (command.kind === 'private') {
          if (command.projectId || command.assignmentId) throw new BadRequestException('私人事项不能关联团队项目或分工。');
        } else {
          if (!command.projectId) throw new BadRequestException('工作事项必须选择项目。');
          projectAccess(access, command.projectId);
          activeProject(access, command.projectId);
          if (command.assignmentId) await validateLink(manager, access, command.projectId, command.assignmentId, true);
        }
        objectId = await repository.create(access.actor.id, command);
      } else if (command.action === 'create_category') objectId = await repository.createCategory(access.actor.id, command.name);
      else if (command.action === 'rename_category') await repository.renameCategory(command.categoryId, command.name);
      else if (command.action === 'delete_category') await repository.deleteCategory(command.categoryId);
      else {
        if (!item) throw new NotFoundException('事项不存在。');
        const stopped = await stopReason(manager, item);
        switch (command.action) {
          case 'edit_personal':
            if (stopped && command.checklist.some((entry) => !item.checklist.some((before) => before.id === entry.id))) throw new ConflictException('关联工作已停止，仅可整理已有检查项，不能增加执行工作。');
            await repository.edit(command); break;
          case 'link_personal':
            if (item.kind === 'private' || !item.projectId) throw new BadRequestException('私人事项不能关联团队分工。');
            if (stopped && item.assignmentId !== command.assignmentId) throw new ConflictException('停止执行后不能通过解除或更换关联继续工作。');
            projectAccess(access, item.projectId);
            if (command.assignmentId) await validateLink(manager, access, item.projectId, command.assignmentId, item.status !== 'completed');
            await repository.link(item.id, command.assignmentId); break;
          case 'start_personal':
            if (item.status === 'in_progress' && !stopped) throw new ConflictException('事项已在进行中。');
            if (item.kind === 'work' && item.projectId) {
              projectAccess(access, item.projectId);
              activeProject(access, item.projectId);
              if (item.assignmentId) await validateLink(manager, access, item.projectId, item.assignmentId, true);
            }
            await repository.transition(item.id, 'in_progress'); break;
          case 'complete_personal':
            if (item.status === 'completed') throw new ConflictException('事项已完成。');
            await repository.transition(item.id, 'completed'); break;
          case 'personal_progress': objectId = await repository.addProgress(command); break;
          case 'personal_times':
            if (command.startedAt && command.endedAt && Date.parse(command.startedAt) > Date.parse(command.endedAt)) throw new BadRequestException('结束时间不能早于开始。');
            await repository.times(item.id, command.startedAt, command.endedAt); break;
          case 'move_personal': await repository.move(item.id, command.categoryId, command.position); break;
          case 'insert_personal': {
            const column = (await repository.candidates(access.actor.id, null)).filter((entry) => canViewPersonal(access, entry) && entry.categoryId === command.categoryId && entry.id !== item.id);
            if (column.length !== command.order.length || column.some((entry, index) => entry.id !== command.order[index]?.id || entry.version !== command.order[index]?.version)) throw new ConflictException('目标分类已变化，请刷新后重新排序。');
            if (command.beforeId && !column.some((entry) => entry.id === command.beforeId)) throw new BadRequestException('插入目标必须是该分类内的其他事项。');
            const ordered = [...column];
            ordered.splice(command.beforeId ? ordered.findIndex((entry) => entry.id === command.beforeId) : ordered.length, 0, item);
            for (const [index, entry] of ordered.entries()) if (entry.position !== index || entry.categoryId !== command.categoryId) await repository.move(entry.id, command.categoryId, index);
            break;
          }
        }
      }
      const target = item?.id ?? objectId;
      const after = await repository.item(target);
      await repository.event(access.actor.id, target, command.action, { ...command, resultId: objectId, before: item ?? category ?? null, after: after ?? null });
      await new IdentityRepository(manager).audit(access.actor.id, command.action, target);
      if (command.action === 'personal_progress' && item?.kind === 'work' && item.projectId) await notifyLateProgress(manager, item.projectId, command.reportWeek, objectId);
      if ('operationId' in command) await history.recordOperation(access.actor.id, command.operationId, hash, objectId);
      return { objectId };
    });
  }
}

/** 停止执行是派生提示，不改写本人状态或伪造完成时间。 */
async function stopReason(manager: EntityManager, item: PersonalItem): Promise<string | null> {
  if (item.projectId && await new PersonalRepository(manager).archived(item.projectId)) return '所属项目已归档';
  if (!item.assignmentId) return null;
  const repository = new AssignmentRepository(manager);
  const assignment = await repository.assignment(item.assignmentId);
  if (!assignment) return '关联分工不可用';
  const task = await repository.task(assignment.taskId);
  if (!task || ['completed', 'cancelled'].includes(task.status)) return '关联团队任务已结束或取消';
  if (task.parentId) { const parent = await repository.task(task.parentId); if (!parent || ['completed', 'cancelled'].includes(parent.status)) return '关联父任务已结束或取消'; }
  if (assignment.status === 'completed') return '关联分工已完成';
  if (['exited', 'transferred'].includes(assignment.status)) return '关联分工已退出或转交';
  return null;
}

/** 关联本人同项目分工；新增或恢复执行可恢复本人未完成责任，不传播时间。 */
async function validateLink(manager: EntityManager, access: WorkAccess, project: string, id: string, reopen: boolean): Promise<void> {
  const repository = new AssignmentRepository(manager);
  const assignment = await repository.assignment(id);
  if (!assignment || assignment.accountId !== access.actor.id) throw new ForbiddenException('只能关联本人分工。');
  const task = await repository.task(assignment.taskId);
  if (!task || task.projectId !== project) throw new BadRequestException('只能关联同一项目的分工。');
  await ensureParentActive(manager, task);
  if (['completed', 'cancelled'].includes(task.status) || ['exited', 'transferred'].includes(assignment.status) || await repository.hasChildren(task.id)) throw new ConflictException('关联范围已停止执行或已拆分，不能新增或恢复工作。');
  if (reopen && assignment.status === 'completed') {
    await repository.restoreUnfinished(assignment.id);
    await new WorkRepository(manager).event(project, assignment.id, access.actor.id, 'assignment.restored_by_personal', { before: assignment, after: await repository.assignment(assignment.id) });
  }
}
