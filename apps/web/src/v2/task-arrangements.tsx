import type { V2ArrangementInput, V2Period } from '@ntfs/contracts';
import { Field, periodLabel } from './controls';

/** 同一行始终绑定周期及估算，普通执行人仅可填写已有周期投入。 */
export function TaskArrangements({ value, onChange, periods, canSchedule, canEstimate, disabled = false }: { value: V2ArrangementInput[]; onChange: (value: V2ArrangementInput[]) => void; periods: V2Period[]; canSchedule: boolean; canEstimate: boolean; disabled?: boolean }) {
  const available = periods.filter((period) => !value.some((row) => row.periodId === period.id));
  function change(index: number, row: V2ArrangementInput) { onChange(value.map((old, position) => position === index ? row : old)); }
  return <section className="v2-task-section"><div className="v2-section-head"><h3>周期安排</h3>{canSchedule && <button type="button" className="nt-link" disabled={disabled || !available.length} onClick={() => { const last = value.at(-1); const next = available.find((period) => period.startOn > (periods.find((period) => period.id === last?.periodId)?.startOn ?? '')) ?? available[0]; if (next) onChange([...value, { periodId: next.id, plannedDays: null }]); }}>＋ 追加安排</button>}</div>
    {value.map((row, index) => <div className="v2-task-arrangement" key={index}>
      <Field label="日期区间 *"><select aria-label={`日期区间 ${index + 1}`} required disabled={disabled || !canSchedule} value={row.periodId} onChange={(event) => change(index, { periodId: event.target.value, plannedDays: null })}><option value="">请选择日期区间</option>{periods.map((period) => <option key={period.id} value={period.id} disabled={period.id !== row.periodId && value.some((item) => item.periodId === period.id)}>{periodLabel(period)}</option>)}</select></Field>
      <Field label="本周期预计投入（人天）"><input aria-label={`本周期预计投入（人天）${index + 1}`} type="number" min="0" max="9999.99" step="0.01" disabled={disabled || !canEstimate} value={row.plannedDays ?? ''} placeholder="选填 · 未估算" onChange={(event) => change(index, { ...row, plannedDays: event.target.value === '' ? null : Number(event.target.value) })} /></Field>
      {canSchedule && <button type="button" className="v2-arrangement-remove" aria-label={`取消第${index + 1}条周期安排`} title={value.length === 1 ? '至少保留一个周期，可改排' : '取消此周期安排'} disabled={disabled || value.length === 1} onClick={() => onChange(value.filter((_, position) => position !== index))}>×</button>}
    </div>)}
  </section>;
}
