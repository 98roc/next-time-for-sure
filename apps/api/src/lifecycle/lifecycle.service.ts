import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { LifecycleCommand, LifecycleIntent, WorkSnapshot, Assignment } from '@ntfs/contracts';
import { DatabaseService } from '../database/database.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { loadWorkAccess } from '../work/work-access.js';
import { WorkRepository } from '../work/work.repository.js';
import { PersonalRepository } from '../work/personal.repository.js';
import { AssignmentRepository } from '../work/assignment.repository.js';
import { lifecycleScope } from './lifecycle-scope.js';
import { LifecycleRepository } from './lifecycle.repository.js';
import { digest } from '../identity/password.js';
import { NotificationRepository } from '../notifications/notification.repository.js';
import { overview } from './overview.js';

/** 生命周期操作通过同一影响快照校验，不能凭前端确认绕过归档或权限约束。 */
@Injectable()
export class LifecycleService {
  constructor(private readonly database: DatabaseService, private readonly identity: IdentityService) {}
  /** 总览使用当前身份与项目可见范围。 */
  async overview(token: string, week: string) { return this.database.transaction(async (manager) => overview(manager, await loadWorkAccess(manager, this.identity, token), week)); }
  /** 团队生命周期审计仅当前团队负责人读取，不包含私人删除记录。 */
  async history(token: string) {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token); const team = access.actor.teamId;
      if (!team || !access.organization.teams.some((entry) => entry.id === team && entry.leaderId === access.actor.id)) throw new ForbiddenException('仅当前团队负责人可查看生命周期记录。');
      return new LifecycleRepository(manager).history(team);
    });
  }
  /** 预览不写入，摘要用于阻止确认后发生的数据变化。 */
  async preview(token: string, intent: LifecycleIntent) { return this.database.transaction(async (manager) => (await lifecycleScope(manager, await loadWorkAccess(manager, this.identity, token), intent)).review); }
  /** 当前成员管理范围的未处理工作与职责，无独立交接状态。 */
  async handoff(token: string) {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token); const team = access.actor.teamId;
      if (!team || !access.organization.teams.some((entry) => entry.id === team && entry.leaderId === access.actor.id)) throw new ForbiddenException('仅团队负责人可查看交接清单。');
      const tasks: WorkSnapshot['tasks'] = []; const milestones: WorkSnapshot['milestones'] = []; const assignments: Array<Assignment & { projectId: string }> = [];
      for (const project of access.organization.projects.filter((entry) => entry.teamId === team)) {
        const snapshot = await new WorkRepository(manager).snapshot(project.id); const current = snapshot.tasks;
        milestones.push(...snapshot.milestones.filter((entry) => entry.status === 'open'));
        tasks.push(...current.filter((entry) => !['completed', 'cancelled'].includes(entry.status)));
        assignments.push(...(await new AssignmentRepository(manager).snapshot(project.id)).assignments.filter((entry) => ['not_started', 'in_progress'].includes(entry.status) && current.some((task) => task.id === entry.taskId && !['completed', 'cancelled'].includes(task.status))).map((entry) => ({ ...entry, projectId: project.id })));
      }
      return access.organization.accounts.filter((account) => account.teamId !== team || account.disabled).map((account) => ({ accountId: account.id, displayName: account.displayName, tasks: tasks.filter((task) => task.ownerId === account.id).map(({ id, title, projectId, version }) => ({ id, title, projectId, version })), assignments: assignments.filter((entry) => entry.accountId === account.id).map(({ id, taskId, projectId, version }) => ({ id, taskId, projectId, version })), duties: [...milestones.filter((entry) => entry.ownerId === account.id).map((entry) => `里程碑负责人：${entry.title}`), ...access.organization.groups.filter((group) => group.teamId === team && group.leaderId === account.id).map((group) => `${group.name}组长`), ...access.organization.projects.filter((project) => project.teamId === team && project.members.some((entry) => entry.accountId === account.id && entry.roles.some((role) => role !== 'developer'))).map((project) => `${project.name}管理角色`)] })).filter((entry) => entry.tasks.length || entry.assignments.length || entry.duties.length);
    });
  }
  /** 删除、转移、归档和移出与历史同事务提交。 */
  async execute(token: string, csrf: string, command: LifecycleCommand) {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token, csrf);
      // 仅返回本人已提交请求的收据；先认证再去重，删除后的网络重试无需重新寻找源对象。
      const history = new WorkRepository(manager); const hash = digest(JSON.stringify(command));
      const old = await history.operation(access.actor.id, command.operationId);
      if (old) { if (old.hash !== hash) throw new ConflictException('操作标识已被其他内容使用。'); return { objectId: old.objectId }; }
      const scope = await lifecycleScope(manager, access, command.intent);
      if (scope.review.blockers.length) throw new ConflictException(scope.review.blockers.join('；'));
      if (scope.review.confirmation !== command.confirmation) throw new ConflictException('影响范围已变化，请重新预览确认。');
      const repository = new LifecycleRepository(manager); const { intent } = command;
      switch (intent.action) {
        case 'remove_project_member': await repository.removeProjectMember(intent.projectId, intent.objectId); break;
        case 'archive_project': await repository.archive(intent.objectId, true); break;
        case 'restore_project': await repository.archive(intent.objectId, false); break;
        case 'remove_member': await repository.removeMember(intent.objectId); break;
        case 'delete_task': await repository.deleteTask(intent.objectId); break;
        case 'delete_personal': await repository.deletePersonal(intent.objectId); break;
        case 'transfer_task':
          for (const id of scope.taskIds) await repository.moveTask(id, intent.targetProjectId);
          for (const id of scope.joinIds) await repository.joinProject(intent.targetProjectId, id);
          break;
        case 'transfer_personal':
          await repository.movePersonal(intent.objectId, intent.targetProjectId);
          for (const id of scope.joinIds) await repository.joinProject(intent.targetProjectId, id);
          break;
      }
      // 私人内容只保存在本人历史，不能进入团队审计载荷。
      const payload = { reason: command.reason, intent, review: scope.review, before: scope.task ?? scope.item ?? null };
      if (scope.item) await new PersonalRepository(manager).event(scope.item.ownerId, intent.objectId, intent.action, payload);
      if (scope.team && scope.item?.kind !== 'private') await repository.event(scope.team, access.actor.id, intent.objectId, intent.action, { ...payload, before: scope.task ?? null });
      if (scope.projectId && scope.task) await history.event(scope.projectId, intent.objectId, access.actor.id, intent.action, payload);
      if ('targetProjectId' in intent && scope.team) await new NotificationRepository(manager).enqueue(scope.team, intent.targetProjectId, scope.joinIds, '工作已转移至新的项目，请核对归属与查看范围', intent.objectId, `/work?projectId=${intent.targetProjectId}`);
      await history.recordOperation(access.actor.id, command.operationId, hash, intent.objectId);
      return { objectId: intent.objectId };
    });
  }
}
