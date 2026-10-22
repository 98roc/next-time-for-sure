import { useState } from 'react';
import { v2DateSchema, type V2Task } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { currentPeriod, useAction } from './controls';

/** 完成筛选共用账号模式；日期初始为服务端当天，多个完成分类引用同一状态。 */
export function useCompletedFilter() {
  const { data, run } = useWorkspace(), action = useAction();
  const [day, setDay] = useState<string | null>(null), [periodId, setPeriodId] = useState<string | null>(null);
  const mode = data.personalPreferences.completedMode, date = day ?? data.today, selectedPeriod = periodId ?? currentPeriod(data.periods, data.today);
  function includes(task: V2Task) {
    if (task.status !== 'completed') return true;
    if (mode === 'period' && selectedPeriod === 'all') return true;
    if (mode === 'period' && selectedPeriod === 'unknown') return task.completedAt === null;
    const completed = task.completedAt ? new Date(Date.parse(task.completedAt) + 8 * 3600000).toISOString().slice(0, 10) : null;
    if (mode === 'day') return completed === date;
    const period = data.periods.find((row) => row.id === selectedPeriod);
    return Boolean(completed && period && completed >= period.startOn && completed <= period.endOn);
  }
  return { mode, date, selectedPeriod, setDay, setPeriodId, includes, error: action.error, busy: action.busy,
    changeMode: (next: 'day' | 'period') => { if (next !== mode) void action.act(async () => { await run('personal-settings', { action: 'set_completed_mode', operationId: createOperationId(), version: data.personalPreferences.version, mode: next }); setDay(null); setPeriodId(null); }); },
  };
}

/** 日报与完成列共用日期切换，纯日期按UTC加减天数，避免设备时区改变日期。 */
export function DateNavigator({ value, today, disabled = false, label, onChange }: { value: string; today: string; disabled?: boolean; label: string; onChange: (value: string) => void }) {
  function shift(days: number) { const result = new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10); if (v2DateSchema.safeParse(result).success) onChange(result); }
  return <div className="v2-date-navigator"><button className="mw-quiet" disabled={disabled} aria-label={`${label}前一天`} onClick={() => shift(-1)}>‹</button><input aria-label={label} type="date" value={value} disabled={disabled} onChange={(event) => { if (v2DateSchema.safeParse(event.target.value).success) onChange(event.target.value); }} /><button className="mw-quiet" disabled={disabled} aria-label={`${label}后一天`} onClick={() => shift(1)}>›</button><button className="mw-quiet" disabled={disabled} onClick={() => onChange(today)}>今天</button></div>;
}
