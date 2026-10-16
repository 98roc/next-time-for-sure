import { createOperationId } from '../identity/operation-id';
import { TaskTagFields, taskCreationTags } from '../work/task-tag-fields';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Identity, OrganizationSnapshot } from '@ntfs/contracts';
import { workCommandSchema } from '@ntfs/contracts';
import { Dialog } from '../layout/dialog';
import { weekLabel } from '../layout/week-picker';
import { workCommand, workSnapshot } from '../work/api';
import { TaskDetail } from '../work/task-detail';

type Context = { organization: OrganizationSnapshot; identity: Identity; week: string };

/** 在周计划内选择现有任务或创建同源任务；创建后接续分人、排周，不复制业务对象。 */
export function WeeklyTaskPicker({ organization, identity, week, mode, initialProjectId, onClose, onSelect }: Context & {
  mode: 'create' | 'existing'; initialProjectId: string; onClose: () => void; onSelect: (projectId: string, taskId: string) => void;
}) {
  const client = useQueryClient();
  const projects = organization.projects.filter((entry) => !entry.archived);
  const [projectId, setProjectId] = useState(projects.find((entry) => entry.id === initialProjectId)?.id ?? projects[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const operation = useRef({ content: '', id: '' });
  const state = useQuery({ queryKey: ['work', identity.id, projectId], queryFn: () => workSnapshot(projectId), enabled: Boolean(projectId), retry: false });
  const project = projects.find((entry) => entry.id === projectId);
  const roles = project?.members.find((entry) => entry.accountId === identity.id)?.roles ?? [];
  const leader = organization.teams.some((team) => team.id === project?.teamId && team.leaderId === identity.id);
  const canCreate = organization.policies.some((policy) => policy.permissions.includes('tasks.create') && (policy.role === 'team_leader' ? leader : roles.some((role) => role === policy.role)));
  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const command = workCommandSchema.parse({ action: 'create_task', projectId, tags: taskCreationTags(form), title: String(form.get('title')), description: String(form.get('description') ?? ''), acceptance: String(form.get('acceptance') ?? ''), milestoneId: String(form.get('milestoneId') ?? '') || null, operationId: createOperationId() });
      if (command.action !== 'create_task') throw new Error('创建参数无效。');
      const content = JSON.stringify({ ...command, operationId: '' });
      if (operation.current.content !== content) operation.current = { content, id: createOperationId() };
      return workCommand({ ...command, operationId: operation.current.id }, identity.csrfToken);
    },
    onSuccess: async (result) => { await client.invalidateQueries({ queryKey: ['work'] }); onSelect(projectId, result.objectId); },
  });
  const tasks = state.isError ? [] : state.data?.tasks.filter((task) => !['completed', 'cancelled'].includes(task.status) && !state.data.tasks.some((child) => child.parentId === task.id) && task.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  return <Dialog title={mode === 'create' ? `新建任务 · ${weekLabel(week)}` : `选择已有任务 · ${weekLabel(week)}`} onClose={onClose} busy={save.isPending}>
    <label>所属项目<select disabled={save.isPending} value={projectId} onChange={(event) => { setProjectId(event.target.value); setQuery(''); save.reset(); }}>{projects.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
    {state.isFetching && <p role="status">正在读取任务…</p>}
    {state.error && <p role="alert" className="form-error">{state.error.message}<button onClick={() => { void state.refetch(); }}>重新读取</button></p>}
    {mode === 'existing' ? <>
      <label>搜索任务<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入任务名称" /></label>
      <div className="weekly-task-picker">{tasks.map((task) => <button key={task.id} onClick={() => onSelect(projectId, task.id)}><strong>{task.title}</strong><span className="detail-meta">选择任务，查看分工并安排</span></button>)}</div>
      {!tasks.length && !state.isFetching && !state.isError && <p>没有匹配的可安排任务，可新建任务或调整搜索。</p>}
    </> : canCreate ? <form key={projectId} onSubmit={(event) => { event.preventDefault(); save.mutate(new FormData(event.currentTarget)); }}><fieldset disabled={save.isPending || !state.data || state.isError}>
      <label>任务名称<input name="title" required maxLength={200} /></label>
      <TaskTagFields identity={identity} organization={organization} projectId={projectId} initialWeek={week} />
      <details><summary>里程碑、说明与完成标准（选填）</summary>
        <label>关联里程碑<select name="milestoneId"><option value="">不关联</option>{state.data?.milestones.filter((entry) => entry.status !== 'removed').map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label>
        <label>说明<textarea name="description" maxLength={20000} /></label><label>完成标准<textarea name="acceptance" maxLength={20000} /></label>
      </details>
      <p className="detail-meta">创建后在此分配人员，再安排至{weekLabel(week)}；尚未安排的任务保留在项目中。</p>
      <button className="primary-button">{save.isPending ? '正在创建…' : '创建并分配人员 →'}</button>
    </fieldset></form> : <p>当前项目没有创建任务权限，请选择有权限的项目或联系项目管理者。</p>}
    {save.error && <p role="alert" className="form-error">{save.error.message}</p>}
  </Dialog>;
}

/** 任务详情在周计划原页打开，沿用选中周和统一权限；读取失败不能退回旧任务内容。 */
export function WeeklyTaskDetail({ organization, identity, week, projectId, taskId, onClose, onSelect }: Context & {
  projectId: string; taskId: string; onClose: () => void; onSelect: (projectId: string, taskId: string) => void;
}) {
  const state = useQuery({ queryKey: ['work', identity.id, projectId], queryFn: () => workSnapshot(projectId), retry: false });
  const task = state.isError ? undefined : state.data?.tasks.find((entry) => entry.id === taskId);
  if (task && state.data) return <TaskDetail key={task.id} task={task} data={state.data} organization={organization} identity={identity} initialWeek={week} onClose={onClose} onSelect={(id) => onSelect(projectId, id)} />;
  return <Dialog title="任务详情" onClose={onClose}>{state.isPending ? <p role="status">正在读取任务…</p> : <p role="alert">{state.error?.message ?? '任务已移除或无权查看。'}<button onClick={() => { void state.refetch(); }}>重新读取</button></p>}</Dialog>;
}
