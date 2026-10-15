import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PersonalCommand, PersonalItem, PersonalSnapshot, PersonalTeamWork } from '@ntfs/contracts';
import type { EntityManager } from 'typeorm';
import { DatabaseService } from '../database/database.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { IdentityRepository } from '../identity/identity.repository.js';
import { digest } from '../identity/password.js';
import { activeProject, loadWorkAccess, projectAccess } from './work-access.js';
import { targetCategory, transitionPersonal, syncPersonalAssignment, validateLink } from './personal-workflow.js';
import { PersonalRepository } from './personal.repository.js';
import { canViewPersonal } from './personal-policy.js';
import { AssignmentRepository } from './assignment.repository.js';
import { WorkRepository } from './work.repository.js';
import { ensureParentActive } from './task.service.js';
import { hasPermission } from '../organization/policy.js';
import { notifyLateProgress } from '../notifications/progress-notifications.js';
import { saveTag } from '../weekly-plans/tags.service.js';

/** 个人任务内容及实际执行只由本人维护，角色配置不能突破此边界。 */
@Injectable()
export class PersonalService {
  constructor(private readonly database: DatabaseService, private readonly identity: IdentityService) {}

  /** 先按私人边界和当前角色裁剪，再读取已授权事项的进展。 */
  async snapshot(token: string, scope: 'mine' | 'visible'): Promise<PersonalSnapshot> {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token);
      const repository = new PersonalRepository(manager);
      await repository.ensureCategories(access.actor.id);
      const candidates = await repository.candidates(access.actor.id, scope === 'mine' ? null : access.actor.teamId);
      const visible = candidates.filter((item) => canViewPersonal(access, item));
      const items: PersonalItem[] = [];
      for (const item of visible) items.push({ ...item, categoryId: item.ownerId === access.actor.id ? item.categoryId : null, stopReason: await stopReason(manager, item) });
      return { items, categories: await repository.categories(access.actor.id), progress: await repository.progressFor(items.map((item) => item.id)) };
    });
  }

  /** 聚合当前有项目访问权的团队任务及分工；不返回他人的个人内容。 */
  async teamWork(token: string): Promise<PersonalTeamWork> {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token);
      const projects = access.organization.projects.filter((project) => project.teamId === access.actor.teamId && (project.members.some((entry) => entry.accountId === access.actor.id) || access.organization.teams.some((team) => team.id === project.teamId && team.leaderId === access.actor.id)));
      const result: PersonalTeamWork = { projects: projects.map(({ id, name, archived }) => ({ id, name, archived })), tasks: [], assignments: [] };
      for (const project of projects) {
        result.tasks.push(...(await new WorkRepository(manager).snapshot(project.id)).tasks);
        result.assignments.push(...(await new AssignmentRepository(manager).snapshot(project.id)).assignments);
      }
      return result;
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
      await repository.ensureCategories(access.actor.id);
      const categories = await repository.categories(access.actor.id);
      const category = 'categoryId' in command && command.categoryId ? categories.find((entry) => entry.id === command.categoryId) : undefined;
      if ('categoryId' in command && command.categoryId && !category) throw new ForbiddenException('只能使用本人的分类。');
      // 幂等重放也先检查当前项目访问权，已撤销权限不能借旧操作键访问对象。
      if (command.action === 'import_assignment') {
        const assignments = new AssignmentRepository(manager);
        const source = await assignments.assignment(command.assignmentId);
        if (!source || source.accountId !== access.actor.id) throw new ForbiddenException('只能加入本人分工。');
        const task = await assignments.task(source.taskId);
        if (!task) throw new NotFoundException('团队任务不存在。');
        projectAccess(access, task.projectId);
        activeProject(access, task.projectId);
      }
      const history = new WorkRepository(manager);
      const hash = digest(JSON.stringify(command));
      if ('operationId' in command) {
        const previous = await history.operation(access.actor.id, command.operationId);
        if (previous) { if (previous.hash !== hash) throw new ConflictException('操作标识已用于其他内容。'); return { objectId: previous.objectId }; }
      }
      if ('version' in command && (item?.version ?? category?.version) !== command.version) throw new ConflictException('内容已变化，请刷新后操作。');
      let objectId = item?.id ?? category?.id ?? '';
      if (command.action === 'import_assignment') {
        const assignments = new AssignmentRepository(manager);
        const assignment = await assignments.assignment(command.assignmentId);
        if (!assignment || assignment.accountId !== access.actor.id) throw new ForbiddenException('只能加入本人分工，请先按权限认领任务。');
        const task = await assignments.task(assignment.taskId);
        if (!task) throw new NotFoundException('团队任务不存在。');
        projectAccess(access, task.projectId); activeProject(access, task.projectId);
        const existing = await repository.linked(assignment.id);
        if (!command.split && existing[0]) {
          await history.recordOperation(access.actor.id, command.operationId, hash, existing[0].id);
          return { objectId: existing[0].id };
        }
        const target = category ?? targetCategory(categories, command.split ? 'not_started' : assignment.status === 'in_progress' ? 'in_progress' : assignment.status === 'completed' ? 'completed' : 'not_started');
        await validateLink(manager, access, task.projectId, assignment.id, target.status !== 'completed');
        objectId = await repository.create(access.actor.id, { action: 'create_personal', kind: 'work', projectId: task.projectId, assignmentId: assignment.id, title: command.title ?? (assignment.content || task.title).slice(0, 200), description: '', acceptance: '', categoryId: target.id, operationId: command.operationId }, target.status);
        const created = await repository.item(objectId);
        if (created) await syncPersonalAssignment(manager, access, created);
      } else if (command.action === 'create_personal') {
        const target = category ?? targetCategory(categories, 'not_started');
        if (command.tags?.length && (command.kind === 'private' || command.assignmentId)) throw new BadRequestException('只有独立工作可单独选择标签；关联事项沿用团队任务标签。');
        if (command.kind === 'private') {
          if (command.projectId || command.assignmentId) throw new BadRequestException('私人事项不能关联团队项目或分工。');
        } else {
          if (!command.projectId) throw new BadRequestException('工作事项必须选择项目。');
          projectAccess(access, command.projectId);
          activeProject(access, command.projectId);
          if (command.assignmentId) await validateLink(manager, access, command.projectId, command.assignmentId, target.status !== 'completed');
        }
        objectId = await repository.create(access.actor.id, { ...command, categoryId: target.id }, target.status);
        // 标签与事项原子保存，任一标签失败会回滚整次创建。
        for (const tag of command.tags ?? []) await saveTag(manager, access, { ...tag, objectId, objectKind: 'personal', marked: true, version: null });
        const created = await repository.item(objectId);
        if (created) await syncPersonalAssignment(manager, access, created);
      } else if (command.action === 'create_category') objectId = await repository.createCategory(access.actor.id, command.name, command.status ?? 'not_started');
      else if (command.action === 'rename_category') await repository.renameCategory(command.categoryId, command.name);
      else if (command.action === 'delete_category') {
        if (!category) throw new NotFoundException('分类不存在。');
        const siblings = categories.filter((entry) => entry.id !== category.id && entry.status === category.status);
        if (!siblings.length) throw new ConflictException('每种状态至少保留一个分类。');
        const target = targetCategory(categories.filter((entry) => entry.id !== category.id), category.status, command.targetCategoryId);
        await repository.deleteCategory(category.id, target.id);
      }
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
            await repository.link(item.id, command.assignmentId);
            if (item.status === 'in_progress') await syncPersonalAssignment(manager, access, { ...item, assignmentId: command.assignmentId });
            break;
          case 'start_personal':
            if (item.status === 'in_progress' && !stopped) throw new ConflictException('事项已在进行中。');
            await transitionPersonal(manager, access, item, 'in_progress', targetCategory(categories, 'in_progress', command.categoryId).id); break;
          case 'complete_personal':
            if (item.status === 'completed') throw new ConflictException('事项已完成。');
            await transitionPersonal(manager, access, item, 'completed', targetCategory(categories, 'completed', command.categoryId).id); break;
          case 'personal_progress': objectId = await repository.addProgress(command); break;
          case 'personal_times':
            if (command.startedAt && command.endedAt && Date.parse(command.startedAt) > Date.parse(command.endedAt)) throw new BadRequestException('结束时间不能早于开始。');
            await repository.times(item.id, command.startedAt, command.endedAt); break;
          case 'move_personal': {
            const target = category ?? targetCategory(categories, item.status);
            if (item.status !== target.status) await transitionPersonal(manager, access, item, target.status, target.id, command.position);
            else await repository.move(item.id, target.id, command.position);
            break;
          }
          case 'insert_personal': {
            const target = category ?? targetCategory(categories, item.status);
            const column = (await repository.candidates(access.actor.id, null)).filter((entry) => canViewPersonal(access, entry) && entry.categoryId === target.id && entry.id !== item.id);
            if (column.length !== command.order.length || column.some((entry, index) => entry.id !== command.order[index]?.id || entry.version !== command.order[index]?.version)) throw new ConflictException('目标分类已变化，请刷新后重新排序。');
            if (command.beforeId && !column.some((entry) => entry.id === command.beforeId)) throw new BadRequestException('插入目标必须是该分类内的其他事项。');
            const ordered = [...column];
            ordered.splice(command.beforeId ? ordered.findIndex((entry) => entry.id === command.beforeId) : ordered.length, 0, item);
            for (const [index, entry] of ordered.entries()) {
              if (entry.id === item.id && item.status !== target.status) await transitionPersonal(manager, access, item, target.status, target.id, index);
              else if (entry.position !== index || entry.categoryId !== target.id) await repository.move(entry.id, target.id, index);
            }
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
