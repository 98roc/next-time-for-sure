import { useState } from 'react';
import { v2PeriodWindowLimits, type V2Period, type V2PeriodWindow } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { ModalPage, useModal } from './modal';
import { Feedback, useAction } from './controls';
import { Confirmation } from './confirmation';
import { PeriodWindowSettings } from './period-window-settings';
import './planning-dialogs.css';

type DateDraft = { today: string; original: V2Period[]; edited: Record<string, V2Period> };

/** 窗口与日期草稿独立；编辑期间固定日期锚点，窗口外的未保存行仍保留。 */
export function PeriodEditor() {
  const { data, run } = useWorkspace(), modal = useModal(), action = useAction();
  const [dateDraft, setDateDraft] = useState<DateDraft | null>(null);
  const [windowDraft, setWindowDraft] = useState<V2PeriodWindow | null>(null);
  const window = windowDraft ?? data.periodWindow;
  const windowConflict = windowDraft !== null && windowDraft.version !== data.periodWindow.version;

  // 已编辑行保留原版本；新补建区间可以进入窗口，不覆盖任何日期草稿。
  const originals = new Map((dateDraft?.original ?? data.periods).map((row) => [row.id, row]));
  const periods = data.periods.map((row) => originals.get(row.id) ?? row);
  const today = dateDraft?.today ?? data.today;
  const current = periods.findIndex((row) => row.startOn <= today && row.endOn >= today);
  const visibleIds = new Set(periods.slice(Math.max(0, current - window.before), current + window.after + 1).map((row) => row.id));
  const changes = Object.values(dateDraft?.edited ?? {}).map((row) => ({ periodId: row.id, version: row.version, startOn: row.startOn, endOn: row.endOn }));
  const dateConflict = changes.some((change) => data.periods.find((row) => row.id === change.periodId)?.version !== change.version);
  const rows = periods.filter((row) => visibleIds.has(row.id) || dateDraft?.edited[row.id]).map((row) => dateDraft?.edited[row.id] ?? row);
  const positions = new Map(periods.map((row, index) => [row.id, index - current]));

  /** 日期首次修改固定基线；恢复原值时清除草稿并恢复自动滚动。 */
  function editDate(row: V2Period, field: 'startOn' | 'endOn', value: string) {
    const draft = dateDraft ?? { today: data.today, original: data.periods, edited: {} };
    const original = draft.original.find((period) => period.id === row.id) ?? row;
    const next = { ...row, [field]: value }, edited = { ...draft.edited, [row.id]: next };
    if (original.startOn === next.startOn && original.endOn === next.endOn) delete edited[row.id];
    // 编辑期间补入的行也记录其原始边界，便于恢复原值和并发核对。
    const originalRows = draft.original.some((period) => period.id === row.id) ? draft.original : [...draft.original, original];
    setDateDraft(Object.keys(edited).length ? { ...draft, original: originalRows, edited } : null);
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
    });
  }

  // 目录版本取当前快照，编辑行仍携带首次修改时版本；窗口补建不会令自己的日期草稿失效。
  const intent = { action: 'change_periods' as const, version: data.teamVersion, periods: changes };
  return <ModalPage title="日期区间" className="v2-period-modal" busy={action.busy} dirty={changes.length > 0 || windowDraft !== null}
    footerNote={data.teamLeader ? <button className="v2-period-reset" disabled={action.busy || (window.before === v2PeriodWindowLimits.before && window.after === v2PeriodWindowLimits.after)} onClick={() => changeWindow({ before: v2PeriodWindowLimits.before, after: v2PeriodWindowLimits.after })}>恢复默认范围</button> : undefined}
    actions={data.teamLeader ? windowDraft ? <>
      <button disabled={action.busy} onClick={() => { setWindowDraft(null); action.clear(); }}>{windowConflict ? '读取最新范围' : '撤销范围修改'}</button>
      <button className="nt-primary" disabled={action.busy || windowConflict} onClick={saveWindow}>{action.busy ? '正在保存…' : '保存展示范围'}</button>
    </> : <>
      {changes.length > 0 && <button disabled={action.busy} onClick={() => setDateDraft(null)}>撤销日期修改</button>}
      <button className="nt-primary" disabled={!changes.length || action.busy || dateConflict} onClick={() => modal.push(<Confirmation label="确认调整日期区间" intent={intent} onConfirm={(confirmation) => run('planning', { ...intent, operationId: createOperationId(), confirmation })} onDone={modal.finish} />)}>核对日期影响</button>
    </> : undefined}>
    <PeriodWindowSettings value={window} editable={data.teamLeader} busy={action.busy} onChange={changeWindow} />
    {windowConflict && <p role="alert" className="v2-error">展示范围已被其他负责人修改，请读取最新范围后重新调整。</p>}
    <Feedback error={action.error} />
    {dateDraft && dateDraft.today !== data.today && <p className="v2-context">日期草稿已保留，窗口暂不自动滚动；已结束区间不能再修改。</p>}
    {dateConflict && <p className="v2-error" role="alert">正在编辑的区间已被修改，请撤销日期修改后重新编辑。</p>}
    <table className="v2-period-table" aria-label="区间日期"><thead><tr><th scope="col">区间</th><th scope="col">开始日期</th><th scope="col">结束日期</th></tr></thead><tbody>{rows.map((row) => {
      const ended = (originals.get(row.id)?.endOn ?? row.endOn) < data.today;
      const offset = positions.get(row.id) ?? 0;
      const status = ended ? '已结束' : offset === 0 ? '当前' : `未来 ${offset}`;
      return <tr className="v2-period-row" key={row.id}>
        <td><span className={offset === 0 && !ended ? 'v2-period-current' : 'v2-period-status'}>{status}</span>{!visibleIds.has(row.id) && <span className="v2-period-outside">窗口外未保存的日期修改</span>}</td>
        {(['startOn', 'endOn'] as const).map((field) => {
          const label = field === 'startOn' ? '开始日期' : '结束日期';
          return <td key={field}><span className="v2-period-date-label" aria-hidden="true">{label}</span>{ended || !data.teamLeader ? <time dateTime={row[field]}>{row[field].replaceAll('-', '/')}</time> : <input type="date" aria-label={`${status}${label}`} value={row[field]} disabled={action.busy} onChange={(event) => editDate(row, field, event.target.value)} />}</td>;
        })}
      </tr>;
    })}</tbody></table>
  </ModalPage>;
}
