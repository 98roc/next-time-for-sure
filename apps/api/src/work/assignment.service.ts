import { ReportingRepository } from '../weekly-plans/reporting.repository.js';
import { notifyLateProgress } from '../notifications/progress-notifications.js';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AssignmentCommand, AssignmentSnapshot, Assignment, PersonalItem } from '@ntfs/contracts';
import { DatabaseService } from '../database/database.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { IdentityRepository } from '../identity/identity.repository.js';
import { digest } from '../identity/password.js';
import { OrganizationRepository } from '../organization/organization.repository.js';
import { hasPermission } from '../organization/policy.js';
import { activeProject, loadWorkAccess, projectAccess } from './work-access.js';
import { WorkRepository } from './work.repository.js';
import { AssignmentRepository } from './assignment.repository.js';
import { PersonalRepository } from './personal.repository.js';
import { canViewPersonal } from './personal-policy.js';
import { ensureParentActive, validateWaiting } from './task.service.js';

/** 人员责任与本人执行分离，管理者不能通过分配命令代改执行事实。 */
@Injectable()
export class AssignmentService {
  constructor(private readonly database: DatabaseService, private readonly identity: IdentityService) {}

  /** 返回项目团队侧分工及进展，不包含私人事项或个人任务明细。 */
  async snapshot(token: string, project: string): Promise<AssignmentSnapshot> {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token);
      const target = access.organization.projects.find((entry) => entry.id === project && entry.teamId === access.actor.teamId);
      if (!target) throw new ForbiddenException('没有项目访问权限。');
      const full = target.members.some((member) => member.accountId === access.actor.id) || access.organization.teams.some((team) => team.id === target.teamId && team.leaderId === access.actor.id);
      const groups = access.organization.groups.filter((group) => group.teamId === target.teamId && group.leaderId === access.actor.id);
      if (!full && !groups.length) throw new ForbiddenException('没有项目或本组工作访问权限。');
      // 关联进展沿用个人工作可见范围，纯项目经理不能借团队目录读取源记录。
      const personal = await new PersonalRepository(manager).candidates(access.actor.id, access.actor.teamId);
      const visiblePersonalIds = personal.filter((item) => item.projectId === project && canViewPersonal(access, item)).map((item) => item.id);
      const state = await new AssignmentRepository(manager).snapshot(project, visiblePersonalIds);
      if (full) return state;

