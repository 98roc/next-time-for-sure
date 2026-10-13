import { ForbiddenException, Injectable } from '@nestjs/common';
import { weeklyCandidatesSchema } from '@ntfs/contracts';
import type { WeeklyCandidates } from '@ntfs/contracts';
import { DatabaseService } from '../database/database.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { hasPermission } from '../organization/policy.js';
import { loadWorkAccess } from '../work/work-access.js';
import { AssignmentRepository } from '../work/assignment.repository.js';
import { WorkRepository } from '../work/work.repository.js';

/** 共享周计划的候选来源，复用现有分工与权限；读取不生成草稿或修改执行事实。 */
@Injectable()
export class WeeklyPlansService {
  constructor(private readonly database: DatabaseService, private readonly identity: IdentityService) {}

  /** 跨项目查找有安排权限的有效分工；按分工去重，不按成员所属组重复统计。 */
  async candidates(token: string, teamId: string, week: string): Promise<WeeklyCandidates> {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token);
      if (access.actor.teamId !== teamId) throw new ForbiddenException('没有该团队的周计划权限。');
      const groups = access.organization.groups.filter((group) => group.teamId === teamId && hasPermission(access.actor, access.organization, 'work.assign', { teamId, groupId: group.id }));
      if (!groups.length && !hasPermission(access.actor, access.organization, 'work.assign', { teamId })) throw new ForbiddenException('没有周计划安排权限。');
      const assignments: WeeklyCandidates['assignments'] = [];

      // 项目身份不替代负责小组权限；组长可以跨项目编排本组负责的分工。
      for (const project of access.organization.projects.filter((entry) => entry.teamId === teamId)) {
        const tasks = (await new WorkRepository(manager).snapshot(project.id)).tasks;
        const state = await new AssignmentRepository(manager).snapshot(project.id);
        for (const entry of state.assignments) {
          if (entry.status !== 'not_started' && entry.status !== 'in_progress') continue;
          const group = groups.find((item) => item.id === entry.groupId);
          const account = access.organization.accounts.find((item) => item.id === entry.accountId && item.teamId === teamId && !item.disabled);
          const task = tasks.find((item) => item.id === entry.taskId);
          if (!group || !account || !task || ['completed', 'cancelled'].includes(task.status)) continue;
          if (tasks.some((item) => item.parentId === task.id) || (task.parentId && tasks.some((item) => item.id === task.parentId && ['completed', 'cancelled'].includes(item.status)))) continue;
          assignments.push({ assignmentId: entry.id, assignmentVersion: entry.version, taskId: task.id, taskVersion: task.version, projectId: project.id, projectName: project.name, taskTitle: task.title, accountId: account.id, displayName: account.displayName, groupId: group.id, groupName: group.name, content: entry.content, status: entry.status, blockedReason: entry.blockedReason || task.blockedReason });
        }
      }
      return weeklyCandidatesSchema.parse({ teamId, week, assignments });
    });
  }
}
