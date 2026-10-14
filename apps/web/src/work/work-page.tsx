import { Dialog } from '../layout/dialog';
import { TaskDetail } from './task-detail';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { TaskBoard } from './task-board';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workCommandSchema } from '@ntfs/contracts';
import type { OrganizationSnapshot, Permission, WorkCommand, WorkSnapshot } from '@ntfs/contracts';
import { currentIdentity } from '../identity/api';
import { organizationSnapshot } from '../organization/api';
import { workCommand, workSnapshot } from './api';
import '../organization/organization.css';
import './work.css';
import { MilestonePanel } from './milestone-panel';

const statusLabels = { pending: '待处理', supplement_required: '待补充', deferred: '暂缓', rejected: '已拒绝', withdrawn: '已撤回', accepted: '已接收' };
const eventLabels: Record<string, string> = { submit_request: '提交需求', edit_request: '修改需求', supplement_request: '追加说明', withdraw_request: '撤回需求', resubmit_request: '重新提交', review_request: '处理需求', accept_request: '接收需求', create_task: '直接创建任务', 'task.from_request': '由需求生成任务' };
type Intake = WorkSnapshot['requests'][number];

/** 项目工作入口；只有已登录并完成改密后才请求业务数据。 */
export function WorkPage() {
  const client = useQueryClient();
  const identity = useQuery({ queryKey: ['identity'], queryFn: currentIdentity, retry: false });
  const organization = useQuery({ queryKey: ['organization', identity.data?.id], queryFn: organizationSnapshot, enabled: Boolean(identity.data && !identity.data.mustChangePassword), retry: false });
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const selected = params.get('projectId') ?? '';
  const view = params.get('view') ?? 'tasks';
  const taskId = location.hash.startsWith('#task-') ? location.hash.slice(6) : '';
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [requestId, setRequestId] = useState('');
  const openTask = (id: string) => navigate({ pathname: '/work', search: location.search, hash: id ? `#task-${id}` : '' });
  const project = organization.data?.projects.find((entry) => entry.id === selected) ?? organization.data?.projects[0];
  const state = useQuery({ queryKey: ['work', identity.data?.id, project?.id], queryFn: () => workSnapshot(project?.id ?? ''), enabled: Boolean(project), retry: false });
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const operation = useRef<{ content: string; id: string } | null>(null);
  const save = useMutation({
    mutationFn: (command: WorkCommand) => { if (!identity.data) throw new Error('请先登录。'); return workCommand(command, identity.data.csrfToken); },
    onSuccess: async () => { operation.current = null; setCreating(false); setNotice('已保存。'); setRevision((value) => value + 1); await client.invalidateQueries({ queryKey: ['work'] }); },
  });

  function send(input: unknown) {
    const parsed = workCommandSchema.safeParse(input);
    if (!parsed.success) { setFormError('请填写标题、必要说明并选择有效负责人。'); return; }
    const command = parsed.data;
    if ('operationId' in command) {
      const content = JSON.stringify({ ...command, operationId: '' });
      if (operation.current?.content !== content) operation.current = { content, id: crypto.randomUUID() };
      command.operationId = operation.current.id;
    }
    setFormError(''); setNotice(''); save.mutate(command);
  }
  function can(permission: Permission): boolean {
    if (!project || !identity.data || !organization.data) return false;
    const roles = [...(project.members.find((entry) => entry.accountId === identity.data?.id)?.roles ?? [])];
    const leader = organization.data.teams.some((team) => team.id === project.teamId && team.leaderId === identity.data?.id);
    return organization.data.policies.some((policy) => policy.permissions.includes(permission) && (policy.role === 'team_leader' ? leader : roles.some((role) => role === policy.role)));
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    send({ action: String(form.get('action')), projectId: project?.id, title: String(form.get('title')), description: String(form.get('description')), acceptance: String(form.get('acceptance')), operationId: crypto.randomUUID() });
  }
  const data = state.isError ? undefined : state.data;
  const activeTask = data?.tasks.find((entry) => entry.id === taskId);
  const activeRequest = data?.requests.find((entry) => entry.id === requestId);
  const tasks = data?.tasks.filter((task) => task.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  function switchView(next: string) { setParams({ projectId: project?.id ?? '', view: next }); setQuery(''); }
  return <main className="org-layout project-workspace"><header className="org-header"><div><p className="eyebrow">{organization.data?.teams.find((team) => team.id === project?.teamId)?.name ?? '项目空间'}</p><h1>{project?.name ?? '项目'}</h1><p className="subtitle">{project ? `${project.members.length} 位项目成员` : '选择项目，查看团队工作'}</p></div>
    {view !== 'milestones' && can(view === 'requests' ? 'requests.submit' : 'tasks.create') && <button className="primary-button" onClick={() => setCreating(true)}>＋ {view === 'requests' ? '提交需求' : '新建任务'}</button>}
  </header>
    {(organization.error || state.error) && <p role="alert" className="form-error">{organization.error?.message || state.error?.message}<button onClick={() => { void organization.refetch(); void state.refetch(); }}>重试</button></p>}
    {organization.data && !project && <div className="empty-state">暂无项目，请联系团队负责人。</div>}
    {project && <><div className="page-toolbar"><label><span className="sr-only">当前项目</span><select value={project.id} onChange={(event) => { setParams({ projectId: event.target.value, view }); setQuery(''); setRequestId(''); setNotice(''); save.reset(); }}>{organization.data?.projects.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><label className="search-field"><span className="sr-only">搜索{view === 'requests' ? '需求' : '任务'}</span><input type="search" placeholder="输入名称" value={query} onChange={(event) => setQuery(event.target.value)} /></label><button disabled={state.isFetching} onClick={() => { void state.refetch(); }}>刷新</button></div>
      <div className="view-tabs" aria-label="项目视图">{[{ value: 'tasks', label: '任务看板' }, { value: 'milestones', label: '里程碑' }, { value: 'requests', label: '需求' }].map((entry) => <button key={entry.value} aria-pressed={view === entry.value} onClick={() => switchView(entry.value)}>{entry.label}</button>)}</div>
      {notice && <p role="status">{notice}</p>}{state.isPending && <p role="status">正在加载项目…</p>}
      {data && organization.data && identity.data && <>
        {view === 'milestones' ? <MilestonePanel key={project.id} projectId={project.id} tasks={data.tasks} query={query} identity={identity.data} organization={organization.data} canManage={can('milestones.manage')} onOpenTask={openTask} /> : view === 'requests' ? <section className="panel"><h2>需求池</h2>{data.requests.filter((entry) => entry.title.includes(query)).map((request) => <article className="request-row" key={request.id}><button className="text-button" onClick={() => setRequestId(request.id)}>{request.title}</button><span className="status-badge">{statusLabels[request.status]}</span></article>)}{!data.requests.some((entry) => entry.title.includes(query)) && <p className="empty-state">{query ? '没有找到匹配的需求' : '暂无需求，点击右上角提交第一条'}</p>}<details><summary>处理记录</summary>{data.events.filter((entry) => entry.action in eventLabels).map((entry) => <p key={entry.id}>{new Date(entry.createdAt).toLocaleString('zh-CN')} · {eventLabels[entry.action]}</p>)}</details></section> : <><TaskBoard key={project.id} tasks={data.tasks} query={query} onOpenTask={openTask} identity={identity.data} organization={organization.data} projectId={project.id} /><p className="detail-meta">{query ? `找到 ${tasks.length} 项` : `共 ${tasks.length} 项任务`}</p></>}
        {activeTask && <TaskDetail task={activeTask} data={data} organization={organization.data} identity={identity.data} onClose={() => openTask('')} onSelect={openTask} />}
        {taskId && !activeTask && !state.isFetching && <p role="alert">该任务已移除或无权查看。<button onClick={() => openTask('')}>返回项目</button></p>}
        {activeRequest && <Dialog title="需求详情" drawer onClose={() => setRequestId('')} busy={save.isPending}><RequestCard key={`${activeRequest.id}:${activeRequest.version}`} request={activeRequest} own={activeRequest.submitterId === identity.data.id} review={can('requests.accept')} organization={organization.data} projectId={project.id} pending={save.isPending} send={send} />{(save.error || formError) && <p role="alert" className="form-error">{formError || save.error?.message}</p>}</Dialog>}
      </>}
      {creating && <Dialog title={view === 'requests' ? '提交需求' : '新建任务'} onClose={() => setCreating(false)} busy={save.isPending}><form key={`${project.id}:${revision}`} onSubmit={create}><fieldset disabled={save.isPending}><input type="hidden" name="action" value={view === 'requests' ? 'submit_request' : 'create_task'} /><label>名称<input autoFocus name="title" required maxLength={200} /></label><details><summary>补充说明与完成标准（选填）</summary><label>说明<textarea name="description" maxLength={20000} /></label><label>完成标准<textarea name="acceptance" maxLength={20000} /></label></details>{(save.error || formError) && <p role="alert" className="form-error">{formError || save.error?.message}</p>}<button className="primary-button">{save.isPending ? '正在保存…' : '创建'}</button></fieldset></form></Dialog>}
    </>}
  </main>;
}

/** 需求详情中的作者动作及处理动作；接收后仅提供追加说明，不编辑原文。 */
function RequestCard({ request, own, review, organization, projectId, pending, send }: { request: Intake; own: boolean; review: boolean; organization: OrganizationSnapshot | undefined; projectId: string; pending: boolean; send: (input: unknown) => void }) {
  function action(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const type = String(form.get('action'));
    const base = { requestId: request.id, version: request.version };
    if (type === 'edit_request') send({ ...base, action: type, title: String(form.get('title')), description: String(form.get('description')), acceptance: String(form.get('acceptance')) });
    else if (type === 'accept_request') send({ ...base, action: type, ownerId: String(form.get('ownerId')), operationId: crypto.randomUUID() });
    else if (type === 'supplement_request') send({ ...base, action: type, content: String(form.get('content')) });
    else send({ ...base, action: 'review_request', decision: type, reason: String(form.get('reason')) });
  }
  const owners = organization?.projects.find((entry) => entry.id === projectId)?.members.filter((entry) => entry.roles.some((role) => role === 'developer' || role === 'project_lead')) ?? [];
  return <article className="request-card"><h3>{request.title}</h3><span className="status-badge">{statusLabels[request.status]}</span>{request.description && <p>{request.description}</p>}{request.acceptance && <p>完成标准 · {request.acceptance}</p>}
    {own && <details><summary>补充与修改</summary><form onSubmit={action}><input type="hidden" name="action" value="supplement_request" /><label>追加说明<textarea name="content" required maxLength={20000} /></label><button disabled={pending}>追加说明</button></form>
      {request.status !== 'accepted' && <form onSubmit={action}><input type="hidden" name="action" value="edit_request" /><label>标题<input name="title" required defaultValue={request.title} maxLength={200} /></label><label>说明<textarea name="description" defaultValue={request.description} maxLength={20000} /></label><label>完成标准<textarea name="acceptance" defaultValue={request.acceptance} maxLength={20000} /></label><button disabled={pending}>保存修改</button></form>}
      {!['accepted', 'withdrawn'].includes(request.status) && <button disabled={pending} onClick={() => send({ action: 'withdraw_request', requestId: request.id, version: request.version })}>撤回需求</button>}
      {['withdrawn', 'rejected'].includes(request.status) && <button disabled={pending} onClick={() => send({ action: 'resubmit_request', requestId: request.id, version: request.version })}>重新提交</button>}
    </details>}
    {review && ['pending', 'supplement_required', 'deferred'].includes(request.status) && <details><summary>处理需求</summary>{request.status === 'pending' && <form onSubmit={action}><input type="hidden" name="action" value="accept_request" /><label>任务主负责人<select name="ownerId" required>{owners.map((entry) => <option key={entry.accountId} value={entry.accountId}>{organization?.accounts.find((account) => account.id === entry.accountId)?.displayName}</option>)}</select></label><button disabled={pending}>接收并生成团队任务</button></form>}<form onSubmit={action}><label>处理方式<select name="action"><option value="supplement_required">要求补充</option><option value="deferred">暂缓</option><option value="rejected">拒绝</option>{request.status === 'deferred' && <option value="pending">恢复处理</option>}</select></label><label>说明<textarea name="reason" required maxLength={20000} /></label><button disabled={pending}>提交处理结果</button></form></details>}
  </article>;
}
