import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Permission, WorkCommand, WorkSnapshot } from '@ntfs/contracts';
import { DatabaseService } from '../database/database.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { IdentityRepository } from '../identity/identity.repository.js';
import { digest } from '../identity/password.js';
import { hasPermission } from '../organization/policy.js';
import { MilestoneRepository } from './milestone.repository.js';
import { WorkRepository } from './work.repository.js';
import { saveTag } from '../weekly-plans/tags.service.js';

import { activeProject, loadWorkAccess, projectAccess } from './work-access.js';

/** 需求接收与团队任务建立共用事务；不产生人员执行事实或排期承诺。 */
@Injectable()
export class WorkService {
  constructor(private readonly database: DatabaseService, private readonly identity: IdentityService) {}

  /** 团队负责人或项目成员可查看团队侧数据，不开放无关项目。 */
  async snapshot(token: string, projectId: string): Promise<WorkSnapshot> {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token); projectAccess(access, projectId);
      return new WorkRepository(manager).snapshot(projectId);
    });
  }

  /** 验证权限、幂等内容、版本和状态后写入，成功结果与历史一起提交。 */
  async execute(token: string, csrf: string, command: WorkCommand): Promise<{ objectId: string }> {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token, csrf);
      const repository = new WorkRepository(manager);
      const request = 'requestId' in command ? await repository.request(command.requestId) : undefined;
      if ('requestId' in command && !request) throw new NotFoundException('需求不存在。');
      const projectId = 'projectId' in command ? command.projectId : request?.projectId;
      if (!projectId) throw new NotFoundException('项目不存在。');
      const project = projectAccess(access, projectId);
      activeProject(access, projectId);
      const requirePermission = (permission: Permission) => {
        if (!hasPermission(access.actor, access.organization, permission, { teamId: project.teamId, projectId })) throw new ForbiddenException('没有本项目的操作权限。');
      };

      // 权限检查先于幂等返回，撤销授权后不能通过旧操作键继续访问。
      if (command.action === 'submit_request') requirePermission('requests.submit');
      else if (command.action === 'create_task') requirePermission('tasks.create');
      else if (command.action === 'review_request' || command.action === 'accept_request') requirePermission('requests.accept');
      else if (request?.submitterId !== access.actor.id) throw new ForbiddenException('仅提交人可修改、补充或撤回需求。');
      const hash = digest(JSON.stringify(command));
      if ('operationId' in command) {
        const existing = await repository.operation(access.actor.id, command.operationId);
        if (existing) {
          if (existing.hash !== hash) throw new ConflictException('操作标识已用于其他内容，请核对后重新提交。');
          return { objectId: existing.objectId };
        }
      }
      if ('version' in command && request?.version !== command.version) throw new ConflictException('需求已被修改，请刷新后按最新内容操作。');

      let objectId: string;
      if (command.action === 'submit_request') {
        objectId = await repository.createRequest(projectId, access.actor.id, command.title, command.description, command.acceptance);
      } else if (command.action === 'create_task') {
        const milestones = new MilestoneRepository(manager);
        if (command.milestoneId) {
          const node = await milestones.get(command.milestoneId);
          if (!node || node.projectId !== projectId || node.status === 'removed') throw new ConflictException('只能关联同项目有效里程碑。');
        }
        objectId = await repository.createTask(projectId, null, access.actor.id, command.title, command.description, command.acceptance);
        if (command.milestoneId) await milestones.link(objectId, command.milestoneId);
        // 创建与标签在同一事务提交；任一标签越权时回滚任务，避免产生半成品。
        for (const tag of command.tags ?? []) await saveTag(manager, access, { ...tag, objectId, objectKind: 'task', marked: true, version: null });
      } else {
        if (!request) throw new NotFoundException('需求不存在。');
        objectId = request.id;
        switch (command.action) {
          case 'edit_request':
            if (request.status === 'accepted') throw new ConflictException('已接收需求只能追加说明。');
            await repository.editRequest(request.id, command.title, command.description, command.acceptance); break;
          case 'supplement_request':
            await repository.setRequestStatus(request.id, request.status === 'supplement_required' ? 'pending' : request.status); break;
          case 'withdraw_request':
            if (request.status === 'accepted' || request.status === 'withdrawn') throw new ConflictException('当前需求不能撤回。');
            await repository.setRequestStatus(request.id, 'withdrawn'); break;
          case 'resubmit_request':
            if (!['withdrawn', 'rejected'].includes(request.status)) throw new ConflictException('仅撤回或拒绝的需求可重新提交。');
            await repository.setRequestStatus(request.id, 'pending'); break;
          case 'review_request':
            if (!['pending', 'supplement_required', 'deferred'].includes(request.status)) throw new ConflictException('当前需求不在待处理范围。');
            if (command.decision === 'pending' && request.status !== 'deferred') throw new ConflictException('仅暂缓需求可恢复处理。');
            await repository.setRequestStatus(request.id, command.decision); break;
          case 'accept_request': {
            if (request.status !== 'pending') throw new ConflictException('请先完成补充或恢复处理，再接收需求。');
            const owner = access.organization.accounts.find((account) => account.id === command.ownerId && account.teamId === project.teamId && !account.disabled);
            const roles = project.members.find((member) => member.accountId === command.ownerId)?.roles ?? [];
            if (!owner || !roles.some((role) => role === 'developer' || role === 'project_lead')) throw new BadRequestException('任务主负责人必须是项目内可用的研发成员。');
            objectId = await repository.createTask(projectId, request.id, command.ownerId, request.title, request.description, request.acceptance);
            await repository.setRequestStatus(request.id, 'accepted');
            await repository.event(projectId, objectId, access.actor.id, 'task.from_request', { requestId: request.id, ownerId: command.ownerId });
            break;
          }
        }
      }
      await repository.event(projectId, request?.id ?? objectId, access.actor.id, command.action, { ...command, resultId: objectId });
      await new IdentityRepository(manager).audit(access.actor.id, `work.${command.action}`, objectId);
      if ('operationId' in command) await repository.recordOperation(access.actor.id, command.operationId, hash, objectId);
      return { objectId };
    });
  }
}
