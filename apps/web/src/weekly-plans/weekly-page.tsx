import { PlanCard } from './plan-card';
import { Dialog } from '../layout/dialog';
import { ArrangementFields, arrangementValues } from './arrangement-fields';
import { WeekPicker, weekLabel, shiftWeek } from '../layout/week-picker';
import { selectedWeek } from './reporting-api';
import { PlanReview } from './plan-review';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState } from '../layout/empty-state';
import { ProjectOnboarding } from '../organization/project-onboarding';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { weeklyPlanCommandSchema } from '@ntfs/contracts';
import type { WeeklyArrangement, WeeklyPlanCommand } from '@ntfs/contracts';
import { currentIdentity } from '../identity/api';
import { organizationSnapshot } from '../organization/api';
import { moveWeeklyArrangement, weeklyCommand, weeklySnapshot } from './api';
import '../organization/organization.css';

/** 共享草稿编排入口；草稿保存和正式发布分别展示。 */
export function WeeklyPage() {
  const client = useQueryClient();
  const identity = useQuery({ queryKey: ['identity'], queryFn: currentIdentity, retry: false });
  const org = useQuery({ queryKey: ['organization', identity.data?.id], queryFn: organizationSnapshot, enabled: Boolean(identity.data), retry: false });
  const [editing, setEditing] = useState('');
  const [view, setView] = useState<'scheduled' | 'backlog' | 'review'>('scheduled');
  const [week, setWeek] = useState(selectedWeek);
  const [, setParams] = useSearchParams();
  const label = weekLabel(week);
  const [error, setError] = useState('');
  const [projectId, setProjectId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [groupId, setGroupId] = useState('');
  const teamId = org.data?.teams[0]?.id;
  const validWeek = weeklyPlanCommandSchema.safeParse({ action: 'ensure_draft', teamId, week }).success;
  const state = useQuery({ queryKey: ['weekly', identity.data?.id, teamId, week], queryFn: () => weeklySnapshot(teamId ?? '', week), enabled: Boolean(teamId && validWeek), retry: false });
  const save = useMutation({ mutationFn: (command: WeeklyPlanCommand) => weeklyCommand(command, identity.data?.csrfToken ?? ''), onSuccess: async () => { setEditing(''); await Promise.all(['weekly', 'reports', 'overview'].map((key) => client.invalidateQueries({ queryKey: [key] }))); } });
  const move = useMutation({ mutationFn: (row: WeeklyArrangement) => moveWeeklyArrangement(teamId ?? '', week, shiftWeek(week, 1), row, identity.data?.csrfToken ?? ''), onSuccess: async () => { await Promise.all(['weekly', 'reports', 'overview'].map((key) => client.invalidateQueries({ queryKey: [key] }))); } });
  function send(input: unknown) {
    const parsed = weeklyPlanCommandSchema.safeParse(input);
    if (!parsed.success) { setError('请填写周一日期；投入最多两位小数，进度为0～100整数。'); return; }
    setError(''); save.mutate(parsed.data);
  }
  const data = state.isError ? undefined : state.data;
  const candidates = data?.candidates.filter((entry) => (view === 'scheduled' ? data.draft?.arrangements.some((item) => item.assignmentId === entry.assignmentId) : !data.draft?.arrangements.some((item) => item.assignmentId === entry.assignmentId)) && (!projectId || entry.projectId === projectId) && (!accountId || entry.accountId === accountId) && (!groupId || (entry.groupId ?? 'team-direct') === groupId)) ?? [];
  const noProjects = Boolean(org.data && !org.isError && org.data.projects.length === 0 && !data?.publications.length && !data?.draft?.rows.length);
  const filtered = Boolean(projectId || accountId || groupId);
  const scheduledCount = data?.candidates.filter((entry) => data.draft?.arrangements.some((item) => item.assignmentId === entry.assignmentId)).length ?? 0;
  const backlogCount = (data?.candidates.length ?? 0) - scheduledCount;
  return <main className="org-layout weekly-page"><header className="org-header"><div><h1>团队周计划</h1><p className="subtitle">{data?.canEdit ? data.canPublish ? `安排${label}目标与投入，确认后发布给团队。` : `安排负责小组的${label}目标与投入，由团队负责人统一发布。` : `查看团队已发布的${label}目标与工作安排。`}</p></div>{data?.canEdit && !noProjects && <div className="org-actions">{view !== 'review' && data.draft && <button className="primary-button" onClick={() => setView('review')}>{data.canPublish ? '预览与发布' : `预览${label}安排`}</button>}</div>}</header>
    {!identity.data && <p>请先<a href="/account">登录</a>。</p>}
    {!noProjects && <div className="weekly-toolbar week-navigation"><WeekPicker value={week} onChange={(value) => { setWeek(value); setParams({ week: value }, { replace: true }); setEditing(''); move.reset(); save.reset(); }} /><button className="text-button" disabled={!validWeek || state.isFetching} onClick={() => { void state.refetch(); }}>刷新</button>{data?.draft && <span className="status-badge">{data.draft.hasUnpublishedChanges ? '有未发布调整' : data.publications.length ? '已发布' : '草稿'} · 共 {data.draft.rows.length} 项安排</span>}</div>}
    {teamId && !validWeek && <p role="alert" className="form-error">请选择周一。</p>}
    {(error || save.isError || move.isError || state.isError || org.isError) && <p role="alert" className="form-error">{error || save.error?.message || move.error?.message || state.error?.message || org.error?.message} 冲突时刷新核对后重新保存。</p>}
    {state.isFetching && <p role="status">正在读取周安排…</p>}
    {save.isSuccess && <p role="status">草稿已保存。</p>}{move.isSuccess && <p role="status">已移至后一周；目标周已有安排时保留其目标和投入。已发布版本保持不变。</p>}
    {noProjects && org.data && identity.data && <ProjectOnboarding identity={identity.data} organization={org.data} />}
    {!noProjects && data?.canEdit && <>
      <div className="collection-toolbar">
        <div className="view-tabs" role="group" aria-label="周计划视图"><button aria-pressed={view === 'scheduled'} onClick={() => setView('scheduled')}>{label}安排 <span className="tab-count">{scheduledCount}</span></button><button aria-pressed={view === 'backlog'} onClick={() => setView('backlog')}>待安排 <span className="tab-count">{backlogCount}</span></button><button aria-pressed={view === 'review'} onClick={() => setView('review')}>汇总与历史</button></div>
        {view !== 'review' && data.candidates.length > 0 && <div className="weekly-toolbar filter-toolbar" role="group" aria-label="筛选分工">
          <label><span className="sr-only">项目</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">全部项目</option>{[...new Map(data.candidates.map((entry) => [entry.projectId, entry.projectName])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label><span className="sr-only">人员</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">全部人员</option>{[...new Map(data.candidates.map((entry) => [entry.accountId, entry.displayName])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label><span className="sr-only">负责小组</span><select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">全部小组</option>{[...new Map(data.candidates.map((entry) => [entry.groupId ?? 'team-direct', entry.groupName])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          {filtered && <button className="text-button" onClick={() => { setProjectId(''); setAccountId(''); setGroupId(''); }}>清除筛选</button>}
        </div>}
      </div>
      {view !== 'review' && <><div className="plan-grid">{candidates.map((entry) => {
        const arrangement = data.draft?.arrangements.find((item) => item.assignmentId === entry.assignmentId);
        return <PlanCard key={`${entry.assignmentId}:${arrangement?.version ?? 'new'}:${week}`} entry={entry} arrangement={arrangement} week={week} busy={save.isPending || move.isPending} onEdit={() => setEditing(entry.assignmentId)} onMove={() => { if (arrangement) move.mutate(arrangement); }} onRemove={() => { if (arrangement) send({ action: 'remove_arrangement', teamId, week, arrangementId: arrangement.id, version: arrangement.version }); }}>
          {editing === entry.assignmentId && <Dialog title={`安排：${entry.taskTitle}`} onClose={() => setEditing('')} busy={save.isPending || move.isPending}><p>{entry.displayName} · {entry.groupName}</p><form onSubmit={(event) => { event.preventDefault(); send({ action: 'save_arrangement', teamId, week, assignmentId: entry.assignmentId, assignmentVersion: entry.assignmentVersion, taskVersion: entry.taskVersion, version: arrangement?.version ?? null, ...arrangementValues(event.currentTarget) }); }}><fieldset disabled={save.isPending || move.isPending}><ArrangementFields week={week} arrangement={arrangement} /><div className="plan-edit-actions"><button type="button" onClick={() => setEditing('')}>取消</button><button className="primary-button">{arrangement ? '保存安排' : `加入${label}`}</button></div></fieldset></form>{(error || save.error) && <p className="form-error" role="alert">{error || save.error?.message}</p>}</Dialog>}
        </PlanCard>;
      })}</div>{candidates.length === 0 && <EmptyState title={filtered ? '没有符合筛选的分工' : view === 'scheduled' ? `${label}暂无待执行安排` : '还没有可安排的分工'} description={filtered ? '换一个项目、人员或小组，或清除筛选查看全部。' : view === 'scheduled' ? `从待安排中选择近期工作；完成和停止的安排可在“汇总与历史”中查看。` : `可在项目任务中连续完成分配和${label}安排，也可在此集中编排。`}>{view === 'scheduled' && !filtered && <button onClick={() => setView('backlog')}>查看待安排</button>}{filtered ? <button onClick={() => { setProjectId(''); setAccountId(''); setGroupId(''); }}>清除筛选</button> : <Link className="button-link primary-button" to="/work">前往项目安排分工</Link>}{!filtered && data.canPublish && <button onClick={() => setView('review')}>安排待分配任务</button>}</EmptyState>}
      {data.draft && data.draft.arrangements.some((entry) => !data.candidates.some((candidate) => candidate.assignmentId === entry.assignmentId)) && <p>部分已有安排已停止或不可继续执行，记录仍保留，不再作为结转候选。</p>}
      </>}
    </>}
    {!noProjects && data && (!data.canEdit || view === 'review') && <PlanReview key={week} data={data} teamId={teamId ?? ''} week={week} busy={save.isPending || move.isPending} send={send} />}
  </main>;
}
