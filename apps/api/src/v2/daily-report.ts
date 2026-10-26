import { taskEventAt } from './completion-history.js';
import type { EntityManager } from 'typeorm';
import type { V2DailyReport, V2TaskEvent } from '@ntfs/contracts';
import type { V2Context } from './context.js';
import { periodWindow } from './calendar.js';
import { hashValue } from './repository-utils.js';
import { PersonalWorkRepository, type SubtaskSnapshot } from './personal-work.repository.js';
import { V2PlanningRepository } from './planning.repository.js';

type DailyRow = { taskId: string; title: string; projectId: string | null; projectName: string; completed: boolean; children: string[] };

/** 按日末事实合并主任务与子任务，主任务未完成时只带出当天已完成步骤。 */
export function dailyRows(events: V2TaskEvent[], snapshots: SubtaskSnapshot[], start: string, endExclusive: string): DailyRow[] {
  const latest = new Map<string, V2TaskEvent>();
  const ids = new Set(events.map((event) => event.taskId));
  for (const id of ids) { const event = taskEventAt(events.filter((row) => row.taskId === id), endExclusive); if (event) latest.set(id, event); }
  const rows = new Map<string, DailyRow>();
  for (const event of latest.values()) {
    const task = event.snapshot;
    if (task.status !== 'completed' || !task.completedAt || task.completedAt < start || task.completedAt >= endExclusive) continue;
    rows.set(task.id, { taskId: task.id, title: task.title, projectId: task.projectId, projectName: event.projectName ?? '', completed: true, children: [] });
  }
  for (const snapshot of snapshots) {
    const children = snapshot.items.filter((item) => item.completed && item.completedAt && item.completedAt >= start && item.completedAt < endExclusive).map((item) => item.title);
    if (!children.length) continue;
    const parent = latest.get(snapshot.taskId);
    const row = rows.get(snapshot.taskId) ?? { taskId: snapshot.taskId, title: parent?.snapshot.title ?? snapshot.taskTitle, projectId: snapshot.projectId, projectName: parent?.projectName ?? snapshot.projectName, completed: false, children: [] };
    rows.set(snapshot.taskId, { ...row, projectName: row.projectName || snapshot.projectName, children });
  }
  return [...rows.values()].sort((a, b) => a.taskId.localeCompare(b.taskId));
}

/** 正文直接从项目开始，主子任务保留分级编号，不输出日期标题或状态标签。 */
export function generateDailyText(projects: { id: string; name: string }[], rows: DailyRow[]): string {
  const lines: string[] = [];
  for (const group of [...projects, { id: null, name: '个人任务' }]) {
    const items = rows.filter((row) => row.projectId === group.id);
    if (!items.length) continue;
    lines.push(group.name);
    for (const [index, item] of items.entries()) {
      lines.push(`${index + 1}.${item.title}`);
      item.children.forEach((title, childIndex) => lines.push(`  （${childIndex + 1}）${title}`));
    }
    lines.push('');
  }
  if (!rows.length) lines.push('当日暂无完成记录');
  return lines.join('\n').trim();
}

/** 日报项目默认沿用项目页共享顺序，旧私人配置中的已撤权项目不向排序界面泄露。 */
export async function dailyProjects(manager: EntityManager, context: V2Context) {
  const all = context.organization.projects.filter((row) => row.teamId === context.teamId).map((row) => row.id);
  const shared = context.teamId ? (await new V2PlanningRepository(manager).order(context.teamId, 'project-page:projects', all)).ids : [];
  return shared.filter((id) => context.projects.some((row) => row.id === id)).map((id) => ({ id, name: context.organization.projects.find((row) => row.id === id)?.name ?? '历史项目' }));
}

/** 私人历史仅来自本人曾有权记录的快照；改派或撤权后不会读取他人的后续执行。 */
export async function buildDailyReport(manager: EntityManager, context: V2Context, on: string): Promise<V2DailyReport> {
  const repository = new PersonalWorkRepository(manager), ownerId = context.actor.id;
  const window = periodWindow({ startOn: on, endOn: on });
  const preferences = await repository.preferences(ownerId), shared = await dailyProjects(manager, context);
  const ids = preferences.projectOrder === null ? shared.map((row) => row.id) : [...preferences.projectOrder.filter((id) => shared.some((row) => row.id === id)), ...shared.filter((row) => !preferences.projectOrder?.includes(row.id)).map((row) => row.id)];
  const projects = ids.flatMap((id) => shared.filter((row) => row.id === id));
  const snapshots = await repository.subtaskHistory(ownerId, window.endExclusive);
  const rows = dailyRows(await repository.completedTaskHistory(ownerId, window.start, window.endExclusive, snapshots.map((row) => row.taskId)), snapshots, window.start, window.endExclusive);
  const historic = rows.filter((row) => row.projectId && !projects.some((project) => project.id === row.projectId));
  const groups = [...projects];
  for (const row of historic) if (row.projectId && !groups.some((group) => group.id === row.projectId)) groups.push({ id: row.projectId, name: row.projectName || '历史项目' });
  // 项目名称也使用当时的本人事实，后续项目改名不能改写历史日报。
  const reportGroups = groups.map((group) => ({ ...group, name: rows.find((row) => row.projectId === group.id && row.projectName)?.projectName || group.name })).filter((group) => rows.some((row) => row.projectId === group.id));
  const generatedText = generateDailyText(reportGroups, rows), currentSourceHash = hashValue({ on, rows, groups: reportGroups });
  const saved = await repository.report(ownerId, on);
  const text = saved?.manual ? { ...saved, stale: saved.sourceHash !== currentSourceHash } : { body: generatedText, manual: false, sourceHash: currentSourceHash, version: saved?.version ?? 0, stale: false };
  return { on, preferences: { ...preferences, projectOrder: preferences.projectOrder === null ? null : ids }, projects, text, generatedText, currentSourceHash };
}
