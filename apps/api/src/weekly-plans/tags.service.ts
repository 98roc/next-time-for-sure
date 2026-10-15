import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { TagCommand } from '@ntfs/contracts';
import { DatabaseService } from '../database/database.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { loadWorkAccess, projectAccess } from '../work/work-access.js';
import type { WorkAccess } from '../work/work-access.js';
import { AssignmentRepository } from '../work/assignment.repository.js';
import { PersonalRepository } from '../work/personal.repository.js';
import { canViewPersonal } from '../work/personal-policy.js';
import { ReportingRepository } from './reporting.repository.js';
import { canEditSource } from './reporting-policy.js';

/** 独立工作与团队任务保留各自标签，关联期间只展示团队任务标签。 */
@Injectable()
export class TagsService {
  constructor(private readonly database: DatabaseService, private readonly identity: IdentityService) {}
  /** 返回有效对象标签和两个维度的当前编辑能力。 */
  async state(token: string, id: string, kind: 'task' | 'personal') {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token);
      const scope = await tagScope(manager, access, id, kind);
      return { tags: await new ReportingRepository(manager).tags(scope.id, scope.kind), milestone: scope.milestone, weekly: scope.weekly, inherited: scope.id !== id };
    });
  }
  /** 保留取消标记及关联前标签的审计记录。 */
  async execute(token: string, csrf: string, command: TagCommand) {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token, csrf);
      const scope = await tagScope(manager, access, command.objectId, command.objectKind);
      if (scope.id !== command.objectId || !scope[command.dimension]) throw new ForbiddenException('没有该维度的标签管理权限；关联事项请到团队任务修改。');
      if ((command.dimension === 'weekly') !== (command.week !== null)) throw new ConflictException('周计划标签须指定周一；里程碑标签不带周次。');
      const repository = new ReportingRepository(manager);
      const old = (await repository.tags(scope.id, scope.kind)).find((entry) => entry.dimension === command.dimension && entry.week === (command.week ?? ''));
      if ((old?.version ?? null) !== command.version) throw new ConflictException('标签已变化，请刷新。');
      const objectId = await repository.tag(command, old?.id);
      await repository.event(scope.team, access.actor.id, 'tag.change', { before: old ?? null, after: command });
      return { objectId };
    });
  }
}
/** 查看与修改分别判定，避免项目可读权限扩大为周计划管理权限。 */
async function tagScope(manager: EntityManager, access: WorkAccess, id: string, kind: 'task' | 'personal'): Promise<{ id: string; kind: 'task' | 'personal'; team: string; milestone: boolean; weekly: boolean }> {
  const assignments = new AssignmentRepository(manager);
  if (kind === 'personal') {
    const item = await new PersonalRepository(manager).item(id);
    if (!item || item.kind !== 'work' || !canViewPersonal(access, item)) throw new ForbiddenException('仅可查看授权范围的工作事项标签。');
    const linked = item.assignmentId ? await assignments.assignment(item.assignmentId) : null;
    if (linked) return tagScope(manager, access, linked.taskId, 'task');
    const project = access.organization.projects.find((entry) => entry.id === item.projectId && entry.teamId === access.actor.teamId);
    if (!project) throw new ForbiddenException('工作项目不在当前团队。');
    const edit = item.ownerId === access.actor.id || canEditSource(access, project.teamId, { groupId: null, ownerId: item.ownerId });
    return { id, kind, team: project.teamId, milestone: edit, weekly: edit };
  }
  const task = await assignments.task(id); if (!task) throw new NotFoundException('任务不存在。');
  const candidate = access.organization.projects.find((entry) => entry.id === task.projectId && entry.teamId === access.actor.teamId);
  if (!candidate) throw new ForbiddenException('任务不在当前团队。');
  const responsible = (await assignments.snapshot(candidate.id)).assignments.filter((entry) => entry.taskId === id && !['exited', 'transferred'].includes(entry.status));
  const managesGroup = responsible.some((entry) => canEditSource(access, candidate.teamId, { groupId: entry.groupId, ownerId: entry.accountId, taskId: entry.taskId }));
  const project = managesGroup ? candidate : projectAccess(access, task.projectId);
  const teamLead = access.organization.teams.some((team) => team.id === project.teamId && team.leaderId === access.actor.id);
  const projectLead = project.members.some((entry) => entry.accountId === access.actor.id && entry.roles.includes('project_lead'));
  return { id, kind, team: project.teamId, milestone: teamLead || projectLead, weekly: teamLead || managesGroup };
}
