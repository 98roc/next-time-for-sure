import { useId, useState } from 'react';
import { taskReminderDay, upcomingTaskReminders, v2TaskReminderPlanSchema, type V2TaskReminderPlan } from '@ntfs/contracts';
import { Field } from './controls';
import { ModalPage, useModal } from './modal';
import './task-reminder.css';

const dateTime = new Intl.DateTimeFormat('zh-CN', {
  month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Shanghai',
});
const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' });

/** 入口仅展示下次提醒或待移除；设置先应用到任务草稿。 */
export function TaskReminderButton({ plan, executor, next, pending = false, removing = false, onChange }: {
  plan: V2TaskReminderPlan | null; executor: string | undefined; next: number | null; pending?: boolean; removing?: boolean;
  onChange: (plan: V2TaskReminderPlan | null) => void;
}) {
  const modal = useModal();
  const summary = !executor ? '' : next !== null ? `下次 ${dateTime.format(next)}${pending ? ' · 待保存' : ''}` : removing ? '待移除' : '';
  return <button type="button" className="v2-task-remark-toggle v2-task-reminder-toggle" disabled={!executor} aria-haspopup="dialog"
    onClick={() => { if (executor) modal.push(<TaskReminderDialog plan={plan} executor={executor} onChange={onChange} />); }}>
    <svg className="v2-task-reminder-bell" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
    <span>定时提醒</span>
    {summary && <small>{summary}</small>}
  </button>;
}

/** 编辑日期和模式时计算北京时间预览，只把有效草稿交给新建或编辑表单。 */
function TaskReminderDialog({ plan, executor, onChange }: {
  plan: V2TaskReminderPlan | null; executor: string; onChange: (plan: V2TaskReminderPlan | null) => void;
}) {
  const modal = useModal(), formId = useId(), modeName = useId();
  const [mode, setMode] = useState(plan?.mode ?? 'once');
  const [on, setOn] = useState(plan?.on ?? '');
  const [time, setTime] = useState(plan?.time ?? '09:00');
  const [advanceDays, setAdvanceDays] = useState(String(plan?.mode === 'daily' ? plan.advanceDays : 3));
  const daily = mode === 'daily';
  const parsed = v2TaskReminderPlanSchema.safeParse({ mode, on, time, ...(daily ? { advanceDays: Number(advanceDays) } : {}) });
  const preview = parsed.success ? upcomingTaskReminders(parsed.data, Date.now()) : undefined;
  const dirty = mode !== (plan?.mode ?? 'once') || on !== (plan?.on ?? '') || time !== (plan?.time ?? '09:00') || (daily && advanceDays !== String(plan?.mode === 'daily' ? plan.advanceDays : 3));

  function apply() {
    if (!parsed.success || !upcomingTaskReminders(parsed.data, Date.now()).count) return;
    onChange(parsed.data);
    modal.finish();
  }

  return <ModalPage title="定时提醒" compact hideCloseAction dirty={dirty} onClose={modal.finish} className="v2-task-reminder-dialog" actions={<>
    {plan && <button type="button" className="v2-danger" onClick={() => { onChange(null); modal.finish(); }}>移除提醒</button>}
    <button type="button" onClick={modal.finish}>取消</button><button type="submit" className="nt-primary" form={formId} disabled={!preview?.count}>应用</button>
  </>}>
    <form id={formId} onSubmit={(event) => { event.preventDefault(); apply(); }}>
      <p className="v2-task-reminder-recipient"><span>提醒对象</span> {executor}</p>
      <fieldset className="v2-task-reminder-mode"><legend>提醒方式</legend>
        <label><input type="radio" name={modeName} checked={!daily} onChange={() => setMode('once')} />提醒一次</label>
        <label><input type="radio" name={modeName} checked={daily} onChange={() => setMode('daily')} />提前 N 天每天提醒</label>
      </fieldset>
      <div className={`v2-task-reminder-fields${daily ? ' v2-task-reminder-daily' : ''}`}>
        <Field label={daily ? '目标日期' : '提醒日期'}><input type="date" value={on} required onInput={(event) => setOn(event.currentTarget.value)} /></Field>
        {daily && <Field label="提前天数"><input type="number" min="1" step="1" value={advanceDays} required onChange={(event) => setAdvanceDays(event.target.value)} /></Field>}
        <Field label={daily ? '每天几点' : '提醒时间'}><input type="time" value={time} required onInput={(event) => setTime(event.currentTarget.value)} /></Field>
      </div>
      <section className="v2-task-reminder-preview" aria-label="发送预览" aria-live="polite">
        <div><strong>发送预览</strong><span>北京时间</span></div>
        {preview?.first == null ? <p>{preview ? '请选择未来的提醒时间。' : '请填写有效的提醒时间。'}</p> : <>
          {preview.count > 6 ? <p>{date.format(preview.first)}至{date.format(preview.last)}每天 {time}（共 {preview.count} 次）</p>
            : <ul>{Array.from({ length: preview.count }, (_, index) => taskReminderDay(preview.first ?? 0, index)).map((instant) => <li key={instant}>{dateTime.format(instant)}</li>)}</ul>}
          {preview.elapsed > 0 && <small>跳过已过的 {preview.elapsed} 次提醒。</small>}
        </>}
      </section>
      <p className="v2-task-reminder-delivery">网页仅在右上角「消息」查看。<br />Windows 客户端运行中（含托盘）、已登录且联网时，还会弹出系统通知。</p>
    </form>
  </ModalPage>;
}
