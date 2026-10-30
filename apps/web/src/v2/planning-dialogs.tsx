import { useState } from 'react';
import type { V2Period, V2PeriodWindow } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { ModalPage, useModal } from './modal';
import { Field, useAction } from './controls';
import { Confirmation } from './confirmation';
import { PeriodWindowSettings } from './period-window-settings';

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

  function changeWindow(counts: { before: number; after: number }) {
    action.clear();
    setWindowDraft(counts.before === data.periodWindow.before && counts.after === data.periodWindow.after ? null : { ...counts, version: window.version });
  }

  function saveWindow() {
    if (!windowDraft) return;
    void action.act(async () => {
      await run('planning', { action: 'set_period_window', operationId: createOperationId(), ...windowDraft });
      setWindowDraft(null);
    });
  }

  // 目录版本取当前快照，编辑行仍携带首次修改时版本；窗口补建不会令自己的日期草稿失效。
  const intent = { action: 'change_periods' as const, version: data.teamVersion, periods: changes };
  return <ModalPage title="日期区间" wide busy={action.busy} dirty={changes.length > 0 || windowDraft !== null} actions={data.teamLeader ? <><button disabled={!changes.length || action.busy} onClick={() => setDateDraft(null)}>撤销日期修改</button><button className="nt-primary" disabled={!changes.length || action.busy || windowDraft !== null || dateConflict} onClick={() => modal.push(<Confirmation label="确认调整日期区间" intent={intent} onConfirm={(confirmation) => run('planning', { ...intent, operationId: createOperationId(), confirmation })} onDone={modal.finish} />)}>核对影响</button></> : undefined}>
    <PeriodWindowSettings value={window} editable={data.teamLeader} dirty={windowDraft !== null} busy={action.busy} conflict={windowConflict} error={action.error} onChange={changeWindow} onSave={saveWindow} onCancel={() => { setWindowDraft(null); action.clear(); }} />
    <p className="v2-context">区间连续且不重叠；已结束区间日期锁定。日期修改需单独核对影响。{windowDraft && changes.length > 0 && '请先保存或撤销窗口修改，再提交日期。'}</p>
    {dateDraft && dateDraft.today !== data.today && <p className="v2-context">日期草稿已保留，窗口暂不自动滚动；已结束区间不能再修改。</p>}
    {dateConflict && <p className="v2-error" role="alert">正在编辑的区间已被修改，请撤销日期修改后重新编辑。</p>}
    {rows.map((row) => {
      const locked = (originals.get(row.id)?.endOn ?? row.endOn) < data.today || !data.teamLeader || action.busy;
      return <div className="w-period-editor" key={row.id}>
        {!visibleIds.has(row.id) && <p className="v2-context v2-period-outside">窗口外未保存的日期修改</p>}
        <Field label={`开始日期${locked ? '（锁定）' : ''}`}><input type="date" value={row.startOn} disabled={locked} onChange={(event) => editDate(row, 'startOn', event.target.value)} /></Field>
        <Field label="结束日期"><input type="date" value={row.endOn} disabled={locked} onChange={(event) => editDate(row, 'endOn', event.target.value)} /></Field>
      </div>;
    })}
  </ModalPage>;
}
