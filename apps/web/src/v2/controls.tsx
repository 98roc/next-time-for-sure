import { useState } from 'react';
import type { ReactNode } from 'react';
import { v2StatusLabels, type V2Period, type V2Status } from '@ntfs/contracts';

export const priorityLabels = ['最高', '高', '中', '低', '最低'];
/** 完整区间跨月、跨年均显示实际边界。 */
export function periodLabel(period: V2Period): string { return `${period.startOn} — ${period.endOn}`; }
/** 默认日期使用服务端上海日期，不依赖设备时区。 */
export function currentPeriod(periods: V2Period[], today: string): string { return periods.find((row) => row.startOn <= today && row.endOn >= today)?.id ?? periods[0]?.id ?? ''; }
/** 原型统一日期控件，各入口共享完整区间文案。 */
export function PeriodSelect({ periods, value, onChange, label, disabled = false, all = false }: { periods: V2Period[]; value: string; onChange: (id: string) => void; label: string; disabled?: boolean; all?: boolean }) {
  return <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{all && <option value="all">全部日期区间</option>}{periods.map((period) => <option key={period.id} value={period.id}>{periodLabel(period)}</option>)}</select>;
}
/** 状态始终保留文字，不只通过色彩表达。 */
export function StatusBadge({ status }: { status: V2Status | null }) { return <span className={`w-tag nt-badge ${status === 'completed' ? 'done nt-done' : status === 'in_progress' ? 'doing' : ''}`}>{status ? v2StatusLabels[status] : '历史状态不可还原'}</span>; }
/** 项目汇总与周报共用计划性标签，判断规则由调用方提供。 */
export function PlanningBadge({ children }: { children: ReactNode }) { return <span className="v2-planning-badge">{children}</span>; }
/** 异步操作在本地保留错误和草稿，避免未处理的 Promise 或重复点击。 */
export function useAction() {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function act(work: () => Promise<unknown>) { if (busy) return; setBusy(true); setError(''); try { await work(); } catch (failure) { setError(failure instanceof Error ? failure.message : '操作失败，请重试。'); } finally { setBusy(false); } }
  return { busy, error, act, clear: () => setError('') };
}
/** 表单内错误与当前操作同屏展示。 */
export function Feedback({ error }: { error: string }) { return error ? <p className="v2-error" role="alert">{error}</p> : null; }
/** 字段标题和输入保持同组，必填以原生约束与后端校验共同执行。 */
export function Field({ label, children, full = false }: { label: string; children: ReactNode; full?: boolean }) { return <label className={`v2-field ${full ? 'v2-full' : ''}`}>{label}{children}</label>; }
