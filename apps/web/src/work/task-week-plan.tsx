import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Identity, WeeklyPlanCommand, WorkSnapshot } from '@ntfs/contracts';
import { shiftWeek, weekStart, weekLabel } from '../layout/week-picker';
import { selectedWeek } from '../weekly-plans/reporting-api';
import { moveWeeklyArrangement, weeklyCommand, weeklySnapshot } from '../weekly-plans/api';
import { ArrangementFields, arrangementValues } from '../weekly-plans/arrangement-fields';

type Snapshot = Awaited<ReturnType<typeof weeklySnapshot>>;
type Editor = { week: string; assignmentId: string };
type Row = { key: string; person: string; group: string };

/** 两周共享人员列表；新增按周保存，编辑、移出和移周使用后端版本校验。 */
export function TaskWeekPlan({ task, teamId, identity, onAssign, initialWeek }: { task: WorkSnapshot['tasks'][number]; teamId: string; identity: Identity; onAssign: () => void; initialWeek?: string | undefined }) {
  const client = useQueryClient();
  const [week, setWeek] = useState(() => initialWeek ?? selectedWeek());
  const [editing, setEditing] = useState<Editor | null>(null);
  const [notice, setNotice] = useState('');
  const next = shiftWeek(week, 1);
  const first = useQuery({ queryKey: ['weekly', identity.id, teamId, week], queryFn: () => weeklySnapshot(teamId, week), retry: false });
  const second = useQuery({ queryKey: ['weekly', identity.id, teamId, next], queryFn: () => weeklySnapshot(teamId, next), retry: false });
  const columns = [{ week, data: first.isError ? undefined : first.data }, { week: next, data: second.isError ? undefined : second.data }];
  async function refresh() { await Promise.all(['weekly', 'reports', 'overview'].map((key) => client.invalidateQueries({ queryKey: [key] }))); }
  const save = useMutation({ mutationFn: (command: WeeklyPlanCommand) => weeklyCommand(command, identity.csrfToken), onSuccess: async () => { setEditing(null); setNotice('周安排已保存。'); await refresh(); }, onError: refresh });
  const move = useMutation({ mutationFn: async ({ data, id }: { data: Snapshot; id: string }) => {
    const row = data.draft?.arrangements.find((item) => item.id === id);
    if (!row) throw new Error('安排已变化，请刷新核对。');
    await moveWeeklyArrangement(teamId, week, next, row, identity.csrfToken);
  }, onSuccess: async () => { setEditing(null); setNotice('已移至后一周，已有目标和投入按移周规则保留。'); await refresh(); }, onError: refresh });
  const busy = save.isPending || move.isPending;
  const rows = new Map<string, Row>();

  // 停止记录与待分配事项保留；只读角色仅使用发布副本。
  for (const { data } of columns) for (const row of (data?.canEdit ? data.draft?.rows : data?.publications[0]?.rows) ?? []) {
    const key = row.sourceIds[0];
    if (row.taskId === task.id && key) rows.set(key, { key, person: row.person, group: '' });
  }
  for (const { data } of columns) for (const candidate of data?.candidates ?? []) {
    if (candidate.taskId === task.id) rows.set(candidate.assignmentId, { key: candidate.assignmentId, person: candidate.displayName, group: candidate.groupName });
  }
  const error = first.error ?? second.error ?? save.error ?? move.error;
  function changeWeek(value: string) { if (!value) return; setWeek(weekStart(value)); setEditing(null); setNotice(''); save.reset(); move.reset(); }
  function add(data: Snapshot, target: string, assignmentId?: string) {
    const candidates = data.candidates.filter((entry) => entry.taskId === task.id && (!assignmentId || entry.assignmentId === assignmentId) && !data.draft?.arrangements.some((row) => row.assignmentId === entry.assignmentId));
    if (!candidates.length) return;
    setNotice(''); save.mutate({ action: 'save_arrangements', teamId, week: target, arrangements: candidates.map((entry) => ({ assignmentId: entry.assignmentId, assignmentVersion: entry.assignmentVersion, taskVersion: entry.taskVersion, version: null, goal: '', expectedProgress: null, plannedDays: null })) });
  }

  return <section className="task-week-plan">
    <div className="task-plan-toolbar"><label>起始周<input aria-label="周安排起始日期" type="date" value={week} disabled={busy} onChange={(event) => changeWeek(event.target.value)} /></label><button className="text-button" disabled={busy} onClick={() => changeWeek(selectedWeek())}>回到本周</button>{!initialWeek && <Link to={`/weekly-plans?week=${week}`}>完整周计划 →</Link>}</div>
    {error && <p role="alert" className="form-error">{error.message} <button disabled={busy} onClick={() => { void first.refetch(); void second.refetch(); }}>刷新核对</button></p>}
    {(first.isPending || second.isPending) && <p role="status">正在读取两周安排…</p>}{notice && <p role="status">{notice}</p>}
    <div className="task-plan-matrix" role="table" aria-label="人员两周安排">
      <div className="task-plan-line task-plan-head" role="row"><div role="columnheader">执行人</div>{columns.map((column) => <div role="columnheader" key={column.week}><strong>{weekLabel(column.week)}</strong><small>{column.week} 起</small><span className="detail-meta">{column.data?.draft?.hasUnpublishedChanges ? '有未发布调整' : column.data?.publications.length ? '已发布' : '草稿'}</span>{column.data?.canEdit && column.data.candidates.some((entry) => entry.taskId === task.id && !column.data?.draft?.arrangements.some((row) => row.assignmentId === entry.assignmentId)) && <button className="text-button" disabled={busy} onClick={() => { if (column.data) add(column.data, column.week); }}>安排全部未排人员</button>}</div>)}</div>
      {[...rows.values()].map((person) => <div className="task-plan-line" role="row" key={person.key}><div className="task-plan-person" role="rowheader"><strong>{person.person}</strong><small>{person.group}</small></div>{columns.map(({ week: target, data }) => {
        const arrangement = data?.draft?.arrangements.find((entry) => entry.assignmentId === person.key);
        const candidate = data?.candidates.find((entry) => entry.assignmentId === person.key);
        const row = (data?.canEdit ? data.draft?.rows : data?.publications[0]?.rows)?.find((entry) => entry.taskId === task.id && entry.sourceIds.includes(person.key));
        const pending = data?.draft?.pending.find((entry) => row?.sourceIds.includes(entry.id));
        return <div className="task-plan-cell" role="cell" key={target}>
          {!data ? <span>暂不可用</span> : row ? <><div className="task-plan-cell-actions">{candidate && arrangement ? <button className="text-button" disabled={busy} onClick={() => { setEditing({ week: target, assignmentId: person.key }); save.reset(); }}>已安排 · 编辑</button> : <span className="detail-meta">{pending ? '待分配' : data.canEdit ? '已停止／完成' : '已发布'}</span>}{data.canEdit && (arrangement || pending) && <details className="task-plan-more"><summary>更多</summary><div>{target === week && candidate && arrangement && <button disabled={busy} onClick={() => move.mutate({ data, id: arrangement.id })}>移至{weekLabel(next)}</button>}<button disabled={busy} onClick={() => { if (arrangement) save.mutate({ action: 'remove_arrangement', teamId, week: target, arrangementId: arrangement.id, version: arrangement.version }); else if (pending) save.mutate({ action: 'remove_pending', teamId, week: target, pendingId: pending.id, version: pending.version }); }}>移出该周</button></div></details>}</div>{row.text && <p>{row.text}</p>}{row.plannedDays !== null && <small>投入 {row.plannedDays} 天</small>}</> : candidate ? <button className="text-button" disabled={busy} onClick={() => add(data, target, person.key)}>＋ 安排</button> : <span className="detail-meta">未安排</span>}
        </div>;
      })}</div>)}
    </div>
    {!rows.size && !first.isPending && !second.isPending && <p className="empty-state">暂无可见安排。<button className="text-button" onClick={onAssign}>查看人员分工</button></p>}
    {columns.map(({ week: target, data }) => {
      if (editing?.week !== target) return null;
      const row = data?.draft?.arrangements.find((entry) => entry.assignmentId === editing.assignmentId);
      const candidate = data?.candidates.find((entry) => entry.assignmentId === editing.assignmentId);
      if (!row || !candidate) return null;
      return <form className="task-plan-editor" key={`${target}:${row.id}:${row.version}`} onSubmit={(event) => { event.preventDefault(); save.mutate({ action: 'save_arrangement', teamId, week: target, assignmentId: candidate.assignmentId, assignmentVersion: candidate.assignmentVersion, taskVersion: candidate.taskVersion, version: row.version, ...arrangementValues(event.currentTarget) }); }}><fieldset disabled={busy}><h4>{candidate.displayName} · {weekLabel(target)}</h4><ArrangementFields week={target} arrangement={row} /><div className="workflow-footer"><button type="button" onClick={() => setEditing(null)}>取消</button><button className="primary-button">保存</button></div></fieldset></form>;
    })}
  </section>;
}
