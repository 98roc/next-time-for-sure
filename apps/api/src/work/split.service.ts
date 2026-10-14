import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { SplitCommand } from '@ntfs/contracts';
import { DatabaseService } from '../database/database.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { IdentityRepository } from '../identity/identity.repository.js';
import { digest } from '../identity/password.js';
import { hasPermission } from '../organization/policy.js';
import { loadWorkAccess, projectAccess } from './work-access.js';
import { WorkRepository } from './work.repository.js';
import { TaskRepository } from './task.repository.js';
import { AssignmentRepository } from './assignment.repository.js';
import { ReportingRepository } from '../weekly-plans/reporting.repository.js';
import { WeeklyPlansRepository } from '../weekly-plans/weekly-plans.repository.js';

/** 子任务建立和当前安排迁移同事务完成，不允许留下仍承接执行的父任务。 */
@Injectable()
export class SplitService {
  constructor(private readonly database: DatabaseService, private readonly identity: IdentityService) {}

  /** 拆分权限与分配权限分别核验；未覆盖任一有效分工时整次拒绝。 */
  async execute(token: string, csrf: string, command: SplitCommand): Promise<{ objectId: string }> {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token, csrf);
      const assignments = new AssignmentRepository(manager);
      const parent = await assignments.task(command.taskId);
      if (!parent) throw new NotFoundException('父任务不存在。');
      const project = projectAccess(access, parent.projectId);
      const teamLead = access.organization.teams.some((entry) => entry.id === project.teamId && entry.leaderId === access.actor.id);
      const projectLead = project.members.some((entry) => entry.accountId === access.actor.id && entry.roles.includes('project_lead'));
      if (parent.ownerId !== access.actor.id && !teamLead && !projectLead) throw new ForbiddenException('只有父任务主负责人、项目研发负责人或团队负责人可拆分。');

      // 已成功重试也重新核验原迁移小组的当前授权，不用旧操作键绕过撤权。
      const source = [];
      for (const move of command.moves) {
        const assignment = await assignments.assignment(move.assignmentId);
        if (!assignment || !hasPermission(access.actor, access.organization, 'work.assign', { teamId: project.teamId, groupId: assignment.groupId })) throw new ForbiddenException('迁移已有分工须具备其负责小组的安排权限，请由有权管理者完成拆分。');
        source.push(assignment);
      }
      const history = new WorkRepository(manager);
      const hash = digest(JSON.stringify(command));
      const previous = await history.operation(access.actor.id, command.operationId);
      if (previous) {
        if (previous.hash !== hash) throw new ConflictException('操作标识已用于其他拆分内容。');
        return { objectId: previous.objectId };
      }
      if (parent.parentId) throw new ConflictException('团队任务仅允许一层子任务，不能继续拆分子任务。');
      if (['completed', 'cancelled'].includes(parent.status)) throw new ConflictException('父任务已停止，须先按权限重开。');
      if (parent.version !== command.version) throw new ConflictException('父任务已变化，请刷新后拆分。');
      const active = (await assignments.snapshot(parent.projectId)).assignments.filter((entry) => entry.taskId === parent.id && !['exited', 'transferred'].includes(entry.status));
      if (active.length !== command.moves.length || active.some((entry) => !command.moves.some((move) => move.assignmentId === entry.id && move.version === entry.version))) throw new ConflictException('分工范围或版本已变化，必须为每条有效分工指定一个子任务。');

      // 先建立全新子任务，再原地移动分工；个人事项仍通过原分工标识关联。
      const repository = new TaskRepository(manager);
      const childIds = new Map<string, string>();
      for (const child of command.children) {
        const id = await repository.child(parent, child);
        childIds.set(child.key, id);
        // 普通拆分沿用人工标签，不能把拆分误判为计划内或计划外。
        const tags = new ReportingRepository(manager);
        for (const tag of await tags.tags(parent.id, 'task')) await tags.tag({ objectId: id, objectKind: 'task', dimension: tag.dimension, week: tag.week || null, marked: tag.marked, version: null });
        await history.event(parent.projectId, id, access.actor.id, 'task.child_created', { parentId: parent.id, after: await assignments.task(id) });
      }
      for (const move of command.moves) {
        const target = childIds.get(move.childKey);
        if (!target) throw new ConflictException('分工目标子任务无效。');
        await assignments.moveToChild(move.assignmentId, target);
        await history.event(parent.projectId, move.assignmentId, access.actor.id, 'assignment.moved_to_child', { before: source.find((entry) => entry.id === move.assignmentId), after: await assignments.assignment(move.assignmentId), parentId: parent.id });
      }
      await repository.touch(parent.id);
      await new WeeklyPlansRepository(manager).splitPending(parent.id, [...childIds.values()]);
      await history.event(parent.projectId, parent.id, access.actor.id, 'task.split', { before: parent, after: await assignments.task(parent.id), children: [...childIds.values()], moves: command.moves.map((move) => ({ assignmentId: move.assignmentId, childId: childIds.get(move.childKey) })) });
      await new IdentityRepository(manager).audit(access.actor.id, 'task.split', parent.id);
      await history.recordOperation(access.actor.id, command.operationId, hash, parent.id);
      return { objectId: parent.id };
    });
  }
}
