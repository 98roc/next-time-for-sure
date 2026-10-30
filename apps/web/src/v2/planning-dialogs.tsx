import { useEffect, useState } from 'react';
import { missingPeriodWindowDates, v2PeriodWindowLimits, type V2PeriodWindow } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { ModalPage, useModal } from './modal';
import { Feedback, useAction } from './controls';
import { Confirmation } from './confirmation';
import { PeriodWindowSettings } from './period-window-settings';
import { bindPreviewDates, editPeriodDate, type PeriodDateDraft, type PeriodEditorPeriod } from './period-date-draft';
import './planning-dialogs.css';

/** 窗口与日期草稿独立；编辑期间固定日期锚点，窗口外的未保存行仍保留。 */
export function PeriodEditor() {
  const { data, run } = useWorkspace(), modal = useModal(), action = useAction();
  const [dateDraft, setDateDraft] = useState<PeriodDateDraft | null>(null);
  const [windowDraft, setWindowDraft] = useState<V2PeriodWindow | null>(null);
  const window = windowDraft ?? data.periodWindow;
  const windowConflict = windowDraft !== null && windowDraft.version !== data.periodWindow.version;

  // 服务端补建后只转换新行的草稿身份，不改写用户输入，也不跳过日期确认。
  useEffect(() => { setDateDraft((draft) => bindPreviewDates(draft, data.periods)); }, [data.periods]);

  // 已编辑行保留原版本；新补建区间可以进入窗口，不覆盖任何日期草稿。
  const originals = new Map((dateDraft?.original ?? data.periods).map((row) => [row.id, row]));
  const today = dateDraft?.today ?? data.today;
  const savedPeriods = data.periods.map((row) => originals.get(row.id) ?? row);

  // 新行可编辑，但不伪造业务ID；缩小范围时仍保留窗口外尚未保存的新行。
  const previewDates = missingPeriodWindowDates(savedPeriods, today, { before: window.before, after: window.after });
  for (const { original } of Object.values(dateDraft?.previews ?? {})) {
    if (![...savedPeriods, ...previewDates].some((row) => row.startOn === original.startOn && row.endOn === original.endOn)) previewDates.push(original);
  }
  const previewPeriods = previewDates.map((dates) => ({ ...dates, id: null }));
  const periods = [...savedPeriods, ...previewPeriods].sort((a, b) => a.startOn.localeCompare(b.startOn));
  const current = periods.findIndex((row) => row.startOn <= today && row.endOn >= today);
  const visible = periods.slice(Math.max(0, current - window.before), current + window.after + 1);
  const changes = Object.values(dateDraft?.edited ?? {}).map((row) => ({ periodId: row.id, version: row.version, startOn: row.startOn, endOn: row.endOn }));
  const dateConflict = changes.some((change) => data.periods.find((row) => row.id === change.periodId)?.version !== change.version);
  const unboundDates = Object.keys(dateDraft?.previews ?? {}).length > 0;
  const rows = periods.filter((row) => visible.includes(row) || (row.id !== null ? dateDraft?.edited[row.id] : dateDraft?.previews[row.startOn]));
  const positions = new Map(periods.map((row, index) => [row.startOn, index - current]));

  /** 日期首次修改固定基线，新行与已有行均保留独立草稿。 */
  function editDate(row: PeriodEditorPeriod, field: 'startOn' | 'endOn', value: string) {
    setDateDraft((draft) => editPeriodDate(draft, data.periods, data.today, row, field, value));
  }

  /** 数量改回服务端值即撤销窗口草稿；始终保留首次编辑版本用于冲突检测。 */
  function changeWindow(counts: { before: number; after: number }) {
    action.clear();
    setWindowDraft(counts.before === data.periodWindow.before && counts.after === data.periodWindow.after ? null : { ...counts, version: window.version });
  }

  /** 范围单独提交，不携带或清除日期修改。 */
  function saveWindow() {
    if (!windowDraft) return;
    void action.act(async () => {
      await run('planning', { action: 'set_period_window', operationId: createOperationId(), ...windowDraft });
      setWindowDraft(null);
      // 范围独立保存不能丢弃日期草稿；没有其他未保存内容时直接结束弹窗。
      if (!dateDraft) modal.finish();
    });
  }

  // 目录版本取当前快照，编辑行仍携带首次修改时版本；窗口补建不会令自己的日期草稿失效。
  const intent = { action: 'change_periods' as const, version: data.teamVersion, periods: changes };
  return <ModalPage title="日期区间" className="v2-period-modal" busy={action.busy} dirty={dateDraft !== null || windowDraft !== null}
    footerNote={data.teamLeader ? <button className="v2-period-reset" disabled={action.busy || (window.before === v2PeriodWindowLimits.before && window.after === v2PeriodWindowLimits.after)} onClick={() => changeWindow({ before: v2PeriodWindowLimits.before, after: v2PeriodWindowLimits.after })}>恢复默认范围</button> : undefined}
    actions={data.teamLeader ? windowDraft ? <>
      <button disabled={action.busy} onClick={() => { setWindowDraft(null); action.clear(); }}>{windowConflict ? '读取最新范围' : '撤销范围修改'}</button>
      <button className="nt-primary" disabled={action.busy || windowConflict} onClick={saveWindow}>{action.busy ? '正在保存…' : '保存展示范围'}</button>
    </> : <>
      {dateDraft && <button disabled={action.busy} onClick={() => setDateDraft(null)}>撤销日期修改</button>}
      <button className="nt-primary" disabled={!changes.length || action.busy || dateConflict || unboundDates} onClick={() => modal.push(<Confirmation label="确认调整日期区间" intent={intent} onConfirm={(confirmation) => run('planning', { ...intent, operationId: createOperationId(), confirmation })} onDone={modal.finish} />)}>核对日期影响</button>
    </> : undefined}>
    <PeriodWindowSettings value={window} editable={data.teamLeader} busy={action.busy} onChange={changeWindow} />
    {windowConflict && <p role="alert" className="v2-error">展示范围已被其他负责人修改，请读取最新范围后重新调整。</p>}
    <Feedback error={action.error} />
    {dateDraft && dateDraft.today !== data.today && <p className="v2-context">日期草稿已保留，窗口暂不自动滚动；已结束区间不能再修改。</p>}
    {dateConflict && <p className="v2-error" role="alert">正在编辑的区间已被修改，请撤销日期修改后重新编辑。</p>}
    {unboundDates && !windowDraft && <p className="v2-context">待保存的新行仍有日期修改，请扩大范围并保存，或撤销日期修改。</p>}
    <table className="v2-period-table" aria-label="区间日期"><thead><tr><th scope="col">区间</th><th scope="col">开始日期</th><th scope="col">结束日期</th></tr></thead><tbody>{rows.map((row) => {
      const edited = row.id !== null ? dateDraft?.edited[row.id] : dateDraft?.previews[row.startOn]?.edited;
      // 刷新到正式记录、尚未完成草稿绑定的同一帧也显示原输入，避免日期闪回。
      const values = edited ?? dateDraft?.previews[row.startOn]?.edited ?? row;
      const ended = (row.id !== null ? originals.get(row.id)?.endOn ?? row.endOn : row.endOn) < data.today;
      const offset = positions.get(row.id !== null ? originals.get(row.id)?.startOn ?? row.startOn : row.startOn) ?? 0;
      const status = ended ? '已结束' : offset === 0 ? '当前' : `未来 ${offset}`;
      return <tr className="v2-period-row" key={row.id ?? `preview:${row.startOn}`} data-preview={row.id === null || undefined}>
        <td><span className={offset === 0 && !ended ? 'v2-period-current' : 'v2-period-status'}>{status}</span>{row.id === null && <span className="v2-period-outside">待保存</span>}{!visible.includes(row) && <span className="v2-period-outside">窗口外未保存的日期修改</span>}</td>
        {(['startOn', 'endOn'] as const).map((field) => {
          const label = field === 'startOn' ? '开始日期' : '结束日期';
          return <td key={field}><span className="v2-period-date-label" aria-hidden="true">{label}</span>{ended || !data.teamLeader ? <time dateTime={values[field]}>{values[field].replaceAll('-', '/')}</time> : <input type="date" aria-label={`${status}${label}`} value={values[field]} disabled={action.busy} onChange={(event) => editDate(row, field, event.target.value)} />}</td>;
        })}
      </tr>;
    })}</tbody></table>
  </ModalPage>;
}
