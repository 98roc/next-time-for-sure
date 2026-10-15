import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { PublicationRow, WeeklyPlanCommand } from '@ntfs/contracts';
import type { WorkAccess } from '../work/work-access.js';
import { AssignmentRepository } from '../work/assignment.repository.js';
import { hasPermission } from '../organization/policy.js';
import { WeeklyPlansRepository } from './weekly-plans.repository.js';
import { ReportingRepository } from './reporting.repository.js';
import { canPublish } from './reporting-policy.js';
import { digest } from '../identity/password.js';

/** 从当前分工解析展示字段；已发布副本不依赖此查询。 */
export async function planRows(manager: EntityManager, access: WorkAccess, team: string, week: string): Promise<PublicationRow[]> {
  const repository = new WeeklyPlansRepository(manager); const draft = await repository.draft(team, week); if (!draft) return [];
  const work = new AssignmentRepository(manager); const rows: PublicationRow[] = [];
  for (const entry of await repository.arrangements(draft.id)) {
    const assignment = await work.assignment(entry.assignmentId); if (!assignment) continue;
    const task = await work.task(assignment.taskId); if (!task) continue;
    const project = access.organization.projects.find((item) => item.id === task.projectId && item.teamId === team && !item.archived); if (!project) continue;
    const text = [entry.sourceWeek ? '上周延续' : '', entry.goal, entry.expectedProgress === null ? '' : `预计新增${entry.expectedProgress}%`].filter(Boolean).join('；');
    rows.push({ projectId: project.id, projectName: project.name, taskId: task.id, title: task.title, accountId: assignment.accountId, person: access.organization.accounts.find((item) => item.id === assignment.accountId)?.displayName ?? '历史成员', groupId: assignment.groupId, text, plannedDays: entry.plannedDays, status: `${task.status}/${assignment.status}`, sourceIds: [assignment.id] });
  }
  for (const entry of await repository.pending(draft.id)) {
    const task = await work.task(entry.taskId); if (!task) continue;
    const project = access.organization.projects.find((item) => item.id === task.projectId && item.teamId === team && !item.archived); if (!project) continue;
    rows.push({ projectId: project.id, projectName: project.name, taskId: task.id, title: task.title, accountId: null, person: '待分配', groupId: null, text: `${entry.sourceWeek ? '上周延续；' : ''}尚未落实执行人员`, plannedDays: null, status: task.status, sourceIds: [entry.id] });
  }
  return rows;
}
/** 摘要同时绑定草稿、源对象与当前展示内容，杜绝旧预览发布。 */
export async function planConfirmation(manager: EntityManager, access: WorkAccess, team: string, week: string) {
  if (!canPublish(access, team)) throw new ForbiddenException('仅有发布权限的团队负责人可发布。');
  const draft = await new WeeklyPlansRepository(manager).draft(team, week);
  if (!draft) throw new ConflictException('请先建立草稿。');
  return digest(JSON.stringify({ draft, rows: await planRows(manager, access, team, week) }));
}
/** 待分配安排由团队负责人维护；组长只操作本组实际分工。 */
export async function planSpecial(manager: EntityManager, access: WorkAccess, command: WeeklyPlanCommand, draftId: string): Promise<string | null> {
  const repository = new WeeklyPlansRepository(manager);
  if (command.action === 'publish_plan') {
    if (command.confirmation !== await planConfirmation(manager, access, command.teamId, command.week)) throw new ConflictException('计划已变化，请重新预览发布。');
    return new ReportingRepository(manager).publish(command.teamId, command.week, 'plan', await planRows(manager, access, command.teamId, command.week), [], command.reason, command.confirmation);
  }
  if (command.action === 'remove_arrangement') {
    const row = (await repository.arrangements(draftId)).find((entry) => entry.id === command.arrangementId);
    const assignment = row && await new AssignmentRepository(manager).assignment(row.assignmentId);
    if (!row || !assignment || row.version !== command.version) throw new ConflictException('安排已变化。');
    if (!hasPermission(access.actor, access.organization, 'work.assign', { teamId: command.teamId, groupId: assignment.groupId })) throw new ForbiddenException('没有原负责小组权限。');
    await repository.exclude(draftId, row.assignmentId, 'assignment');
    await repository.remove(draftId, row.id, false); return row.id;
  }
  if (command.action === 'add_pending' || command.action === 'remove_pending') {
    if (!hasPermission(access.actor, access.organization, 'work.assign', { teamId: command.teamId })) throw new ForbiddenException('未落实小组的待分配事项由团队负责人维护。');
    if (command.action === 'remove_pending') {
      const row = (await repository.pending(draftId)).find((entry) => entry.id === command.pendingId);
      if (!row || row.version !== command.version) throw new ConflictException('待分配事项已变化。');
      await repository.exclude(draftId, row.taskId, 'task');
      await repository.remove(draftId, row.id, true); return row.id;
    }
    const task = await new AssignmentRepository(manager).task(command.taskId);
    if (!task || task.version !== command.taskVersion || !access.organization.projects.some((entry) => entry.id === task.projectId && entry.teamId === command.teamId && !entry.archived) || ['completed', 'cancelled'].includes(task.status) || await new AssignmentRepository(manager).hasChildren(task.id)) throw new ConflictException('只能安排当前团队未归档项目的有效叶子任务。');
    await repository.include(draftId, task.id, 'task');
    return repository.addPending(draftId, task.id);
  }
  return null;
}
