import { CompletionTime } from './completion-time';
import { useId, useState } from 'react';
import { v2AiContributionLabels, v2AiContributionSchema, type V2ArrangementInput, type V2Completion, type V2Task } from '@ntfs/contracts';
import { Field, Feedback, periodLabel, useAction } from './controls';
import { ModalPage, useModal } from './modal';
import { useWorkspace } from './workspace';
import { orderArrangements } from './arrangement-order';
import './task-completion.css';

/** 空和零分别表示未填写及明确零投入；重开时带回原结果。 */
export function taskCompletion(task: V2Task): V2Completion { return { actualDays: task.actualDays ?? null, aiContribution: task.aiContribution ?? null, startedAt: task.startedAt ?? null, ...(task.completedAt ? { completedAt: task.completedAt } : {}) }; }

/** 详情及完成窗口共用结果字段，不为私人任务渲染。 */
export function TaskResultFields({ value, onChange, required = false, disabled = false }: { value: V2Completion; onChange: (value: V2Completion) => void; required?: boolean; disabled?: boolean }) {
  return <><div className="v2-fields">
    <Field label={`累计实际投入（人天）${required ? ' *' : ''}`}><input aria-label="累计实际投入（人天）" type="number" min="0" max="9999.99" step="0.01" required={required} disabled={disabled} value={value.actualDays ?? ''} placeholder={required ? '请输入，例如 2.5' : '选填 · 完成时必填'} onChange={(event) => onChange({ ...value, actualDays: event.target.value === '' ? null : Number(event.target.value) })} /></Field>
    <Field label={`AI 贡献率${required ? ' *' : ''}`}><select aria-label="AI 贡献率" required={required} disabled={disabled} value={value.aiContribution ?? ''} onChange={(event) => onChange({ ...value, aiContribution: event.target.value ? v2AiContributionSchema.parse(event.target.value) : null })}><option value="">暂不填写</option>{v2AiContributionSchema.options.map((key) => <option key={key} value={key}>{v2AiContributionLabels[key]}</option>)}</select></Field>
  </div></>;
}

/** 完成确认先填结果再一次性提交；取消返回原表单，不提前写状态或创建任务。 */
export function TaskCompletion({ title, initial, arrangements, onConfirm, onDone, privateTask = false }: { title: string; initial?: V2Completion; arrangements: Pick<V2ArrangementInput, 'periodId' | 'plannedDays'>[]; onConfirm: (value: V2Completion) => Promise<unknown>; onDone?: () => void; privateTask?: boolean }) {
  const { data } = useWorkspace(), modal = useModal(), action = useAction(), formId = useId();
  const [value, setValue] = useState<V2Completion>({ actualDays: initial?.actualDays ?? null, aiContribution: privateTask ? null : initial?.aiContribution ?? 'high', startedAt: initial?.startedAt ?? null, ...(initial?.completedAt ? { completedAt: initial.completedAt } : {}) });
  const estimates = orderArrangements(arrangements.filter((row) => row.plannedDays !== null), data.periods);
  const cancel = () => { if (modal.canBack) modal.back(); else modal.finish(); };
  return <ModalPage title="完成任务" subtitle={privateTask ? '' : title} className={privateTask ? 'v2-private-completion' : ''} compact busy={action.busy} hideCloseAction onClose={cancel} actions={<><button disabled={action.busy} onClick={cancel}>取消</button><button type="submit" form={formId} className="nt-primary" disabled={action.busy}>确认完成</button></>}>
    {privateTask && <div className="v2-private-completion-context"><p className="v2-private-completion-title">{title}</p><p className="v2-private-completion-hint">确认后，任务将移至「已完成」。</p></div>}
    <div className="v2-completion-form">{estimates.length > 0 && <section className="v2-estimate-reference">{estimates.map((row) => { const period = data.periods.find((item) => item.id === row.periodId); return <div key={row.periodId}><span>预计投入</span><span>{period ? periodLabel(period) : '周期已变化'}</span><strong>{row.plannedDays} 人天</strong></div>; })}</section>}
    <form id={formId} onSubmit={(event) => { event.preventDefault(); void action.act(async () => { await onConfirm(value); (onDone ?? modal.finish)(); }); }}><CompletionTime value={value} onChange={setValue} disabled={action.busy} collapsible optional={privateTask} error={action.error}>{!privateTask && <TaskResultFields value={value} onChange={setValue} required disabled={action.busy} />}</CompletionTime><Feedback error={action.error} /></form></div>
  </ModalPage>;
}
