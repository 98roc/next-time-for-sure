import { WeekPicker } from '../layout/week-picker';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { publicationPreviewSchema, reportCommandSchema, reportingQuerySchema, reportStateSchema } from '@ntfs/contracts';
import type { ReportCommand, ReportEntry, ReportSource } from '@ntfs/contracts';
import { currentIdentity } from '../identity/api';
import { organizationSnapshot } from '../organization/api';
import { selectedWeek, reportingRequest } from './reporting-api';
import { Publications } from './publications';
import '../organization/organization.css';

/** 团队周报按当前管理范围整理，发布副本供全团队读取。 */
export function ReportsPage() {
  const identity = useQuery({ queryKey: ['identity'], queryFn: currentIdentity, retry: false });
  const org = useQuery({ queryKey: ['organization', identity.data?.id], queryFn: organizationSnapshot, enabled: Boolean(identity.data), retry: false });
  const [view, setView] = useState('draft');
  const [week, setWeek] = useState(selectedWeek); const [error, setError] = useState(''); const [confirmation, setConfirmation] = useState(''); const [selected, setSelected] = useState<string[]>([]);
  const teamId = org.data?.teams[0]?.id ?? ''; const client = useQueryClient();
  const [groupId, setGroupId] = useState(''); const [projectId, setProjectId] = useState('');
  const valid = reportingQuerySchema.safeParse({ teamId, week }).success;
  const state = useQuery({ queryKey: ['reports', identity.data?.id, teamId, week], queryFn: async () => reportStateSchema.parse(await reportingRequest(`reports?${new URLSearchParams({ teamId, week })}`)), enabled: valid, retry: false });
  const save = useMutation({ mutationFn: (body: ReportCommand) => reportingRequest('reports/commands', body, identity.data?.csrfToken), onSuccess: async () => { setConfirmation(''); setSelected([]); await client.invalidateQueries({ queryKey: ['reports'] }); } });
  const preview = useMutation({ mutationFn: async () => publicationPreviewSchema.parse(await reportingRequest(`reports/preview?${new URLSearchParams({ teamId, week })}`)), onSuccess: (data) => setConfirmation(data.confirmation) });
  function send(input: unknown) { const parsed = reportCommandSchema.safeParse(input); if (!parsed.success) { setError('请完整填写内容，归属周须为周一。'); return; } setError(''); save.mutate(parsed.data); }
  const data = state.isError ? undefined : state.data; const draft = data?.draft; const busy = save.isPending || preview.isPending;
  return <main className="org-layout weekly-page"><header className="org-header"><div><h1>团队周报</h1><p>按项目整理本周工作与下周安排，已发布版本保留历史。</p></div></header>
    {!identity.data && <p>请先<a href="/account">登录</a>。</p>}
    <div className="weekly-toolbar"><WeekPicker value={week} onChange={(value) => { setWeek(value); setConfirmation(''); setSelected([]); }} /><button disabled={!valid || busy} onClick={() => { setConfirmation(''); void state.refetch(); }}>刷新</button></div>
    {!valid && teamId && <p role="alert">请选择周一日期。</p>}
    {(error || state.error || save.error || preview.error || org.error) && <p className="form-error" role="alert">{error || state.error?.message || save.error?.message || preview.error?.message || org.error?.message} 如发生冲突，请刷新核对。</p>}
    {state.isFetching && <p role="status">正在读取周报…</p>}{save.isSuccess && <p role="status">操作已保存。</p>}
    {data?.canEdit && <div className="view-tabs"><button aria-pressed={view === 'draft'} onClick={() => setView('draft')}>整理周报</button><button aria-pressed={view === 'published'} onClick={() => setView('published')}>已发布版本</button></div>}
    {data?.canEdit && view === 'draft' && <section className="panel weekly-section"><h2>共享整理草稿</h2><p>重新生成仅补入新来源，保留人工措辞、合并及排除。私人事项不会进入周报。</p><div className="weekly-toolbar"><label>项目<select value={projectId} onChange={(event) => { setProjectId(event.target.value); setSelected([]); }}><option value="">全部项目</option>{org.data?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>小组<select value={groupId} onChange={(event) => { setGroupId(event.target.value); setSelected([]); }}><option value="">全部小组</option>{org.data?.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label></div><button disabled={busy} onClick={() => send({ action: 'generate', teamId, week })}>{draft ? '补入新增来源' : '生成周报草稿'}</button>
      {draft && <><p role="status">新增来源 {draft.newCount} 条，已有来源变化 {draft.changedKeys.length} 条。发布前需整理新增内容并确认变化。</p>
        {draft.entries.filter((entry) => (!projectId || entry.projectId === projectId) && (!groupId || entry.sources.some((source) => source.groupId === groupId || org.data?.groups.some((group) => group.id === groupId && group.memberIds.includes(source.ownerId ?? ''))))).map((entry) => <ReportEditor key={entry.id} entry={entry} current={data.sources} changed={entry.sources.some((source) => draft.changedKeys.includes(source.key))} busy={busy} checked={selected.includes(entry.id)} toggle={() => setSelected(selected.includes(entry.id) ? selected.filter((id) => id !== entry.id) : [...selected, entry.id])} send={(fields) => send({ ...fields, teamId, week, version: draft.version })} reassign={(fields) => send({ ...fields, teamId, week })} />)}
        {selected.length >= 2 && <form onSubmit={(event) => { event.preventDefault(); send({ action: 'merge', teamId, week, version: draft.version, entryIds: selected, text: String(new FormData(event.currentTarget).get('text')) }); }}><label>合并后措辞（仅同项目同任务）<textarea name="text" required maxLength={20000} /></label><button disabled={busy}>合并选中条目</button></form>}
        {data.canPublish && <><button disabled={busy} onClick={() => preview.mutate()}>预览并准备发布</button>{confirmation && <form onSubmit={(event) => { event.preventDefault(); send({ action: 'publish', teamId, week, version: draft.version, confirmation, reason: String(new FormData(event.currentTarget).get('reason')) }); }}><p>将发布上方未排除内容及下周计划当前快照；再次发布形成新版本。</p><h3>本周工作预览</h3><pre className="weekly-copy">{preview.data?.rows.map((row) => `${row.projectName} · ${row.title}\n${row.text}`).join('\n\n')}</pre><h3>下周安排预览</h3><pre className="weekly-copy">{preview.data?.next?.map((row) => `${row.projectName} · ${row.title} · ${row.person}\n${row.text}`).join('\n\n') || '暂无安排'}</pre><label>发布／修订说明<textarea name="reason" required maxLength={2000} /></label><button className="primary-button" disabled={busy}>确认发布周报</button><button type="button" onClick={() => setConfirmation('')}>取消</button></form>}</>}
      </>}
    </section>}
    {data && (!data.canEdit || view === 'published') && <Publications versions={data.publications} />}
  </main>;
}
/** 修改措辞不会反写进展；每条来源保留实际日期与归属周调整入口。 */
function ReportEditor({ entry, current, changed, busy, checked, toggle, send, reassign }: { entry: ReportEntry; current: ReportSource[]; changed: boolean; busy: boolean; checked: boolean; toggle: () => void; send: (value: object) => void; reassign: (value: object) => void }) {
  return <article className="weekly-entry"><label><input type="checkbox" checked={checked} onChange={toggle} />选择合并</label><h3>{entry.projectName} · {entry.title}</h3>{changed && <p role="status">来源发生变化，请核对下面来源及整理内容。</p>}
    <p className="report-text">{entry.text}</p>{entry.excluded && <span className="status-badge">本次不发布</span>}<details><summary>编辑这一条</summary><form key={entry.text + String(entry.excluded)} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); send({ action: 'edit', entryId: entry.id, text: String(form.get('text')), excluded: form.has('excluded'), acceptChanges: form.has('accept') }); }}><fieldset disabled={busy}><label>汇报措辞<textarea name="text" defaultValue={entry.text} required maxLength={20000} /></label><label><input type="checkbox" name="excluded" defaultChecked={entry.excluded} />排除本条（保留记录，重新生成不恢复）</label>{changed && <label><input type="checkbox" name="accept" />已核对变化，保留当前措辞</label>}<button>保存整理</button></fieldset></form></details>
    <details><summary>追溯 {entry.sources.length} 条来源</summary><div className="weekly-sources">{entry.sources.map((source) => <div className="weekly-source" key={source.key}><p>{source.person} · 实际发生 {source.occurredOn ?? '发布计划基线'} · {source.title}</p><p>{current.find((item) => item.key === source.key)?.text ?? '已离开本周；保留历史来源'}</p>{source.sourceKind !== 'plan' && <form onSubmit={(event) => { event.preventDefault(); reassign({ action: 'reassign_week', sourceKind: source.sourceKind, sourceId: source.sourceId, sourceHash: current.find((item) => item.key === source.key)?.hash ?? source.hash, targetWeek: String(new FormData(event.currentTarget).get('week')) }); }}><label>调整归属周（周一，不改发生日期）<input name="week" type="date" required /></label><button disabled={busy}>调整归属周</button></form>}</div>)}</div></details>
  </article>;
}
