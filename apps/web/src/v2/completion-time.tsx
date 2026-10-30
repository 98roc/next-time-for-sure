import { useEffect, useId, useState, type ReactNode } from 'react';
import type { V2Completion } from '@ntfs/contracts';
import { Field } from './controls';
import './execution-times.css';

/** 日期控件始终按上海时间显示，传输统一为 UTC；不依赖客户端时区。 */
export function shanghaiMinute(instant: string): string { return new Date(Date.parse(instant) + 8 * 3_600_000).toISOString().slice(0, 16); }

/** 编辑页可合并结果与时间；完成窗口折叠时间，个人任务允许留空，时间错误时展开定位。 */
export function CompletionTime({ value, onChange, disabled = false, collapsible = false, optional = false, error = '', children }: { value: V2Completion; onChange: (value: V2Completion) => void; disabled?: boolean; collapsible?: boolean; optional?: boolean; error?: string; children?: ReactNode }) {
  const [openedAt] = useState(() => new Date().toISOString()), [expanded, setExpanded] = useState(false), [invalid, setInvalid] = useState(false), id = useId();
  const completed = shanghaiMinute(value.completedAt ?? openedAt), now = shanghaiMinute(new Date().toISOString());
  useEffect(() => { if (error.includes('时间')) setExpanded(true); }, [error]);
  return <section className={`v2-execution-times${collapsible ? ' is-collapsible' : ''}`}>
    <div className="v2-section-head">{collapsible ? <>{children && <h3>完成结果</h3>}<button type="button" className="nt-link v2-execution-toggle" data-v2-autofocus={optional ? true : undefined} aria-expanded={expanded} aria-controls={id} disabled={disabled} onClick={() => setExpanded(!expanded)}>{optional ? '补充时间（选填）' : '开始完成时间'} <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span></button></> : <h3>{children ? '完成结果与时间' : '开始完成时间'}</h3>}</div>
    {children}
    <div id={id} className="v2-fields v2-execution-inputs" hidden={collapsible && !expanded} onInvalidCapture={() => setExpanded(true)}>
      <Field label="开始时间"><input aria-label="实际开始时间（北京时间）" type="datetime-local" value={value.startedAt ? shanghaiMinute(value.startedAt) : ''} max={value.completedAt ? completed : now} disabled={disabled} onChange={(event) => { const input = event.target.value; onChange({ ...value, startedAt: input ? new Date(`${input}:00+08:00`).toISOString() : null }); }} /></Field>
      <Field label="完成时间"><input aria-label="实际完成时间（北京时间）" type="datetime-local" required={!optional} value={invalid || (optional && !value.completedAt) ? '' : completed} max={now} disabled={disabled} onChange={(event) => { const input = event.target.value; setInvalid(!optional && !input); if (input) onChange({ ...value, completedAt: new Date(`${input}:00+08:00`).toISOString() }); else if (optional) onChange({ ...value, completedAt: undefined }); }} /></Field>
    </div>
    {optional && expanded && <p className="v2-private-completion-hint">完成时间不填则记录为确认时的时间（北京时间）。</p>}
  </section>;
}
