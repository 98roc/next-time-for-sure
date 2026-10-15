import type { OrganizationSnapshot, PublicationRow, WeeklyArrangement, WeeklyCandidates } from '@ntfs/contracts';
import type { weeklySnapshot } from './api';

export type PlanGrouping = 'project' | 'group' | 'person';
export type PlanEntry = PublicationRow & {
  key: string;
  groupName: string;
  candidate?: WeeklyCandidates['assignments'][number] | undefined;
  arrangement?: WeeklyArrangement | undefined;
  pending?: { id: string; version: number } | undefined;
  stopped: boolean;
};

/** 汇总及发布版本只展示传入副本，不拼接当前任务标题、分工目标或执行状态。 */
export function publicationPlanEntries(rows: PublicationRow[], organization: Pick<OrganizationSnapshot, 'groups'>): PlanEntry[] {
  return rows.map((row) => ({ ...row, key: row.sourceIds.join(':'), stopped: false,
    groupName: row.accountId === null ? '待分配' : organization.groups.find((group) => group.id === row.groupId)?.name ?? (row.groupId ? '历史小组' : '团队直属'),
  }));
}

/** 复制文本和页面采用相同的项目、任务聚合，人员分工缩进到任务下。 */
export function planText(entries: PlanEntry[]): string {
  return groupPlanEntries(entries, 'project').map((group) => `${group.title}\n${group.tasks.map((task) => `· ${task.title}\n${task.entries.map((entry) => `  ${entry.person}${entry.text ? `：${entry.text}` : ''}${entry.plannedDays === null ? '' : `（投入${entry.plannedDays}天）`}`).join('\n')}`).join('\n')}`).join('\n\n');
}

/** 以服务端授权后的安排为展示来源；完成及停止记录保留，不扩展草稿可见范围。 */
export function planEntries(data: Awaited<ReturnType<typeof weeklySnapshot>>, organization: OrganizationSnapshot, backlog: boolean): PlanEntry[] {
  const arrangements = new Map(data.canEdit ? data.draft?.arrangements.map((entry) => [entry.assignmentId, entry]) : []);
  const candidates = new Map((data.canEdit ? data.candidates : []).map((entry) => [entry.assignmentId, entry]));
  if (backlog) return [...candidates.values()].filter((entry) => !arrangements.has(entry.assignmentId)).map((entry) => ({
    key: entry.assignmentId, projectId: entry.projectId, projectName: entry.projectName, taskId: entry.taskId,
    title: entry.taskTitle, accountId: entry.accountId, person: entry.displayName, groupId: entry.groupId,
    groupName: entry.groupName, text: '', plannedDays: null, status: entry.status, sourceIds: [entry.assignmentId], candidate: entry, stopped: false,
  }));

  const rows = data.canEdit ? data.draft?.rows ?? [] : data.publications[0]?.rows ?? [];
  return rows.map((row) => {
    const source = row.sourceIds.find((id) => arrangements.has(id) || candidates.has(id));
    const candidate = source ? candidates.get(source) : undefined;
    return {
      ...row, key: row.sourceIds.join(':'), candidate, arrangement: source ? arrangements.get(source) : undefined,
      pending: data.canEdit ? data.draft?.pending?.find((entry) => row.sourceIds.includes(entry.id)) : undefined,
      groupName: row.accountId === null ? '待分配' : organization.groups.find((group) => group.id === row.groupId)?.name ?? (row.groupId ? '历史小组' : '团队直属'),
      stopped: row.status.split('/').some((status) => ['completed', 'cancelled', 'transferred', 'exited'].includes(status)) || Boolean(data.canEdit && row.accountId && !candidate),
    };
  });
}

/** 分组只改变展示层级；任务与人员按标识聚合，重名和跨组参与不会产生新任务。 */
export function groupPlanEntries(entries: PlanEntry[], grouping: PlanGrouping) {
  const groups = new Map<string, { id: string; title: string; tasks: Map<string, { id: string; title: string; projectId: string; projectName: string; taskId: string | null; entries: PlanEntry[] }> }>();
  for (const entry of entries) {
    const id = grouping === 'project' ? entry.projectId : grouping === 'person' ? entry.accountId ?? 'unassigned' : entry.accountId === null ? 'unassigned' : entry.groupId ?? 'team-direct';
    const title = grouping === 'project' ? entry.projectName : grouping === 'person' ? entry.person : entry.groupName;
    let group = groups.get(id);
    if (!group) { group = { id, title, tasks: new Map() }; groups.set(id, group); }
    const taskKey = `${entry.projectId}:${entry.taskId ?? entry.key}`;
    let task = group.tasks.get(taskKey);
    if (!task) {
      task = { id: taskKey, title: entry.title, projectId: entry.projectId, projectName: entry.projectName, taskId: entry.taskId, entries: [] };
      group.tasks.set(taskKey, task);
    }
    task.entries.push(entry);
  }
  return [...groups.values()].map((group) => ({ ...group, tasks: [...group.tasks.values()] }));
}

/** 汇总统计按任务标识去重，分工数量与任务数量分别表达。 */
export function planCounts(entries: PlanEntry[]) {
  return { tasks: new Set(entries.map((entry) => `${entry.projectId}:${entry.taskId ?? entry.key}`)).size, people: entries.filter((entry) => entry.accountId !== null).length, pending: entries.filter((entry) => entry.accountId === null).length };
}

/** 明确区分整体任务与本人分工状态，避免整体结束被误读为本人完成。 */
export function planStatus(status: string) {
  const labels: Record<string, string> = { not_started: '待开始', in_progress: '进行中', completed: '已完成', cancelled: '已取消', transferred: '已转交', exited: '已退出' };
  const parts = status.split('/');
  if (parts.length === 2 && parts[0] === parts[1]) return `${labels[parts[0] ?? ''] ?? parts[0]}（任务与分工）`;
  return parts.length === 2 ? `任务${labels[parts[0] ?? ''] ?? parts[0]} · 分工${labels[parts[1] ?? ''] ?? parts[1]}` : labels[status] ?? status;
}
