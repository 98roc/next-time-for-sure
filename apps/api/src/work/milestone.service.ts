import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { MilestoneCommand } from '@ntfs/contracts';
import { DatabaseService } from '../database/database.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { IdentityRepository } from '../identity/identity.repository.js';
import { digest } from '../identity/password.js';
import { hasPermission } from '../organization/policy.js';
import { loadWorkAccess, projectAccess } from './work-access.js';
import { AssignmentRepository } from './assignment.repository.js';
import { WorkRepository } from './work.repository.js';

/** 规划操作只维护原团队任务的规划字段，不复制或删除个人执行数据。 */
@Injectable()
export class MilestoneService {
  constructor(private readonly database: DatabaseService, private readonly identity: IdentityService) {}

  /** 当前授权、版本、变更和历史在同一事务提交，重试创建不会生成重复节点。 */
  async execute(token: string, csrf: string, command: MilestoneCommand): Promise<{ objectId: string }> {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token, csrf);
      const tasks = new AssignmentRepository(manager);
      const repository = new WorkRepository(manager);
      const before = 'taskId' in command ? await tasks.task(command.taskId) : undefined;
      if ('taskId' in command && !before) throw new NotFoundException('任务不存在。');
      const projectId = command.action === 'create_node' ? command.projectId : before?.projectId;
      if (!projectId) throw new NotFoundException('项目不存在。');
      const project = projectAccess(access, projectId);

      // 内容由主负责人维护；规划权限不隐式允许代改任务范围。
      if (command.action === 'edit_task') {
        if (before?.ownerId !== access.actor.id) throw new ForbiddenException('仅任务主负责人可修改任务内容。');
      } else if (!hasPermission(access.actor, access.organization, 'milestones.manage', { teamId: project.teamId, projectId })) throw new ForbiddenException('没有本项目的里程碑维护权限。');
      const hash = digest(JSON.stringify(command));
      if (command.action === 'create_node') {
        const previous = await repository.operation(access.actor.id, command.operationId);
        if (previous) {
          if (previous.hash !== hash) throw new ConflictException('操作标识已用于其他内容。');
          return { objectId: previous.objectId };
        }
      }
      if ('version' in command && before?.version !== command.version) throw new ConflictException('任务或规划已变化，请刷新后核对再保存。');
      let objectId = before?.id ?? '';

      // 创建规划事项就是创建团队任务，主负责人必须是当前项目可用研发成员。
      if (command.action === 'create_node') {
        const account = access.organization.accounts.find((entry) => entry.id === command.ownerId && entry.teamId === project.teamId && !entry.disabled);
        const member = project.members.find((entry) => entry.accountId === command.ownerId);
        if (!account || !member?.roles.some((role) => role === 'developer' || role === 'project_lead')) throw new BadRequestException('主负责人必须是当前项目可用研发成员。');
        objectId = await repository.createTask(projectId, null, command.ownerId, command.title, command.description, command.acceptance);
        await repository.planTask(objectId, true, command.expectedOn);
      } else {
        if (!before) throw new NotFoundException('任务不存在。');
        switch (command.action) {
          case 'add_node':
            if (before.inMilestone) throw new ConflictException('任务已在里程碑中，请编辑现有节点。');
            await repository.planTask(objectId, true, command.expectedOn); break;
          case 'reschedule_node':
            if (!before.inMilestone) throw new ConflictException('任务已移出里程碑，请刷新。');
            await repository.planTask(objectId, true, command.expectedOn); break;
          case 'remove_node':
            if (!before.inMilestone) throw new ConflictException('任务已移出里程碑。');
            await repository.planTask(objectId, false, null); break;
          case 'edit_task': await repository.editTask(objectId, command.title, command.description, command.acceptance); break;
        }
      }
      await repository.event(projectId, objectId, access.actor.id, `milestone.${command.action}`, { ...command, before: before ?? null, after: await tasks.task(objectId) });
      await new IdentityRepository(manager).audit(access.actor.id, `milestone.${command.action}`, objectId);
      if (command.action === 'create_node') await repository.recordOperation(access.actor.id, command.operationId, hash, objectId);
      return { objectId };
    });
  }
}
