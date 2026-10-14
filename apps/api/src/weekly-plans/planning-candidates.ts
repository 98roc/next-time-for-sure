import { ForbiddenException } from '@nestjs/common';
import type { WeeklyCandidates } from '@ntfs/contracts';
import type { EntityManager } from 'typeorm';
import type { WorkAccess } from '../work/work-access.js';
import { hasPermission } from '../organization/policy.js';
import { AssignmentRepository } from '../work/assignment.repository.js';
import { WorkRepository } from '../work/work.repository.js';

/** 在同一事务中读取当前可安排分工，供查询、保存和结转共用。 */
export async function planningCandidates(manager: EntityManager, access: WorkAccess, teamId: string): Promise<WeeklyCandidates['assignments']> {
  if (access.actor.teamId !== teamId) throw new ForbiddenException('没有该团队的周计划权限。');
  const groups = access.organization.groups.filter((group) => group.teamId === teamId && hasPermission(access.actor, access.organization, 'work.assign', { teamId, groupId: group.id }));
  if (!groups.length && !hasPermission(access.actor, access.organization, 'work.assign', { teamId })) throw new ForbiddenException('没有周计划安排权限。');
  const assignments: WeeklyCandidates['assignments'] = [];

  // 项目身份不替代负责小组权限；组长可以跨项目编排本组负责的分工。
  for (const project of access.organization.projects.filter((entry) => entry.teamId === teamId && !entry.archived)) {
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
  return assignments;
}
