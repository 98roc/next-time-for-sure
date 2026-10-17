import type { V2Status, V2WeeklyState, V2Workspace } from '@ntfs/contracts';

export type Row = { id: string; projectId: string; title: string; executorId: string | null; executorName: string; status: V2Status | null; priority: number | null; days: number | null; planning?: 'planned' | 'unplanned' | 'unknown'; incomplete?: boolean };

/** 共用行模型只用于展示；总结保持历史字段，计划使用当前任务及对应区间投入。 */
export function buildWeeklyRows(data: V2Workspace, state: V2WeeklyState) {
  const summary: Row[] = state.summary.flatMap((row) => row.projectId ? [{ id: row.taskId, projectId: row.projectId, title: row.title ?? '历史内容不可还原', executorId: row.executorId, executorName: row.executorName ?? '历史姓名不可还原', status: row.status, priority: row.priority, days: null, planning: row.planning, incomplete: row.historyIncomplete }] : []);
  const plan: Row[] = data.arrangements.filter((row) => row.periodId === state.planPeriod.id).flatMap((arrangement) => { const task = data.tasks.find((row) => row.id === arrangement.taskId); return task?.kind === 'project' ? [{ id: task.id, projectId: task.projectId, title: task.title, executorId: task.executorId, executorName: data.accounts.find((row) => row.id === task.executorId)?.displayName ?? '历史成员', status: task.status, priority: task.priority, days: arrangement.plannedDays }] : []; });
  function ordered(side: 'summary' | 'plan', projectId: string, person?: string): Row[] {
    const rows = side === 'summary' ? summary : plan, periodId = side === 'summary' ? state.summaryPeriod.id : state.planPeriod.id;
    const order = state.taskOrders.find((row) => row.projectId === projectId && row.periodId === periodId)?.ids ?? [];
    return order.flatMap((id) => { const row = rows.find((item) => item.id === id && item.projectId === projectId && (person === undefined || (item.executorId ?? 'unknown') === person)); return row ? [row] : []; });
  }
  return { summary, plan, ordered };
}

/** 空估算单独计数，避免把任务数或未估算当作零投入。 */
export function estimates(rows: Row[]): string { const unknown = rows.filter((row) => row.days === null).length; const total = Math.round(rows.reduce((sum, row) => sum + (row.days ?? 0), 0) * 100) / 100; return `${rows.length} 项 · ${total} 天${unknown ? ` ＋ ${unknown} 项未估算` : ''}`; }
