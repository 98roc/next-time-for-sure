import type { EntityManager } from 'typeorm';
import type { ReportSource } from '@ntfs/contracts';
import type { WorkAccess } from '../work/work-access.js';
import { WorkRepository } from '../work/work.repository.js';
import { AssignmentRepository } from '../work/assignment.repository.js';
import { PersonalRepository } from '../work/personal.repository.js';
import { ReportingRepository } from './reporting.repository.js';
import { digest } from '../identity/password.js';

/** 来源按记录标识稳定去重；关联个人与分工按同一任务聚合，私人事项永不进入。 */
export async function reportSources(manager: EntityManager, access: WorkAccess, team: string, week: string): Promise<ReportSource[]> {
  const result: ReportSource[] = []; const repository = new ReportingRepository(manager);
  const person = (id: string) => access.organization.accounts.find((entry) => entry.id === id)?.displayName ?? '历史成员';
  const personal = new PersonalRepository(manager);
  const items = (await personal.candidates(access.actor.id, team)).filter((entry) => entry.kind === 'work' && access.organization.projects.some((project) => project.id === entry.projectId && project.teamId === team));
  const progress = await personal.progressFor(items.map((entry) => entry.id));
  for (const project of access.organization.projects.filter((entry) => entry.teamId === team)) {
    const work = await new WorkRepository(manager).snapshot(project.id);
    const assignments = await new AssignmentRepository(manager).snapshot(project.id);
    for (const entry of assignments.progress.filter((entry) => entry.reportWeek === week)) {
      const assignment = assignments.assignments.find((item) => item.id === entry.assignmentId); if (!assignment) continue;
      const task = work.tasks.find((item) => item.id === assignment.taskId); if (!task) continue;
      const tags = await repository.tags(task.id, 'task');
      result.push(source({ key: `assignment:${entry.id}`, sourceId: entry.id, sourceKind: 'assignment', projectId: project.id, projectName: project.name, taskId: task.id, title: task.title, accountId: assignment.accountId, ownerId: assignment.accountId, person: person(assignment.accountId), groupId: assignment.groupId, text: entry.content + tagText(tags, week), plannedDays: null, status: `${task.status}/${assignment.status}`, sourceIds: [entry.id], occurredOn: entry.occurredOn }));
    }
    for (const item of items.filter((entry) => entry.projectId === project.id)) {
      const assignment = assignments.assignments.find((entry) => entry.id === item.assignmentId);
      const task = work.tasks.find((entry) => entry.id === assignment?.taskId);
      const tags = await repository.tags(task?.id ?? item.id, task ? 'task' : 'personal');
      for (const entry of progress.filter((entry) => entry.itemId === item.id && entry.reportWeek === week)) {
        result.push(source({ key: `personal:${entry.id}`, sourceId: entry.id, sourceKind: 'personal', projectId: project.id, projectName: project.name, taskId: task?.id ?? null, title: task?.title ?? item.title, accountId: item.ownerId, ownerId: item.ownerId, person: person(item.ownerId), groupId: assignment?.groupId ?? null, text: entry.content + tagText(tags, week), plannedDays: null, status: item.status, sourceIds: [entry.id], occurredOn: entry.occurredOn }));
      }
    }
  }

  // 本周发布基线中的未完成工作同样进入草稿，不用起止时间推算本周工作。
  const baseline = (await repository.publications(team, week, 'plan'))[0];
  for (const row of baseline?.rows ?? []) {
    const assignment = row.accountId && row.sourceIds[0] ? await new AssignmentRepository(manager).assignment(row.sourceIds[0]) : null;
    const taskId = assignment?.taskId ?? row.taskId;
    const task = taskId ? await new AssignmentRepository(manager).task(taskId) : null;
    if (task?.status === 'completed' || assignment?.status === 'completed') continue;
    const children = task && !assignment ? (await new WorkRepository(manager).snapshot(task.projectId)).tasks.filter((entry) => entry.parentId === task.id) : [];
    for (const current of children.length ? children.filter((child) => child.status !== 'completed') : [task]) {
      result.push(source({ ...row, taskId: current?.id ?? row.taskId, title: current?.title ?? row.title, groupId: assignment?.groupId ?? row.groupId, key: `plan:${row.sourceIds.join(':')}${children.length ? `:${current?.id}` : ''}`, sourceId: row.sourceIds[0] ?? baseline?.id ?? '', sourceKind: 'plan', ownerId: assignment?.accountId ?? row.accountId, occurredOn: null, text: `发布计划尚未完成：${row.text}`, status: `${current?.status ?? row.status}/${assignment?.status ?? ''}` }));
    }
  }
  return result;
}
/** 摘要包含来源日期、文字和归属，源变动只提示，不覆盖人工整理。 */
function source(value: Omit<ReportSource, 'hash'>): ReportSource {
  const labels = value.status.includes('cancelled') ? '【团队工作已取消】' : value.status.includes('transferred') ? '【原分工已转交】' : value.status.includes('exited') ? '【原分工已退出】' : '';
  const entry = { ...value, text: value.text + labels };
  return { ...entry, hash: digest(JSON.stringify(entry)) };
}
/** 未标记不等于计划内，只展示人工标记维度。 */
function tagText(tags: Awaited<ReturnType<ReportingRepository['tags']>>, week: string) { return tags.filter((tag) => tag.marked && (tag.dimension === 'milestone' || tag.week === week)).map((tag) => tag.dimension === 'milestone' ? '【里程碑外】' : `【${week}周计划外】`).join(''); }
