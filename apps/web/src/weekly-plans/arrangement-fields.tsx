import type { WeeklyArrangement } from '@ntfs/contracts';
import { weekLabel } from '../layout/week-picker';

/** 任务详情与周计划复用相同字段，空值明确表示尚未估算。 */
export function ArrangementFields({ week, arrangement }: { week: string; arrangement?: WeeklyArrangement | undefined }) {
  return <div className="arrangement-fields"><label>{weekLabel(week)}目标（选填）<textarea name="goal" maxLength={2000} defaultValue={arrangement?.goal ?? ''} /></label><div className="form-grid"><label>预计新增进度（选填）<input name="progress" type="number" min={0} max={100} step={1} defaultValue={arrangement?.expectedProgress ?? ''} /></label><label>预计投入天数（选填）<input name="days" type="number" min={0} max={9999.99} step="0.01" defaultValue={arrangement?.plannedDays ?? ''} /></label></div></div>;
}

/** 同一处解析选填字段，防止两个入口对空值和零值产生不同解释。 */
export function arrangementValues(form: HTMLFormElement) {
  const data = new FormData(form);
  const progress = String(data.get('progress') ?? '');
  return { goal: String(data.get('goal') ?? ''), expectedProgress: progress === '' ? null : Number(progress), plannedDays: String(data.get('days') ?? '') || null };
}
