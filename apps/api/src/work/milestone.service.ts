import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { MilestoneCommand } from '@ntfs/contracts';
import { DatabaseService } from '../database/database.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { IdentityRepository } from '../identity/identity.repository.js';
import { digest } from '../identity/password.js';
import { hasPermission } from '../organization/policy.js';
import { activeProject, loadWorkAccess, projectAccess } from './work-access.js';
import { AssignmentRepository } from './assignment.repository.js';
import { WorkRepository } from './work.repository.js';
import { ReportingRepository } from '../weekly-plans/reporting.repository.js';
import { MilestoneRepository } from './milestone.repository.js';

/** 独立目标和任务关联共用项目授权、组织锁及历史事务。 */
@Injectable()
export class MilestoneService {
  constructor(private readonly database: DatabaseService, private readonly identity: IdentityService) {}

  /** 新建不生成任务；完成由目标负责人确认，任务状态不会反向完成目标。 */
  async execute(token: string, csrf: string, command: MilestoneCommand): Promise<{ objectId: string }> {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token, csrf);
      const tasks = new AssignmentRepository(manager);
      const work = new WorkRepository(manager);
      const repository = new MilestoneRepository(manager);
      const task = 'taskId' in command ? await tasks.task(command.taskId) : undefined;
      const node = 'milestoneId' in command && command.milestoneId ? await repository.get(command.milestoneId) : undefined;
      if ('taskId' in command && !task || 'milestoneId' in command && command.milestoneId && !node) throw new NotFoundException('任务或里程碑不存在。');
      const projectId = command.action === 'create_node' ? command.projectId : task?.projectId ?? node?.projectId;
      if (!projectId) throw new NotFoundException('项目不存在。');
      const project = projectAccess(access, projectId);
      activeProject(access, projectId);
      const manage = hasPermission(access.actor, access.organization, 'milestones.manage', { teamId: project.teamId, projectId });

      // 编辑执行内容与规划权限分离；目标完成仅允许当前负责人。
      if (command.action === 'edit_task') {
        if (task?.ownerId !== access.actor.id) throw new ForbiddenException('仅任务主负责人可修改任务内容。');
      } else if (command.action === 'link_task') {
        if (task?.ownerId !== access.actor.id && !manage) throw new ForbiddenException('仅任务主负责人或规划管理者可调整关联。');
        if (node && (node.projectId !== projectId || node.status === 'removed')) throw new ConflictException('只能关联同项目有效里程碑。');
      } else if (command.action === 'complete_node' || command.action === 'reopen_node') {
        if (node?.ownerId !== access.actor.id) throw new ForbiddenException('仅里程碑负责人可确认完成或重新打开。');
      } else if (!manage) throw new ForbiddenException('没有本项目的里程碑维护权限。');

      const hash = digest(JSON.stringify(command));
      if (command.action === 'create_node') {
        const previous = await work.operation(access.actor.id, command.operationId);
        if (previous) {
          if (previous.hash !== hash) throw new ConflictException('操作标识已用于其他内容。');
          return { objectId: previous.objectId };
        }
      }
      const before = task ?? node;
      if ('version' in command && before?.version !== command.version) throw new ConflictException('记录已变化，请刷新后核对。');
      if (node?.status === 'removed' && command.action !== 'link_task') throw new ConflictException('里程碑已移出。');
      if ('ownerId' in command) {
        const owner = access.organization.accounts.find((entry) => entry.id === command.ownerId && entry.teamId === project.teamId && !entry.disabled);
        if (!owner || !project.members.some((entry) => entry.accountId === owner.id && entry.roles.some((role) => role === 'developer' || role === 'project_lead'))) throw new BadRequestException('负责人须为当前项目可用研发成员。');
      }

      // 已发布任务关联的明确交付日期变化仍需团队负责人确认。
      if (node?.expectedOn && (command.action === 'remove_node' || command.action === 'reschedule_node' && command.expectedOn !== node.expectedOn)) {
        const linked = (await work.snapshot(projectId)).tasks.filter((entry) => entry.milestoneId === node.id);
        const teamLeader = access.organization.teams.some((entry) => entry.id === project.teamId && entry.leaderId === access.actor.id);
        if (!teamLeader) for (const entry of linked) {
          if (await new ReportingRepository(manager).publishedTask(project.teamId, entry.id)) throw new ForbiddenException('已发布工作关联目标的交付日期变化须由团队负责人确认。');
        }
      }

      // 目标变更和任务关联分别写入，禁止隐式复制执行对象。
      let objectId = before?.id ?? '';
      switch (command.action) {
        case 'create_node': objectId = await repository.create(projectId, command.ownerId, command.title, command.expectedOn); break;
        case 'link_task': await repository.link(command.taskId, command.milestoneId); break;
        case 'edit_task': await work.editTask(command.taskId, command.title, command.description, command.acceptance); break;
        case 'edit_node': await repository.edit(command.milestoneId, command.title, command.ownerId); break;
        case 'reschedule_node': await repository.reschedule(command.milestoneId, command.expectedOn); break;
        case 'remove_node': await repository.unlinkAll(command.milestoneId); await repository.status(command.milestoneId, 'removed'); break;
        case 'complete_node':
          if (node?.status !== 'open') throw new ConflictException('目标已完成。');
          await repository.status(command.milestoneId, 'completed'); break;
        case 'reopen_node':
          if (node?.status !== 'completed') throw new ConflictException('仅已完成目标可重新打开。');
          await repository.status(command.milestoneId, 'open'); break;
      }
      await work.event(projectId, objectId, access.actor.id, `milestone.${command.action}`, { ...command, before: before ?? null, after: task ? await tasks.task(objectId) : await repository.get(objectId) });
      await new IdentityRepository(manager).audit(access.actor.id, `milestone.${command.action}`, objectId);
      if (command.action === 'create_node') await work.recordOperation(access.actor.id, command.operationId, hash, objectId);
      return { objectId };
    });
  }
}
