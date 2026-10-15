import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { weeklyPlanCommandSchema } from '@ntfs/contracts';
import type { WeeklyArrangement, WeeklyPlanCommand } from '@ntfs/contracts';
import { WeekPicker, weekLabel, shiftWeek } from '../layout/week-picker';
import { EmptyState } from '../layout/empty-state';
import { ProjectOnboarding } from '../organization/project-onboarding';
import { currentIdentity } from '../identity/api';
import { organizationSnapshot } from '../organization/api';
import { selectedWeek } from './reporting-api';
import { PlanReview } from './plan-review';
import { PlanGroupingControl } from './plan-summary';
import { PlanList } from './plan-list';
import { planCounts, planEntries } from './plan-view';
import type { PlanGrouping } from './plan-view';
import { WeeklyTaskDetail, WeeklyTaskPicker } from './task-picker';
import { WeeklyArrangementEditor } from './arrangement-editor';
import { moveWeeklyArrangement, weeklyCommand, weeklySnapshot } from './api';
import '../organization/organization.css';
import '../work/work.css';

/** 单周任务维护入口；三个维度重组同一份授权安排，草稿与正式发布各自保留。 */
export function WeeklyPage() {
  const client = useQueryClient();
  const identity = useQuery({ queryKey: ['identity'], queryFn: currentIdentity, retry: false });
  const org = useQuery({ queryKey: ['organization', identity.data?.id], queryFn: organizationSnapshot, enabled: Boolean(identity.data && !identity.data.mustChangePassword), retry: false });
  const [view, setView] = useState<'scheduled' | 'backlog' | 'review'>('scheduled');
  const [grouping, setGrouping] = useState<PlanGrouping>('project');
  const [week, setWeek] = useState(selectedWeek);
  const [, setParams] = useSearchParams();
  const [error, setError] = useState('');
  const [projectId, setProjectId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [picker, setPicker] = useState<'create' | 'existing' | null>(null);
  const [task, setTask] = useState<{ projectId: string; taskId: string } | null>(null);
  const [editing, setEditing] = useState<{ assignmentId: string; week: string } | null>(null);
  const teamId = org.data?.teams[0]?.id;
  const label = weekLabel(week);
  const validWeek = weeklyPlanCommandSchema.safeParse({ action: 'ensure_draft', teamId, week }).success;
  const state = useQuery({ queryKey: ['weekly', identity.data?.id, teamId, week], queryFn: () => weeklySnapshot(teamId ?? '', week), enabled: Boolean(teamId && validWeek), retry: false });
  const refresh = () => Promise.all(['weekly', 'reports', 'overview'].map((key) => client.invalidateQueries({ queryKey: [key] })));
  const save = useMutation({ mutationFn: (command: WeeklyPlanCommand) => weeklyCommand(command, identity.data?.csrfToken ?? ''), onSuccess: async () => { await refresh(); } });
  const move = useMutation({ mutationFn: (row: WeeklyArrangement) => moveWeeklyArrangement(teamId ?? '', week, shiftWeek(week, 1), row, identity.data?.csrfToken ?? ''), onSuccess: async () => { await refresh(); } });

  function send(input: unknown) {
    const parsed = weeklyPlanCommandSchema.safeParse(input);
    if (!parsed.success) { setError('请核对周次、目标与投入。'); return; }
    setError(''); save.mutate(parsed.data);
  }
  function clearFilters() { setProjectId(''); setAccountId(''); setGroupId(''); }
  function openTask(projectId: string, taskId: string) { setPicker(null); setTask({ projectId, taskId }); }

  // 列表与筛选均来自同一份授权数据；只读用户仅重组已发布副本。
  const data = state.isError ? undefined : state.data;
  const scheduled = data && org.data ? planEntries(data, org.data, false) : [];
  const backlog = data && org.data && data.canEdit ? planEntries(data, org.data, true) : [];
  const allEntries = view === 'backlog' ? backlog : scheduled;
  const options = [...scheduled, ...backlog];
  const entries = allEntries.filter((entry) => (!projectId || entry.projectId === projectId) && (!accountId || entry.accountId === accountId) && (!groupId || (entry.accountId === null ? 'unassigned' : entry.groupId ?? 'team-direct') === groupId));
  const counts = planCounts(entries);
  const filtered = Boolean(projectId || accountId || groupId);
  const noProjects = Boolean(org.data && !org.isError && !org.data.projects.length && !data?.publications.length && !scheduled.length);
  const busy = save.isPending || move.isPending;
  return <main className="org-layout weekly-page">
    <header className="org-header"><div><h1>团队周计划</h1><p className="subtitle">{data?.canEdit ? `在这里维护${label}任务、人员分工和周目标。` : `查看团队已发布的${label}安排。`}</p></div>
      {data?.canEdit && !noProjects && view !== 'review' && <div className="org-actions"><button disabled={!validWeek || busy} onClick={() => setPicker('existing')}>选择已有任务</button><button className="primary-button" disabled={!validWeek || busy} onClick={() => setPicker('create')}>＋ 新建任务</button>{data.draft && <button onClick={() => setView('review')}>{data.canPublish ? '预览与发布' : '汇总与历史'}</button>}</div>}
    </header>
    {!identity.data && <p>请先<a href="/account">登录</a>。</p>}
    {!noProjects && <div className="weekly-toolbar week-navigation"><fieldset disabled={busy}><WeekPicker value={week} onChange={(value) => { setWeek(value); setParams({ week: value }, { replace: true }); setEditing(null); setTask(null); move.reset(); save.reset(); setError(''); }} /></fieldset><button className="text-button" disabled={!validWeek || state.isFetching || busy} onClick={() => { void state.refetch(); }}>刷新</button>{data && <span className="status-badge">{data.canEdit ? data.draft?.hasUnpublishedChanges ? '有未发布调整' : data.publications.length ? '已发布' : '草稿' : data.publications.length ? '已发布' : '尚未发布'}</span>}</div>}
    {teamId && !validWeek && <p role="alert" className="form-error">请选择有效周次。</p>}
    {(error || save.error || move.error || state.error || org.error) && <p role="alert" className="form-error">{error || save.error?.message || move.error?.message || state.error?.message || org.error?.message} 请刷新核对后再操作。</p>}
    {state.isFetching && <p role="status">正在读取周安排…</p>}
    {save.isSuccess && <p role="status">草稿已保存。</p>}{move.isSuccess && <p role="status">已移至{weekLabel(shiftWeek(week, 1))}；目标周已有内容保持不变，原周已移出。已发布版本保持不变。</p>}
    {noProjects && org.data && identity.data && <ProjectOnboarding identity={identity.data} organization={org.data} />}
    {!noProjects && data && <>
      <div className="collection-toolbar"><div className="view-tabs" role="group" aria-label="周计划内容"><button aria-pressed={view === 'scheduled'} onClick={() => setView('scheduled')}>{label}安排 <span className="tab-count">{planCounts(scheduled).tasks}</span></button>{data.canEdit && <button aria-pressed={view === 'backlog'} onClick={() => setView('backlog')}>待安排分工 <span className="tab-count">{planCounts(backlog).tasks}</span></button>}<button aria-pressed={view === 'review'} onClick={() => setView('review')}>汇总与历史</button></div></div>
      {view !== 'review' && <>
        <div className="plan-display-toolbar"><PlanGroupingControl value={grouping} onChange={setGrouping} />
          <div className="weekly-toolbar filter-toolbar" role="group" aria-label="筛选安排">
            <label><span className="sr-only">项目</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">全部项目</option>{[...new Map(options.map((entry) => [entry.projectId, entry.projectName])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <label><span className="sr-only">人员</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">全部人员</option>{[...new Map(options.filter((entry) => entry.accountId !== null).map((entry): [string, string] => [entry.accountId ?? '', entry.person])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <label><span className="sr-only">负责小组</span><select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">全部小组</option>{[...new Map(options.map((entry) => [entry.accountId === null ? 'unassigned' : entry.groupId ?? 'team-direct', entry.groupName])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            {filtered && <button className="text-button" onClick={clearFilters}>清除筛选</button>}
          </div>
        </div>
        <p className="plan-counts detail-meta">{filtered ? '筛选结果 · ' : ''}{counts.tasks} 项任务 · {counts.people} 项人员{view === 'backlog' ? '分工' : '安排'}{counts.pending > 0 && ` · ${counts.pending} 项待分配`}{!data.canEdit && ' · 发布时内容'}</p>
        <PlanList entries={entries} grouping={grouping} week={week} busy={busy} editable={data.canEdit} onOpenTask={openTask} onEdit={(entry, targetWeek) => { if (entry.candidate) setEditing({ assignmentId: entry.candidate.assignmentId, week: targetWeek }); }} onMove={(entry) => { if (entry.arrangement) move.mutate(entry.arrangement); }} onRemove={(entry) => { if (entry.arrangement) send({ action: 'remove_arrangement', teamId, week, arrangementId: entry.arrangement.id, version: entry.arrangement.version }); else if (entry.pending) send({ action: 'remove_pending', teamId, week, pendingId: entry.pending.id, version: entry.pending.version }); }} />
        {!entries.length && <EmptyState title={filtered ? '没有符合筛选的安排' : data.canEdit ? view === 'backlog' ? '暂无待安排分工' : `${label}暂无安排` : `${label}尚无发布安排`} description={filtered ? '调整筛选条件或清除筛选查看。' : data.canEdit ? '可以直接新建任务，或选择已有任务，分配人员并安排到这一周。' : '团队负责人发布后，可按项目、小组和个人查看。'}>{filtered ? <button onClick={clearFilters}>清除筛选</button> : data.canEdit && <button onClick={() => setPicker('existing')}>选择已有任务</button>}</EmptyState>}
      </>}
      {view === 'review' && org.data && <PlanReview key={week} data={data} teamId={teamId ?? ''} week={week} busy={busy} csrf={identity.data?.csrfToken ?? ''} organization={org.data} />}
    </>}
    {org.data && identity.data && picker && <WeeklyTaskPicker organization={org.data} identity={identity.data} week={week} mode={picker} initialProjectId={projectId} onClose={() => setPicker(null)} onSelect={openTask} />}
    {org.data && identity.data && task && <WeeklyTaskDetail organization={org.data} identity={identity.data} week={week} {...task} onClose={() => setTask(null)} onSelect={openTask} />}
    {identity.data && teamId && editing && <WeeklyArrangementEditor key={`${editing.assignmentId}:${editing.week}`} teamId={teamId} identity={identity.data} sourceWeek={week} {...editing} onClose={() => setEditing(null)} />}
  </main>;
}
