import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { weeklyPlanCommandSchema } from '@ntfs/contracts';
import type { Identity, WeeklyPlanCommand, WorkSnapshot } from '@ntfs/contracts';
import { shiftWeek, WeekPicker, weekLabel } from '../layout/week-picker';
import { selectedWeek } from '../weekly-plans/reporting-api';
import { moveWeeklyArrangement, weeklyCommand, weeklySnapshot } from '../weekly-plans/api';
import { ArrangementFields, arrangementValues } from '../weekly-plans/arrangement-fields';

/** 项目任务内编排同一份共享草稿；保存、移出和移周都遵守周计划的权限及并发保护。 */
export function TaskWeekPlan({ task, teamId, identity, onAssign }: { task: WorkSnapshot['tasks'][number]; teamId: string; identity: Identity; onAssign: () => void }) {
  const client = useQueryClient();
  const [week, setWeek] = useState(selectedWeek);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [editing, setEditing] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const state = useQuery({ queryKey: ['weekly', identity.id, teamId, week], queryFn: () => weeklySnapshot(teamId, week), retry: false });
  const data = state.isError ? undefined : state.data;
  const save = useMutation({ mutationFn: (command: WeeklyPlanCommand) => weeklyCommand(command, identity.csrfToken), onSuccess: async () => {
    setEditing(''); setExcluded([]); setNotice(`${weekLabel(week)}草稿已更新，由团队负责人确认发布。`);
    await Promise.all(['weekly', 'reports', 'overview'].map((key) => client.invalidateQueries({ queryKey: [key] })));
  } });
  const moving = useMutation({ mutationFn: async (id: string) => {
    const row = data?.draft?.arrangements.find((entry) => entry.id === id); if (!row) throw new Error('请刷新周安排。');
    const targetWeek = shiftWeek(week, 1);
    await moveWeeklyArrangement(teamId, week, targetWeek, row, identity.csrfToken);
  }, onSuccess: async () => { setNotice('已移至后一周；若该周已有安排，保留其目标和投入。两周草稿均已同步，已发布版本保留。'); await Promise.all(['weekly', 'reports', 'overview'].map((key) => client.invalidateQueries({ queryKey: [key] }))); } });
  function send(input: unknown) { const parsed = weeklyPlanCommandSchema.safeParse(input); if (!parsed.success) { setError('请核对进度与投入天数。'); return; } setError(''); setNotice(''); save.mutate(parsed.data); }
  const candidates = data?.candidates.filter((entry) => entry.taskId === task.id) ?? [];
  const unscheduled = candidates.filter((entry) => !data?.draft?.arrangements.some((row) => row.assignmentId === entry.assignmentId));
  const selected = unscheduled.filter((entry) => !excluded.includes(entry.assignmentId));
  const scheduled = data?.draft?.rows.filter((entry) => entry.taskId === task.id) ?? [];
  const busy = save.isPending || moving.isPending;
  return <section className="task-week-plan"><div className="section-heading"><div><h3>安排到哪一周</h3><p className="subtitle">先选执行人，再加入草稿；目标和投入可以稍后补充。</p></div></div>
    <fieldset disabled={busy}><WeekPicker value={week} onChange={(value) => { setWeek(value); setExcluded([]); setEditing(''); setNotice(''); setError(''); save.reset(); moving.reset(); }} /></fieldset>
    {(error || save.error || moving.error || state.error) && <p role="alert" className="form-error">{error || save.error?.message || moving.error?.message || state.error?.message}<button disabled={busy} onClick={() => { void state.refetch(); }}>刷新核对</button></p>}
    {state.isPending && <p role="status">正在读取周安排…</p>}{notice && <p role="status">{notice}</p>}
    {data && <><p className="detail-meta">{data.draft?.hasUnpublishedChanges ? '有未发布调整 · 已发布版本保持不变' : data.publications.length ? '已有发布版本，后续修改先保存为草稿' : '尚未发布'}<Link className="button-link" to={`/weekly-plans?week=${week}`}>查看完整周计划 →</Link></p>
      {!data.canEdit && <><p>当前角色可查看已发布安排；人员和周安排由团队负责人或负责小组的组长维护。</p>{data.publications[0]?.rows.filter((row) => row.taskId === task.id).map((row) => <p key={row.sourceIds.join(':')}>{row.person} · {row.text}</p>)}</>}
      {data.canEdit && <><div className="weekly-task-rows">{scheduled.map((row) => {
        const arrangement = data.draft?.arrangements.find((entry) => row.sourceIds.includes(entry.assignmentId));
        const pending = data.draft?.pending.find((entry) => row.sourceIds.includes(entry.id));
        const candidate = candidates.find((entry) => entry.assignmentId === arrangement?.assignmentId);
        return <article key={row.sourceIds.join(':')} className="weekly-task-row"><div className="section-heading"><strong>{row.person}</strong><span className="status-badge">{candidate ? '已安排' : pending ? '待落实人员' : '已停止或完成'}</span></div>{(row.text || row.plannedDays !== null) && <p>{[row.text, row.plannedDays === null ? '' : `${row.plannedDays} 天`].filter(Boolean).join(' · ')}</p>}<div className="assignment-actions">{candidate && arrangement && <><button disabled={busy} onClick={() => setEditing(editing === arrangement.id ? '' : arrangement.id)}>编辑周安排</button><button disabled={busy} onClick={() => { setNotice(''); moving.mutate(arrangement.id); }}>移至{weekLabel(shiftWeek(week, 1))}</button></>}{(arrangement || pending) && <button disabled={busy} onClick={() => { if (arrangement) send({ action: 'remove_arrangement', teamId, week, arrangementId: arrangement.id, version: arrangement.version }); else if (pending) send({ action: 'remove_pending', teamId, week, pendingId: pending.id, version: pending.version }); }}>移出{weekLabel(week)}</button>}</div>
          {arrangement && candidate && editing === arrangement.id && <form key={`${arrangement.id}:${arrangement.version}`} onSubmit={(event) => { event.preventDefault(); send({ action: 'save_arrangement', teamId, week, assignmentId: candidate.assignmentId, assignmentVersion: candidate.assignmentVersion, taskVersion: candidate.taskVersion, version: arrangement.version, ...arrangementValues(event.currentTarget) }); }}><fieldset disabled={busy}><ArrangementFields week={week} arrangement={arrangement} /><div className="workflow-footer"><button type="button" onClick={() => setEditing('')}>取消</button><button className="primary-button">保存周安排</button></div></fieldset></form>}
        </article>;
      })}</div>
      {unscheduled.length > 0 && <form key={week} onSubmit={(event) => { event.preventDefault(); const fields = arrangementValues(event.currentTarget); send({ action: 'save_arrangements', teamId, week, arrangements: selected.map((entry) => ({ assignmentId: entry.assignmentId, assignmentVersion: entry.assignmentVersion, taskVersion: entry.taskVersion, version: null, ...fields })) }); }}><fieldset disabled={busy}><h4>选择要加入的分工</h4>{unscheduled.map((entry) => <label className="week-person-choice" key={entry.assignmentId}><input type="checkbox" checked={!excluded.includes(entry.assignmentId)} onChange={(event) => setExcluded((ids) => event.target.checked ? ids.filter((id) => id !== entry.assignmentId) : [...ids, entry.assignmentId])} /><span>{entry.displayName} · {entry.groupName}<small>{entry.content || task.title}</small></span></label>)}<details><summary>补充目标与投入（选填，应用于每位所选成员）</summary><ArrangementFields week={week} /></details><div className="workflow-footer"><span>已选 {selected.length} 项</span><button className="primary-button" disabled={!selected.length || busy}>一键安排至{weekLabel(week)}</button></div></fieldset></form>}
      {!unscheduled.length && !scheduled.length && <div className="inline-notice"><p>还没有可安排的分工，先为任务选择执行人。</p><button onClick={onAssign}>分配人员 →</button></div>}
      {!!scheduled.length && !unscheduled.length && <p className="detail-meta">可安排分工均已加入所选周。调整人员请到“人员分工”。</p>}
      </>}
    </>}
  </section>;
}
