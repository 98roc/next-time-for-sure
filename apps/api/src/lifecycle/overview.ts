import { overviewSchema } from '@ntfs/contracts';
import type { PublicationRow } from '@ntfs/contracts';
import type { EntityManager } from 'typeorm';
import type { WorkAccess } from '../work/work-access.js';
import { WorkRepository } from '../work/work.repository.js';
import { AssignmentRepository } from '../work/assignment.repository.js';
import { ReportingRepository } from '../weekly-plans/reporting.repository.js';
import { planRows } from '../weekly-plans/plan-publication.js';
import { PersonalRepository } from '../work/personal.repository.js';
import { canViewPersonal } from '../work/personal-policy.js';

/** 项目维度汇总当前安排；对照最近发布版本展示变化，不重复累计历史分工。 */
export async function overview(manager: EntityManager, access: WorkAccess, week: string) {
  const team = access.actor.teamId;
  if (!team) return overviewSchema.parse({ week, projects: [], people: [] });
  const leader = access.organization.teams.some((entry) => entry.id === team && entry.leaderId === access.actor.id);
  const projects = access.organization.projects.filter((entry) => entry.teamId === team && (leader || entry.members.some((member) => member.accountId === access.actor.id)));
  const current = await planRows(manager, access, team, week);
  const baseline = (await new ReportingRepository(manager).publications(team, week, 'plan'))[0];
  const summaries = [];
  const unscheduled: PublicationRow[] = [];
  const personal = new PersonalRepository(manager);
  const items = (await personal.candidates(access.actor.id, team)).filter((item) => item.kind === 'work' && canViewPersonal(access, item));
  const personalProgress = await personal.progressFor(items.map((item) => item.id));
  for (const project of projects) {
    const tasks = (await new WorkRepository(manager).snapshot(project.id)).tasks;
    const state = await new AssignmentRepository(manager).snapshot(project.id);
    const arrangements = current.filter((row) => row.projectId === project.id);
    const old = baseline?.rows.filter((row) => row.projectId === project.id) ?? [];
    const key = (row: PublicationRow) => row.sourceIds.join(',');
    const changes = baseline ? [
      ...arrangements.filter((row) => !old.some((prior) => key(prior) === key(row))).map((row) => `新增：${row.title} · ${row.person}`),
      ...old.filter((row) => !arrangements.some((next) => key(next) === key(row))).map((row) => `移出：${row.title} · ${row.person}`),
      ...arrangements.filter((row) => old.some((prior) => key(prior) === key(row) && (prior.text !== row.text || prior.plannedDays !== row.plannedDays || prior.groupId !== row.groupId))).map((row) => `安排调整：${row.title} · ${row.person}`),
    ] : ['本周尚无正式发布基线'];
    const active = tasks.filter((task) => !['completed', 'cancelled'].includes(task.status));
    const currentAssignments = state.assignments.filter((entry) => !['exited', 'transferred'].includes(entry.status));
    for (const assignment of currentAssignments.filter((entry) => entry.status !== 'completed' && active.some((task) => task.id === entry.taskId) && !arrangements.some((row) => row.sourceIds.includes(entry.id)))) {
      const task = tasks.find((entry) => entry.id === assignment.taskId);
      if (task) unscheduled.push({ projectId: project.id, projectName: project.name, taskId: task.id, title: task.title, accountId: assignment.accountId, person: access.organization.accounts.find((entry) => entry.id === assignment.accountId)?.displayName ?? '历史成员', groupId: assignment.groupId, text: '未纳入本周安排', plannedDays: null, status: assignment.status, sourceIds: [assignment.id] });
    }
    summaries.push({ id: project.id, name: project.name, archived: project.archived, arrangements, changes,
      unassigned: active.filter((task) => !tasks.some((child) => child.parentId === task.id) && !currentAssignments.some((entry) => entry.taskId === task.id)).map((task) => task.title),
      blockers: [...active.filter((task) => task.blockedReason).map((task) => `${task.title}：${task.blockedReason}`), ...currentAssignments.filter((entry) => entry.blockedReason && active.some((task) => task.id === entry.taskId)).map((entry) => `${tasks.find((task) => task.id === entry.taskId)?.title ?? '分工'}：${entry.blockedReason}`)],
      progress: state.progress.filter((entry) => entry.reportWeek === week).map((entry) => { const assignment = state.assignments.find((item) => item.id === entry.assignmentId); return { title: tasks.find((task) => task.id === assignment?.taskId)?.title ?? '历史工作', person: access.organization.accounts.find((account) => account.id === assignment?.accountId)?.displayName ?? '历史成员', content: entry.content, occurredOn: entry.occurredOn }; }),
    });
  }
  // 以分工唯一标识累计百分之一天，未估算单独提示，不按任务数排名。
  for (const project of summaries) for (const entry of personalProgress.filter((entry) => entry.reportWeek === week)) {
    const item = items.find((item) => item.id === entry.itemId && item.projectId === project.id);
    if (item) project.progress.push({ title: item.title, person: access.organization.accounts.find((account) => account.id === item.ownerId)?.displayName ?? '历史成员', content: entry.content, occurredOn: entry.occurredOn });
  }
  const visibleRows = [...summaries.flatMap((entry) => entry.arrangements), ...unscheduled].filter((row) => row.accountId);
  const people = [...new Set(visibleRows.map((row) => row.accountId))].map((id) => {
    const assignments = visibleRows.filter((row) => row.accountId === id);
    const days = assignments.reduce((sum, row) => sum + (row.plannedDays === null ? 0 : Math.round(Number(row.plannedDays) * 100)), 0);
    return { id, name: assignments[0]?.person ?? '历史成员', plannedDays: (days / 100).toFixed(2), unestimated: assignments.filter((row) => row.plannedDays === null).length, assignments };
  });
  return overviewSchema.parse({ week, projects: summaries, people });
}
