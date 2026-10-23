import { classifyPlanning } from './planning-classification.js';
import type { V2ArrangementHistory, V2Period, V2TaskEvent, V2Status } from '@ntfs/contracts';
import { periodWindow } from './calendar.js';

/** 历史结果不会以当前任务状态补全缺失历史；调用者先按当前项目权限裁剪来源。 */
export type V2SummaryRow = {
  taskId: string; createdAt: string | null; title: string | null; executorId: string | null; executorName: string | null; projectId: string | null;
  status: V2Status | null; priority: number | null; arranged: boolean; executed: boolean;
  planning: 'planned' | 'unplanned' | 'unknown'; historyIncomplete: boolean;
};

/** 状态事件按实际时间及对象内版本排序；相同毫秒的回退不会打乱先后。 */
function orderedHistory(events: V2TaskEvent[]): V2TaskEvent[] {
  const ordered = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.sequence - b.sequence);
  const versions = new Set<number>();
  for (const event of ordered) {
    if (versions.has(event.sequence)) throw new Error('任务历史版本重复');
    versions.add(event.sequence);
  }
  return ordered;
}

/** 检查进行中的时间片，以及区间内真实开始、完成、回退事件；迁移不伪造执行。 */
function executedDuring(events: V2TaskEvent[], start: string, end: string): boolean {
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (!event || event.occurredAt >= end) break;
    if (event.occurredAt >= start && event.action === 'status_changed') return true;
    const segmentEnd = events[index + 1]?.occurredAt ?? end;
    if (event.snapshot.status === 'in_progress' && !event.snapshot.deletedAt && segmentEnd > start && event.occurredAt < end) return true;
  }
  return false;
}

/** 按上海区间末快照回看；未来变更、任务删除和状态再次完成均不覆盖先前结果。 */
export function summarizePeriod(period: V2Period, events: V2TaskEvent[], arrangements: V2ArrangementHistory[], now: string): V2SummaryRow[] {
  const window = periodWindow(period);
  const currentExclusive = new Date(new Date(now).getTime() + 1).toISOString();
  const end = window.endExclusive < currentExclusive ? window.endExclusive : currentExclusive;
  const grouped = new Map<string, V2TaskEvent[]>();
  for (const event of events) {
    // 私人事件即使误传入，也不能出现在团队总结。
    if (event.snapshot.kind !== 'project' || event.snapshot.teamId !== period.teamId) continue;
    const group = grouped.get(event.taskId) ?? [];
    group.push(event); grouped.set(event.taskId, group);
  }
  const rows: V2SummaryRow[] = [];
  for (const [taskId, group] of grouped) {
    const history = orderedHistory(group);
    const known = history.filter((event) => event.occurredAt < end);
    const snapshot = known.at(-1)?.snapshot;
    // 截止回看时已删除的任务不再进入总结；区间结束后的删除不改写该区间历史。
    if (snapshot?.deletedAt) continue;
    const relevant = arrangements.filter((arrangement) => {
      if (arrangement.taskId !== taskId || arrangement.periodId !== period.id || (arrangement.validUntil !== null && arrangement.validUntil <= window.start)) return false;
      // 迁移可在区间结束后承接旧安排；展示该关联但不把补录时刻倒填为提前计划。
      const lateMigration = arrangement.provenance !== 'scheduled' && arrangement.validFrom >= window.endExclusive && arrangement.validFrom <= now;
      return arrangement.validFrom < end || lateMigration;
    });
    const arranged = relevant.length > 0;
    const executed = end > window.start && executedDuring(known, window.start, end);
    if (!arranged && !executed) continue;

    // 未开始且已移出该区间时，不因曾进行中或曾有安排继续占据总结。
    // 以回看截止时刻判断，区间结束后的改期、回退不能改写历史；午夜取消归下一区间。
    const arrangedAtEnd = relevant.some((row) => row.validUntil === null || row.validUntil >= end);
    if (snapshot?.status === 'not_started' && !arrangedAtEnd) continue;

    const first = history[0];
    const historyIncomplete = known.length === 0 || (first?.action === 'migrated' && first.occurredAt > window.start);
    rows.push({ taskId, createdAt: snapshot?.createdAt ?? first?.snapshot.createdAt ?? null, title: snapshot?.title ?? null, executorId: snapshot?.executorId ?? null, executorName: known.at(-1)?.executorName ?? null, projectId: snapshot?.projectId ?? first?.snapshot.projectId ?? null, status: snapshot?.status ?? null, priority: snapshot?.priority ?? null, arranged, executed, planning: classifyPlanning(period, history, arrangements), historyIncomplete });
  }
  return rows;
}