      // 非项目成员的组长只能看到本组成员分工，不借此开放整个项目。
      const assignments = state.assignments.filter((entry) => groups.some((group) => group.memberIds.includes(entry.accountId)));
      return { assignments, progress: state.progress.filter((entry) => assignments.some((assignment) => assignment.id === entry.assignmentId)), linkedProgress: state.linkedProgress.filter((entry) => assignments.some((assignment) => assignment.id === entry.assignmentId)) };
    });
  }

  /** 完成本人分工前预览未完成关联工作，确认绑定当前分工、任务及个人事项版本。 */
  async completion(token: string, id: string) {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token);
      const repository = new AssignmentRepository(manager);
      const assignment = await repository.assignment(id);
      if (!assignment || assignment.accountId !== access.actor.id) throw new ForbiddenException('仅本人可确认分工完成。');
      const task = await repository.task(assignment.taskId);
      if (!task) throw new NotFoundException('任务不存在。');
      projectAccess(access, task.projectId);
      return completionReview(assignment, task, await new PersonalRepository(manager).unfinished(id));
    });
  }

  /** 每次重验负责小组、当前权限、分工版本与团队任务状态。 */
  async execute(token: string, csrf: string, command: AssignmentCommand): Promise<{ objectId: string }> {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token, csrf);
      const repository = new AssignmentRepository(manager);
      const assignment = 'assignmentId' in command ? await repository.assignment(command.assignmentId) : undefined;
      if ('assignmentId' in command && !assignment) throw new NotFoundException('分工不存在。');
      const taskId = 'taskId' in command ? command.taskId : assignment?.taskId;
      const task = taskId ? await repository.task(taskId) : undefined;
      if (!task) throw new NotFoundException('任务不存在。');
      const project = access.organization.projects.find((entry) => entry.id === task.projectId);
      if (!project || project.teamId !== access.actor.teamId) throw new ForbiddenException('没有本团队的操作权限。');

      const manage = (groupId: string | null) => {
        const group = access.organization.groups.find((entry) => entry.id === groupId && entry.teamId === project.teamId);
        if ((groupId !== null && !group) || !hasPermission(access.actor, access.organization, 'work.assign', { teamId: project.teamId, groupId })) throw new ForbiddenException('只能管理有权限的小组分工；团队直属分工由团队负责人管理。');
      };
      const eligible = (accountId: string, groupId: string | null) => {
        const account = access.organization.accounts.find((entry) => entry.id === accountId && entry.teamId === project.teamId && !entry.disabled);
        const group = access.organization.groups.find((entry) => entry.id === groupId && entry.teamId === project.teamId && entry.memberIds.includes(accountId));
        if (!account || (groupId !== null && !group)) throw new BadRequestException('执行人须为可用团队成员；指定小组时须属于该小组。');
      };
      if (command.action === 'assign_many') command.members.forEach((member) => manage(member.groupId));
      else if (command.action === 'assign') manage(command.groupId);
      else if (command.action === 'adjust' || command.action === 'transfer') {
        if (!assignment) throw new NotFoundException('分工不存在。');
        manage(assignment.groupId); manage(command.groupId);
        if (assignment.groupId !== command.groupId && await new ReportingRepository(manager).publishedTask(project.teamId, task.id) && !access.organization.teams.some((team) => team.id === project.teamId && team.leaderId === access.actor.id)) throw new ForbiddenException('已发布安排的跨组调整须由团队负责人确认。');
      } else if (command.action === 'remove' && assignment) {
        manage(assignment.groupId);
      } else {
        projectAccess(access, project.id);
        if (assignment && assignment.accountId !== access.actor.id) throw new ForbiddenException('仅本人可修改执行事实或退出认领。');
      }

      // 权限通过后核验幂等内容；重复转交仍返回原结果，不创建第二份接手安排。
      const history = new WorkRepository(manager);
      const hash = digest(JSON.stringify(command));
      if ('operationId' in command) {
        const previous = await history.operation(access.actor.id, command.operationId);
        if (previous) {
          if (previous.hash !== hash) throw new ConflictException('同一操作标识不能复用为不同内容。');
          return { objectId: previous.objectId };
        }
      }
      if ('version' in command && assignment?.version !== command.version) throw new ConflictException('分工已变化，请刷新后操作。');
      const supplement = command.action === 'record_progress' || command.action === 'correct_times' || command.action === 'complete' || command.action === 'assignment_blocker';
      if (!supplement) { activeProject(access, project.id); await ensureParentActive(manager, task); }
      if (!supplement && ['completed', 'cancelled'].includes(task.status)) throw new ConflictException('团队任务已停止执行，不能新增或继续工作。');
      if (!supplement && await repository.hasChildren(task.id)) throw new ConflictException('父任务已拆分，请在子任务安排执行。');
      if (assignment && (!supplement || command.action === 'complete') && ['exited', 'transferred'].includes(assignment.status)) throw new ConflictException('原分工已停止执行，仅允许补记与整理。');

      let objectId = assignment?.id ?? '';
      if (command.action === 'assign_many') {
        // 先校验整批，再在同一事务落库；冲突时不能留下部分人员分配成功。
        for (const member of command.members) {
          eligible(member.accountId, member.groupId);
          if (await repository.hasActive(task.id, member.accountId)) throw new ConflictException('所选成员已有有效分工，请刷新后调整原分工。');
        }
        for (const member of command.members) {
          if (!project.members.some((entry) => entry.accountId === member.accountId)) await new OrganizationRepository(manager).setProjectMember(project.id, member.accountId, ['developer']);
          const id = await repository.create(task.id, member.accountId, member.groupId, member.content, 'assigned');
          await history.event(project.id, id, access.actor.id, 'assignment.assign', { ...member, taskId: task.id, resultId: id, before: null, after: await repository.assignment(id) });
          await new IdentityRepository(manager).audit(access.actor.id, 'assignment.assign', id);
        }
        await history.recordOperation(access.actor.id, command.operationId, hash, task.id);
        return { objectId: task.id };
      }
      if (command.action === 'assign' || command.action === 'claim' || command.action === 'transfer') {
        const accountId = command.action === 'claim' ? access.actor.id : command.accountId;
        eligible(accountId, command.groupId);
        if (await repository.hasActive(task.id, accountId)) throw new ConflictException('该成员已有有效分工，请调整原分工。');
        if (command.action === 'transfer' && assignment) {
          if (assignment.status === 'completed') throw new ConflictException('已完成分工不能转交。');
          await repository.transition(assignment.id, 'transferred');
        }

        // 分配可自动将本团队成员加入项目，保留其已有角色。
        const member = project.members.find((entry) => entry.accountId === accountId);
        if (!member) await new OrganizationRepository(manager).setProjectMember(project.id, accountId, ['developer']);
        objectId = await repository.create(task.id, accountId, command.groupId, command.content, command.action === 'claim' ? 'claimed' : 'assigned');
      } else {
        if (!assignment) throw new NotFoundException('分工不存在。');
        switch (command.action) {
          // 撤销责任沿用停止态，保留进展、个人关联和发布副本，不伪造完成事实。
          case 'remove':
            if (assignment.status === 'completed') throw new ConflictException('已完成分工不能移除，请保留完成记录。');
            await repository.transition(assignment.id, 'exited'); break;
          case 'assignment_blocker': await validateWaiting(manager, task, command.waitingTaskId); await repository.blocker(assignment.id, command.blockedReason, command.waitingFor, command.waitingTaskId); break;
          case 'adjust': eligible(assignment.accountId, command.groupId); await repository.adjust(assignment.id, command.groupId, command.content); break;
          case 'exit':
            if (assignment.source !== 'claimed') throw new ForbiddenException('管理者分配的工作须由组长或团队负责人调整。');
            if (assignment.status === 'completed') throw new ConflictException('已完成分工不能退出。');
            await repository.transition(assignment.id, 'exited'); break;
          case 'start':
            if (assignment.status === 'in_progress') throw new ConflictException('分工已在进行中。');
            await repository.transition(assignment.id, 'in_progress'); break;
          case 'complete':
            if (assignment.status === 'completed') throw new ConflictException('分工已完成。');
            {
              const review = completionReview(assignment, task, await new PersonalRepository(manager).unfinished(assignment.id));
              if (review.unfinished.length && command.confirmation !== review.confirmation) throw new ConflictException('仍有未完成个人工作，请获取最新影响范围并确认后完成分工。');
            }
            await repository.transition(assignment.id, 'completed'); break;
          case 'record_progress': objectId = await repository.progress(assignment.id, command.occurredOn, command.reportWeek, command.content); break;
          case 'correct_times':
            if (command.startedAt && command.endedAt && Date.parse(command.startedAt) > Date.parse(command.endedAt)) throw new BadRequestException('实际结束不能早于开始。');
            await repository.correctTimes(assignment.id, command.startedAt, command.endedAt); break;
        }
      }
      // 保存精确前后状态，恢复执行清空当前结束时间时仍能追溯历次完成事实。
      const after = await repository.assignment(command.action === 'record_progress' && assignment ? assignment.id : objectId);
      const originalAfter = command.action === 'transfer' && assignment ? await repository.assignment(assignment.id) : undefined;
      await history.event(project.id, assignment?.id ?? objectId, access.actor.id, `assignment.${command.action}`, { ...command, resultId: objectId, before: assignment ?? null, after, ...(originalAfter ? { originalAfter } : {}) });
      await new IdentityRepository(manager).audit(access.actor.id, `assignment.${command.action}`, objectId);
      if (command.action === 'record_progress') await notifyLateProgress(manager, project.id, command.reportWeek, objectId);
      if ('operationId' in command) await history.recordOperation(access.actor.id, command.operationId, hash, objectId);
      return { objectId };
    });
  }
}

/** 摘要由当前持久化状态生成，任何关联范围或内容版本变化都会使旧确认失效。 */
function completionReview(assignment: Assignment, task: { id: string; version: number; status: string }, items: PersonalItem[]) {
  const unfinished = items.map((item) => ({ id: item.id, title: item.title, version: item.version }));
  return { assignmentVersion: assignment.version, unfinished, confirmation: digest(JSON.stringify({ assignmentId: assignment.id, version: assignment.version, task, unfinished })) };
}
