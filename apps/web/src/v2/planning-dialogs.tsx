import { useState } from 'react';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { ModalPage, useModal } from './modal';
import { Field } from './controls';
import { Confirmation } from './confirmation';

/** 整体日期调整保留已结束边界，提交前展示全部受影响安排和文字稿。 */
export function PeriodEditor() {
  const { data, run } = useWorkspace(), modal = useModal();
  const [original] = useState(data.periods), [rows, setRows] = useState(data.periods), [version] = useState(data.teamVersion);
  const changes = rows.filter((row) => { const previous = original.find((item) => item.id === row.id); return previous && (row.startOn !== previous.startOn || row.endOn !== previous.endOn); }).map((row) => ({ periodId: row.id, version: row.version, startOn: row.startOn, endOn: row.endOn }));
  return <ModalPage title="日期区间" wide dirty={changes.length > 0} actions={data.teamLeader ? <button className="nt-primary" disabled={!changes.length} onClick={() => modal.push(<Confirmation label="确认调整日期区间" intent={{ action: 'change_periods', version, periods: changes }} onConfirm={(confirmation) => run('planning', { action: 'change_periods', operationId: createOperationId(), version, periods: changes, confirmation })} onDone={modal.finish} />)}>核对影响</button> : undefined}>
    <p className="v2-context">区间连续且不重叠；已结束区间日期锁定。{!data.teamLeader && '日期由团队负责人维护。'}</p>
    {rows.map((row) => { const locked = row.endOn < data.today || !data.teamLeader; return <div className="w-period-editor" key={row.id}><Field label={`开始日期${locked ? '（锁定）' : ''}`}><input type="date" value={row.startOn} disabled={locked} onChange={(event) => setRows((previous) => previous.map((item) => item.id === row.id ? { ...item, startOn: event.target.value } : item))} /></Field><Field label="结束日期"><input type="date" value={row.endOn} disabled={locked} onChange={(event) => setRows((previous) => previous.map((item) => item.id === row.id ? { ...item, endOn: event.target.value } : item))} /></Field></div>; })}
  </ModalPage>;
}
