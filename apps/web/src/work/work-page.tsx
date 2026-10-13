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
import { TaskControls } from './task-controls';
import { AssignmentPanel } from './assignment-panel';
import { MilestonePanel } from './milestone-panel';

const statusLabels = { pending: '待处理', supplement_required: '待补充', deferred: '暂缓', rejected: '已拒绝', withdrawn: '已撤回', accepted: '已接收' };
const eventLabels: Record<string, string> = { submit_request: '提交需求', edit_request: '修改需求', supplement_request: '追加说明', withdraw_request: '撤回需求', resubmit_request: '重新提交', review_request: '处理需求', accept_request: '接收需求', create_task: '直接创建任务', 'task.from_request': '由需求生成任务' };
const taskLabels = { not_started: '待开始', in_progress: '进行中', completed: '已完成', cancelled: '已取消' };
type Intake = WorkSnapshot['requests'][number];

/** 项目工作入口；只有已登录并完成改密后才请求业务数据。 */
export function WorkPage() {
  const client = useQueryClient();
  const identity = useQuery({ queryKey: ['identity'], queryFn: currentIdentity, retry: false });
  const organization = useQuery({ queryKey: ['organization', identity.data?.id], queryFn: organizationSnapshot, enabled: Boolean(identity.data && !identity.data.mustChangePassword), retry: false });
  const [selected, setSelected] = useState(new URLSearchParams(location.search).get('projectId') ?? '');
  const project = organization.data?.projects.find((entry) => entry.id === selected) ?? organization.data?.projects[0];
  const state = useQuery({ queryKey: ['work', identity.data?.id, project?.id], queryFn: () => workSnapshot(project?.id ?? ''), enabled: Boolean(project), retry: false });
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const operation = useRef<{ content: string; id: string } | null>(null);
  const save = useMutation({
    mutationFn: (command: WorkCommand) => { if (!identity.data) throw new Error('请先登录。'); return workCommand(command, identity.data.csrfToken); },
    onSuccess: async () => { operation.current = null; setNotice('已保存。'); setRevision((value) => value + 1); await client.invalidateQueries({ queryKey: ['work'] }); },
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
  return <main className="org-layout"><header className="org-header"><div><p className="eyebrow">下次一定 · 工作空间</p><h1>需求与团队任务</h1><p className="subtitle">接收明确工作，保留每次补充与处理记录。</p></div><nav><a href="/personal">个人空间</a><a href="/organization">团队与项目</a><a href="/account">账号与安全</a></nav></header>
    {identity.isPending ? <p role="status">正在检查身份…</p> : !identity.data || identity.data.mustChangePassword ? <p>请先<a href="/account">登录并完成改密</a>。</p> : <>
      {organization.isError && <p role="alert">{organization.error.message}</p>}
      {organization.data && !project && <p>暂无可访问项目，请联系团队负责人。</p>}
      {project && <><div className="org-feedback"><label>项目 <select value={project.id} onChange={(event) => { setSelected(event.target.value); setNotice(''); save.reset(); }}>{organization.data?.projects.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><button disabled={state.isFetching || save.isPending} onClick={() => { void state.refetch(); }}>刷新</button>{notice && <span role="status">{notice}</span>}</div>
        {(state.isError || save.isError || formError) && <p className="form-error" role="alert">{formError || save.error?.message || state.error?.message} 冲突时请刷新并核对最新内容。</p>}
        {state.isPending && <p role="status">正在加载项目工作…</p>}
        {data && organization.data && identity.data && <MilestonePanel key={project.id} projectId={project.id} tasks={data.tasks} identity={identity.data} organization={organization.data} canManage={can('milestones.manage')} />}<div className="org-columns"><div className="org-directory">
          <section className="panel"><h2>需求</h2>{data?.requests.length === 0 && <p>暂无需求。</p>}{data?.requests.map((request) => <RequestCard key={`${request.id}:${request.version}`} request={request} own={request.submitterId === identity.data?.id} review={can('requests.accept')} organization={organization.data} projectId={project.id} pending={save.isPending} send={send} />)}</section>
          <section className="panel"><h2>团队任务</h2>{data?.tasks.length === 0 && <p>暂无团队任务。接收需求或直接创建后显示。</p>}{data?.tasks.map((task) => <article key={task.id} id={`task-${task.id}`}><h3>{task.title}</h3><span className="status-badge">{taskLabels[task.status]}</span><p>主负责人 · {organization.data?.accounts.find((account) => account.id === task.ownerId)?.displayName ?? '成员'}</p>{task.description && <p>{task.description}</p>}{task.acceptance && <p>完成标准 · {task.acceptance}</p>}<small>{task.requestId ? '来自已接收需求' : '直接创建'}</small>{organization.data && identity.data && <><TaskControls key={`${task.id}:${task.version}`} task={task} organization={organization.data} identity={identity.data} /><AssignmentPanel task={task} organization={organization.data} identity={identity.data} /></>}</article>)}</section>
          <details className="panel"><summary>处理历史（{data?.events.length ?? 0}）</summary>{data?.events.map((entry) => <p key={entry.id}>{new Date(entry.createdAt).toLocaleString('zh-CN')} · {eventLabels[entry.action] ?? '变更记录'}{typeof entry.payload.content === 'string' ? ` · ${entry.payload.content}` : ''}{typeof entry.payload.reason === 'string' ? ` · ${entry.payload.reason}` : ''}</p>)}</details>
        </div>{(can('requests.submit') || can('tasks.create')) && <section className="panel org-editor"><h2>新增工作</h2><form key={`${project.id}:${revision}`} onSubmit={create}><fieldset disabled={save.isPending}><label>进入方式<select name="action">{can('requests.submit') && <option value="submit_request">提交需求</option>}{can('tasks.create') && <option value="create_task">直接创建团队任务</option>}</select></label><label>标题<input name="title" required maxLength={200} /></label><label>说明（选填）<textarea name="description" maxLength={20000} /></label><label>完成标准（选填）<textarea name="acceptance" maxLength={20000} /></label><button className="primary-button">保存</button></fieldset></form><p>接收或创建不自动分配人员，也不代表已安排本周工作。</p></section>}</div>
      </>}
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
