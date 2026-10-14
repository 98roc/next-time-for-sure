import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { weeklyPlanCommandSchema } from '@ntfs/contracts';
import type { WeeklyPlanCommand } from '@ntfs/contracts';
import { currentIdentity } from '../identity/api';
import { organizationSnapshot } from '../organization/api';
import { weeklyCommand, weeklySnapshot } from './api';
import '../organization/organization.css';

/** 默认本地周一日期，不因UTC换日而进入错误周次。 */
function currentWeek() {
  const date = new Date(); date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 共享草稿编排入口；当前仅提供草稿，不把保存表述为发布承诺。 */
export function WeeklyPage() {
  const client = useQueryClient();
  const identity = useQuery({ queryKey: ['identity'], queryFn: currentIdentity, retry: false });
  const org = useQuery({ queryKey: ['organization', identity.data?.id], queryFn: organizationSnapshot, enabled: Boolean(identity.data), retry: false });
  const [week, setWeek] = useState(currentWeek);
  const [error, setError] = useState('');
  const [projectId, setProjectId] = useState('');
  const [accountId, setAccountId] = useState('');
  const teamId = org.data?.teams[0]?.id;
  const validWeek = weeklyPlanCommandSchema.safeParse({ action: 'ensure_draft', teamId, week }).success;
  const state = useQuery({ queryKey: ['weekly', identity.data?.id, teamId, week], queryFn: () => weeklySnapshot(teamId ?? '', week), enabled: Boolean(teamId && validWeek), retry: false });
  const save = useMutation({ mutationFn: (command: WeeklyPlanCommand) => weeklyCommand(command, identity.data?.csrfToken ?? ''), onSuccess: async () => { await client.invalidateQueries({ queryKey: ['weekly'] }); } });
  function send(input: unknown) {
    const parsed = weeklyPlanCommandSchema.safeParse(input);
    if (!parsed.success) { setError('请填写周一日期；投入最多两位小数，进度为0～100整数。'); return; }
    setError(''); save.mutate(parsed.data);
  }
  const data = state.isError ? undefined : state.data;
  const candidates = data?.candidates.filter((entry) => (!projectId || entry.projectId === projectId) && (!accountId || entry.accountId === accountId)) ?? [];
  return <main className="org-layout"><header className="org-header"><div><h1>周计划草稿</h1><p>团队共享，按负责小组编排。保存草稿不代表发布。</p></div><nav><a href="/work">团队工作</a><a href="/personal">个人空间</a><a href="/organization">团队与项目</a></nav></header>
    {!identity.data && <p>请先<a href="/account">登录</a>。</p>}
    <div className="org-feedback"><label>归属周（周一）<input type="date" value={week} onChange={(event) => setWeek(event.target.value)} /></label><button disabled={!validWeek || state.isFetching} onClick={() => { void state.refetch(); }}>刷新</button></div>
    {teamId && !validWeek && <p role="alert" className="form-error">请选择周一。</p>}
    {(error || save.isError || state.isError || org.isError) && <p role="alert" className="form-error">{error || save.error?.message || state.error?.message || org.error?.message} 冲突时刷新核对后重新保存。</p>}
    {state.isFetching && <p role="status">正在读取周安排…</p>}
    {save.isSuccess && <p role="status">草稿已保存。</p>}
    {data && <><div className="assignment-actions"><button disabled={save.isPending} onClick={() => send({ action: 'ensure_draft', teamId, week })}>{data.draft ? '共享草稿已建立' : '建立共享草稿'}</button><button disabled={save.isPending} onClick={() => send({ action: 'carry_forward', teamId, week })}>从前一周补入未完成分工</button></div><p>结转不覆盖已安排项，目标、进度和投入留空；仅处理当前有安排权限的分工。</p>
      <div className="org-feedback"><label>项目<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">全部项目</option>{[...new Map(data.candidates.map((entry) => [entry.projectId, entry.projectName])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>人员<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">全部人员</option>{[...new Map(data.candidates.map((entry) => [entry.accountId, entry.displayName])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
      <div className="org-directory">{candidates.map((entry) => {
        const arrangement = data.draft?.arrangements.find((item) => item.assignmentId === entry.assignmentId);
        return <article className="panel org-editor" key={`${entry.assignmentId}:${arrangement?.version ?? 'new'}:${week}`}><h2>{entry.taskTitle}</h2><p>{entry.projectName} · {entry.groupName} · {entry.displayName}</p>{entry.content && <p>{entry.content}</p>}{entry.blockedReason && <p>阻塞：{entry.blockedReason}</p>}
          <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const progress = String(form.get('progress')); send({ action: 'save_arrangement', teamId, week, assignmentId: entry.assignmentId, assignmentVersion: entry.assignmentVersion, taskVersion: entry.taskVersion, version: arrangement?.version ?? null, goal: String(form.get('goal')), expectedProgress: progress === '' ? null : Number(progress), plannedDays: String(form.get('days')) || null }); }}><fieldset disabled={save.isPending}><label>本周目标（选填）<textarea name="goal" maxLength={2000} defaultValue={arrangement?.goal ?? ''} /></label><label>本周预计新增进度（选填）<input name="progress" type="number" min={0} max={100} step={1} defaultValue={arrangement?.expectedProgress ?? ''} /></label><label>预计投入天数（选填）<input name="days" type="number" min={0} max={9999.99} step="0.01" defaultValue={arrangement?.plannedDays ?? ''} /></label><button>{arrangement ? '更新本周安排' : '加入本周草稿'}</button></fieldset></form>
        </article>;
      })}</div>{candidates.length === 0 && <p>当前筛选范围没有可执行且有权安排的分工。</p>}
      {data.draft && data.draft.arrangements.some((entry) => !data.candidates.some((candidate) => candidate.assignmentId === entry.assignmentId)) && <p>部分已有安排已停止或不可继续执行，记录仍保留，不再作为结转候选。</p>}
    </>}
  </main>;
}
