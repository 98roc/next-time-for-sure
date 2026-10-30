import { useRef } from 'react';
import type { V2ArrangementInput, V2Period, V2PlanningLabel } from '@ntfs/contracts';
import { Field, periodLabel } from './controls';
import './task-arrangements.css';

/** 同一行始终绑定周期及估算，普通执行人仅可填写已有周期投入。 */
export function TaskArrangements({ value, onChange, periods, canSchedule, canEstimate, disabled = false, carriedPeriods = [], retainedLabels = [], defaultUnplanned, requireEstimates = true }: { value: V2ArrangementInput[]; onChange: (value: V2ArrangementInput[]) => void; periods: V2Period[]; canSchedule: boolean; canEstimate: boolean; disabled?: boolean; carriedPeriods?: string[]; retainedLabels?: V2PlanningLabel[]; defaultUnplanned?: (period: V2Period, index: number) => boolean; requireEstimates?: boolean }) {
  const remembered = useRef(new Map(retainedLabels.map((row) => [row.periodId, row.unplanned ?? undefined])));
  const available = periods.filter((period) => !value.some((row) => row.periodId === period.id));
  function change(index: number, row: V2ArrangementInput) { onChange(value.map((old, position) => position === index ? row : old)); }
  function move(index: number, periodId: string) {
    const row = value[index]; if (!row) return;
    remembered.current.set(row.periodId, row.unplanned);
    const unplanned = remembered.current.has(periodId) ? remembered.current.get(periodId) : defaultUnplanned ? row.unplanned : false;
    change(index, { ...row, periodId, plannedDays: null, unplanned });
  }
  return <section className="v2-task-section"><div className="v2-section-head"><h3>周期安排</h3>{canSchedule && <button type="button" className="nt-link" disabled={disabled || !available.length} onClick={() => { const last = value.at(-1); const next = available.find((period) => period.startOn > (periods.find((period) => period.id === last?.periodId)?.startOn ?? '')) ?? available[0]; if (next) onChange([...value, { periodId: next.id, plannedDays: null, unplanned: remembered.current.has(next.id) ? remembered.current.get(next.id) : defaultUnplanned ? undefined : false }]); }}>＋ 追加安排</button>}</div>
    {value.map((row, index) => <div className="v2-task-arrangement" key={index}>
      <Field label="日期区间 *"><select aria-label={`日期区间 ${index + 1}`} required disabled={disabled || !canSchedule} value={row.periodId} onChange={(event) => move(index, event.target.value)}><option value="">请选择日期区间</option>{periods.map((period) => <option key={period.id} value={period.id} disabled={period.id !== row.periodId && value.some((item) => item.periodId === period.id)}>{periodLabel(period)}</option>)}</select></Field>
      <Field label="预计投入（人天） *"><input required={requireEstimates} aria-label={`本周期预计投入（人天）${index + 1}`} type="number" min="0" max="9999.99" step="0.01" disabled={disabled || !canEstimate} value={row.plannedDays ?? ''} placeholder="请填写预计投入" onChange={(event) => change(index, { ...row, plannedDays: event.target.value === '' ? null : Number(event.target.value) })} /></Field>
      <Field label="本期工作（选填）"><input aria-label={`本期工作 ${index + 1}`} maxLength={500} value={row.workNote ?? ''} placeholder="填写本期工作" disabled={disabled || !canEstimate} onChange={(event) => change(index, { ...row, workNote: event.target.value })} /></Field>
      <label className="v2-arrangement-planning" title={row.unplanned === undefined && defaultUnplanned ? '符合现有创建和首次排期规则时默认勾选，可手动修改。' : '仅作用于此周期，可按任务权限随时修改。'}><input type="checkbox" aria-label={`计划外 ${index + 1}`} disabled={disabled || !canEstimate} checked={row.unplanned ?? periods.some((period) => period.id === row.periodId && Boolean(defaultUnplanned?.(period, index)))} onChange={(event) => change(index, { ...row, unplanned: event.target.checked })} />计划外</label>
      {canSchedule && <button type="button" className="v2-arrangement-remove" aria-label={`取消第${index + 1}条周期安排`} title={value.length === 1 ? '至少保留一个周期，可改排' : '取消此周期安排'} disabled={disabled || value.length === 1} onClick={() => { remembered.current.set(row.periodId, row.unplanned); onChange(value.filter((_, position) => position !== index)); }}>×</button>}
      {carriedPeriods.includes(row.periodId) && <span className="v2-carried-note">上期未完成 · 自动追加</span>}
    </div>)}
  </section>;
}
