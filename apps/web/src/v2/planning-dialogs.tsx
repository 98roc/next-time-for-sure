import { useState } from 'react';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { ModalPage, useModal } from './modal';
import { Feedback, Field, periodLabel, useAction } from './controls';
import { Confirmation } from './confirmation';

/** 选择既有任务保持单一身份；已安排及已完成记录保留原因，不静默重复或覆盖投入。 */
export function ExistingTasks({ projectId, periodId }: { projectId: string; periodId: string }) {
  const { data, run } = useWorkspace(), modal = useModal(), action = useAction();
  const [search, setSearch] = useState(''), [selected, setSelected] = useState<string[]>([]);
  const tasks = data.tasks.filter((row) => row.projectId === projectId), period = data.periods.find((row) => row.id === periodId);
  const eligible = (id: string) => !data.arrangements.some((row) => row.taskId === id && row.periodId === periodId);
  return <ModalPage title="选择已有任务" busy={action.busy} dirty={selected.length > 0} actions={<button className="nt-primary" disabled={!selected.length || action.busy} onClick={() => { void action.act(async () => { const chosen = selected.flatMap((id) => { const task = tasks.find((row) => row.id === id); return task ? [{ taskId: id, version: task.version }] : []; }); if (chosen.length !== selected.length) throw new Error('所选任务已变化，请重新选择。'); await run('add-existing', { action: 'add_existing', operationId: createOperationId(), periodId, tasks: chosen }); modal.finish(); }); }}>加入安排（{selected.length}）</button>}>
    <p className="v2-context">{data.projects.find((row) => row.id === projectId)?.name} · {period ? periodLabel(period) : ''}。新加入区间的预计天数留空。</p><Field label="搜索任务"><input value={search} onChange={(event) => setSearch(event.target.value)} /></Field>
    {tasks.filter((row) => row.title.includes(search)).map((task) => <label className="w-choice" key={task.id}><input type="checkbox" disabled={!eligible(task.id) || action.busy} checked={selected.includes(task.id)} onChange={(event) => setSelected((previous) => event.target.checked ? [...previous, task.id] : previous.filter((id) => id !== task.id))} /><span>{task.title}<small className="v2-option-note">{data.accounts.find((row) => row.id === task.executorId)?.displayName}{eligible(task.id) ? task.status === 'completed' ? ' · 已完成' : '' : ' · 该区间已有安排，请直接编辑'}</small></span></label>)}{!tasks.length && <p>项目暂无可选任务。</p>}<Feedback error={action.error} />
  </ModalPage>;
}

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
