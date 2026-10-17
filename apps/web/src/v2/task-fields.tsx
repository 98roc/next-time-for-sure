import type { V2ProjectTaskInput, V2Workspace } from '@ntfs/contracts';
import { Field, PeriodSelect, priorityLabels } from './controls';

/** 项目、计划和个人入口复用同一字段组，差异只由权限和默认值传入。 */
export function TaskFields({ value, onChange, data, selfId, disabled = false, onlySelf = false, showDays = false }: { value: V2ProjectTaskInput; onChange: (value: V2ProjectTaskInput) => void; data: V2Workspace; selfId: string; disabled?: boolean; onlySelf?: boolean; showDays?: boolean }) {
  const project = data.projects.find((row) => row.id === value.projectId);
  const members = data.accounts.filter((account) => project?.members.some((member) => member.accountId === account.id) || account.id === value.executorId);
  return <div className="v2-fields">
    <Field label="任务名称" full><input required maxLength={200} disabled={disabled} value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} /></Field>
    <Field label="执行人"><select required disabled={disabled || onlySelf} value={value.executorId} onChange={(event) => onChange({ ...value, executorId: event.target.value })}><option value="">请选择执行人</option>{members.map((account) => <option key={account.id} value={account.id} disabled={(account.disabled || (onlySelf && account.id !== selfId)) && account.id !== value.executorId}>{account.displayName}{account.disabled ? '（已停用）' : ''}</option>)}</select></Field>
    <PriorityField value={value.priority} disabled={disabled} onChange={(priority) => onChange({ ...value, priority })} />
    <Field label="日期区间" full><PeriodSelect label="日期区间" periods={data.periods} value={value.periodId} disabled={disabled} onChange={(periodId) => onChange({ ...value, periodId })} /></Field>
    <Field label="关联里程碑"><select disabled={disabled} value={value.milestoneId ?? ''} onChange={(event) => onChange({ ...value, milestoneId: event.target.value || null })}><option value="">不关联里程碑</option>{data.milestones.filter((row) => row.projectId === value.projectId).map((row) => <option key={row.id} value={row.id}>{row.title}{row.status === 'completed' ? '（已完成）' : ''}</option>)}</select></Field>
    {showDays && <Field label="该区间预计天数（选填）"><input type="number" min="0" max="9999.99" step="0.01" disabled={disabled} value={value.plannedDays ?? ''} placeholder="未估算" onChange={(event) => onChange({ ...value, plannedDays: event.target.value === '' ? null : Number(event.target.value) })} /></Field>}
  </div>;
}

/** 优先级采用固定五级，数字越小优先级越高。 */
export function PriorityField({ value, onChange, disabled = false }: { value: number; onChange: (value: number) => void; disabled?: boolean }) { return <Field label="优先级"><select disabled={disabled} value={value} onChange={(event) => onChange(Number(event.target.value))}>{priorityLabels.map((label, index) => <option key={label} value={index + 1}>{index + 1} {label}</option>)}</select></Field>; }
