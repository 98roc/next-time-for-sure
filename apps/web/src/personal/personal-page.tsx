import { createOperationId } from '../identity/operation-id';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { personalCommandSchema, personalStatusLabels } from '@ntfs/contracts';
import type { Assignment, PersonalCommand, PersonalItem, PersonalSnapshot, Identity, PersonalTeamWork } from '@ntfs/contracts';
import { currentIdentity } from '../identity/api';
import { organizationSnapshot } from '../organization/api';
import { assignmentSnapshot } from '../work/assignments-api';
import { Dialog } from '../layout/dialog';
import { PersonalLifecycle } from '../lifecycle/personal-lifecycle';
import { CategoryManager } from './category-manager';
import { ManageLink } from './manage-link';
import { PersonalCard } from './personal-card';
import { PersonalCreate } from './personal-create';
import { TeamWorkPanel, PersonalTeamDetail } from './team-work-panel';
import type { TeamTask } from './team-work-panel';
import type { PersonalSend } from './personal-forms';
import { personalCommand, personalSnapshot, personalTeamWork } from './api';
import '../organization/organization.css';
import '../work/work.css';
import './personal.css';

type Dragged = { kind: 'personal'; item: PersonalItem } | { kind: 'team'; assignment: Assignment };
type ImportChoice = { assignment: Assignment; split: boolean; categoryId: string; title: string };

/** 个人看板与团队任务库同屏协作；所有状态与关联变化由同一后端事务处理。 */
export function PersonalPage() {
  const client = useQueryClient();
  const identity = useQuery({ queryKey: ['identity'], queryFn: currentIdentity, retry: false });
  const ready = Boolean(identity.data && !identity.data.mustChangePassword);
  const state = useQuery({ queryKey: ['personal', identity.data?.id, 'mine'], queryFn: () => personalSnapshot('mine'), enabled: ready, retry: false });
  const team = useQuery({ queryKey: ['work', 'personal-team', identity.data?.id], queryFn: personalTeamWork, enabled: ready, retry: false });
  const organization = useQuery({ queryKey: ['organization', identity.data?.id], queryFn: organizationSnapshot, enabled: ready, retry: false });
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const [drop, setDrop] = useState('');
  const [showTeam, setShowTeam] = useState(() => window.matchMedia('(min-width: 901px)').matches);
  const [creating, setCreating] = useState<{ categoryId: string | null } | null>(null);
  const [managing, setManaging] = useState(false);
  const [importing, setImporting] = useState<ImportChoice | null>(null);
  const [task, setTask] = useState<TeamTask | null>(null);
  const [query, setQuery] = useState('');
  const [project, setProject] = useState('');
  const [highlight, setHighlight] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const operation = useRef<{ content: string; id: string } | null>(null);
  const save = useMutation({ mutationFn: (command: PersonalCommand) => { if (!identity.data) throw new Error('请先登录。'); return personalCommand(command, identity.data.csrfToken); }, onSuccess: async (result, command) => {
    const priorAssignmentId = command.action === 'import_assignment' ? command.assignmentId : state.data?.items.find((entry) => entry.id === result.objectId)?.assignmentId;
    const wasCompleted = team.data?.assignments.find((entry) => entry.id === priorAssignmentId)?.status === 'completed';
    operation.current = null; setCreating(null); setImporting(null); setRevision((value) => value + 1);
    await Promise.all(['personal', 'assignments', 'work', 'weekly', 'reports', 'overview', 'tags'].map((key) => client.invalidateQueries({ queryKey: [key] })));
    const updated = await client.fetchQuery({ queryKey: ['personal', identity.data?.id, 'mine'], queryFn: () => personalSnapshot('mine') });
    const item = updated.items.find((entry) => entry.id === result.objectId);
    const finished = item?.status === 'completed' && item.assignmentId && updated.items.filter((entry) => entry.assignmentId === item.assignmentId).every((entry) => entry.status === 'completed');
    setNotice(wasCompleted && item && item.status !== 'completed' && !item.stopReason ? '已保存，我的团队分工已恢复进行中。' : finished && item?.stopReason === '关联分工已完成' ? '事项已完成，我的团队分工也已自动完成。' : command.action === 'import_assignment' ? '已加入我的工作，可继续拆分和安排。' : '已保存。');
    if (['import_assignment', 'start_personal', 'complete_personal', 'move_personal'].includes(command.action)) locate(result.objectId);
  } });
  const data = state.isError ? undefined : state.data;
  const actor = identity.data;
  const teamData = team.isError ? undefined : team.data;

  /** 保留幂等键跨网络重试，避免一键加入在超时后产生重复事项。 */
  function send(input: unknown, onSuccess?: () => void) {
    const parsed = personalCommandSchema.safeParse(input);
    if (!parsed.success) { setError('请检查标题、分类和日期是否填写完整。'); return; }
    const command = parsed.data;
    if ('operationId' in command) { const content = JSON.stringify({ ...command, operationId: '' }); if (operation.current?.content !== content) operation.current = { content, id: createOperationId() }; command.operationId = operation.current.id; }
    setError(''); setNotice(''); save.mutate(command, { onSuccess: () => onSuccess?.() });
  }
  function locate(id: string) {
    setQuery(''); setProject(''); setHighlight(id);
    requestAnimationFrame(() => document.getElementById(`personal-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }));
  }
  /** 单击沿用分工阶段，拖入明确分类时按目标阶段；拆分只补充下一项标题。 */
  function add(assignment: Assignment, split: boolean, categoryId?: string) {
    if (!data || save.isPending) return;
    const existing = data.items.find((entry) => entry.assignmentId === assignment.id);
    if (existing && !split) { locate(existing.id); return; }
    const status = split ? 'not_started' : assignment.status === 'completed' ? 'completed' : assignment.status === 'in_progress' ? 'in_progress' : 'not_started';
    const targets = data.categories.filter((entry) => entry.status === status);
    const selected = categoryId ?? (targets.length === 1 ? targets[0]?.id : '');
    if (split || !selected) { setImporting({ assignment, split, categoryId: selected ?? '', title: '' }); return; }
    send({ action: 'import_assignment', assignmentId: assignment.id, split, categoryId: selected, operationId: createOperationId() });
  }
  /** 排序携带完整目标列版本，筛选视图不丢失隐藏事项的顺序。 */
  function insert(categoryId: string, beforeId: string | null) {
    if (!dragged || !data || save.isPending) return;
    if (dragged.kind === 'team') add(dragged.assignment, false, categoryId);
    else if (dragged.item.id !== beforeId) send({ action: 'insert_personal', itemId: dragged.item.id, version: dragged.item.version, categoryId, beforeId, order: data.items.filter((entry) => entry.categoryId === categoryId && entry.id !== dragged.item.id).map(({ id, version }) => ({ id, version })) });
    setDragged(null); setDrop('');
  }
  const items = data?.items.filter((item) => (!query || item.title.toLowerCase().includes(query.toLowerCase())) && (!project || (project === 'private' ? item.kind === 'private' : item.projectId === project))) ?? [];
  const feedback = error || save.error?.message || state.error?.message;
  return <main className="org-layout personal-workspace">
    <header className="org-header"><div><h1>我的工作</h1><p className="subtitle">团队安排与个人行动，在这里一起推进。</p></div><div className="assignment-actions"><button onClick={() => setManaging(true)} disabled={!data}>管理分类</button><button className="primary-button" disabled={!data || !teamData} onClick={() => setCreating({ categoryId: null })}>＋ 新建事项</button></div></header>
    {identity.isError ? <p role="alert">身份读取失败，请刷新重试。</p> : identity.isPending ? <p role="status">正在检查身份…</p> : !ready ? <p>请先<a href="/account">登录并完成改密</a>。</p> : <>
      <div className="personal-toolbar"><div className="personal-board-search"><input aria-label="搜索我的事项" placeholder="搜索我的事项" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="筛选我的事项项目" value={project} onChange={(event) => setProject(event.target.value)}><option value="">全部项目与私人事项</option>{teamData?.projects.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}<option value="private">仅私人事项</option></select></div><div className="assignment-actions"><button className="text-button" disabled={state.isFetching || save.isPending} onClick={() => { void Promise.all([state.refetch(), team.refetch(), organization.refetch()]); }}>刷新</button><button aria-expanded={showTeam} className={showTeam ? 'personal-toggle-active' : ''} onClick={() => setShowTeam(!showTeam)}>团队工作 {showTeam ? '›' : '‹'}</button></div></div>
      <div className="personal-feedback" aria-live="polite">{notice && <p role="status">✓ {notice}</p>}{feedback && <p role="alert" className="form-error">{feedback} <button onClick={() => { void state.refetch(); void team.refetch(); }}>刷新工作</button></p>}</div>
      {state.isPending && <p role="status">正在加载工作看板…</p>}
      {data && identity.data && <div className={`personal-work-area ${showTeam ? 'with-team' : ''}`}>
        <section className="personal-board" aria-label="个人工作看板"><div className="personal-board-heading"><h2>我的事项 <span>{items.length}</span></h2><span>拖动卡片即可调整状态</span></div>
          <div className="personal-columns">{data.categories.map((category) => { const column = items.filter((item) => item.categoryId === category.id); return <section key={category.id} data-category-id={category.id} data-status={category.status} className={drop === category.id ? 'personal-drop-active' : ''} onDragOver={(event) => { if (dragged && !save.isPending) { event.preventDefault(); setDrop(category.id); } }} onDrop={(event) => { event.preventDefault(); insert(category.id, null); }}>
            <header className="personal-column-heading"><div><h2><i />{category.name}<span>{column.length}</span></h2>{category.name !== personalStatusLabels[category.status] && <small>{personalStatusLabels[category.status]}</small>}</div><button className="text-button" aria-label={`在${category.name}新建事项`} disabled={!teamData} onClick={() => setCreating({ categoryId: category.id })}>＋</button></header>
            {!column.length && <div className="personal-column-empty">{query || project ? '没有符合筛选条件的事项' : category.status === 'not_started' ? '从团队加入，或记下新的事项' : category.status === 'in_progress' ? '开始后，事项会来到这里' : '完成的事项会留在这里'}<span>也可以拖动卡片到此处</span></div>}
            {column.map((item) => <div key={item.id} id={`personal-${item.id}`} className={`personal-card-wrap ${highlight === item.id ? 'personal-highlight' : ''}`} draggable={!save.isPending} onDragStart={(event) => { if (event.target instanceof Element && event.target.closest('dialog')) { event.preventDefault(); return; } event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); setDragged({ kind: 'personal', item }); }} onDragEnd={() => { setDragged(null); setDrop(''); }} onDragOver={(event) => { if (dragged && !save.isPending) { event.preventDefault(); event.stopPropagation(); setDrop(item.id); } }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); insert(category.id, item.id); }}>
              {drop === item.id && <div className="personal-insert-marker" />}{actor && <Item item={item} identity={actor} data={data} team={teamData} pending={save.isPending} send={send} onTask={setTask} feedback={feedback} />}
            </div>)}
          </section>; })}</div>
        </section>
        {showTeam && (teamData && organization.data ? <TeamWorkPanel data={teamData} personal={data} identity={identity.data} organization={organization.data} pending={save.isPending} onAdd={add} onLocate={locate} onDrag={(assignment) => setDragged({ kind: 'team', assignment })} onDragEnd={() => { setDragged(null); setDrop(''); }} onClose={() => setShowTeam(false)} onTask={setTask} /> : <aside className="personal-team-panel">{team.isError || organization.isError ? <p role="alert">团队工作加载失败。<button onClick={() => { void team.refetch(); void organization.refetch(); }}>重试</button></p> : <p role="status">正在加载团队工作…</p>}</aside>)}
      </div>}
      {data && creating && teamData && <Dialog title="新建事项" busy={save.isPending} onClose={() => setCreating(null)}><PersonalCreate data={data} projects={teamData.projects} categoryId={creating.categoryId} pending={save.isPending} send={send} />{feedback && <p role="alert" className="form-error">{feedback}</p>}</Dialog>}
      {data && managing && <Dialog title="管理分类" busy={save.isPending} onClose={() => setManaging(false)}><CategoryManager categories={data.categories} pending={save.isPending} revision={revision} send={send} />{feedback && <p role="alert" className="form-error">{feedback}</p>}</Dialog>}
      {data && importing && <Dialog title={importing.split ? '拆出一项个人工作' : '选择放入的分类'} busy={save.isPending} onClose={() => setImporting(null)}><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); send({ action: 'import_assignment', assignmentId: importing.assignment.id, split: importing.split, categoryId: String(form.get('categoryId')), ...(importing.split ? { title: String(form.get('title')) } : {}), operationId: createOperationId() }); }}><p className="detail-meta">{teamData?.tasks.find((entry) => entry.id === importing.assignment.taskId)?.title} · 关联本人分工</p>{importing.split && <label>这一步要做什么？<input name="title" required maxLength={200} placeholder="例如：完成接口联调" /></label>}<label>放入分类<select name="categoryId" required defaultValue={importing.categoryId}><option value="" disabled>请选择分类</option>{data.categories.filter((entry) => entry.status === (importing.split ? 'not_started' : importing.assignment.status)).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>{importing.assignment.status === 'completed' && importing.split && <p className="inline-notice">新增工作后，我的分工将恢复进行中。</p>}<button className="primary-button" disabled={save.isPending}>加入我的工作</button></form>{feedback && <p role="alert" className="form-error">{feedback}</p>}</Dialog>}
      {task && identity.data && organization.data && <PersonalTeamDetail task={task} identity={identity.data} organization={organization.data} onClose={() => { setTask(null); void team.refetch(); void state.refetch(); }} onSelect={setTask} />}
    </>}
  </main>;
}

/** 个人详情仅加载本人可关联分工，卡片来源直接打开当前页面的团队详情。 */
function Item({ item, identity, data, team, pending, send, onTask, feedback }: { item: PersonalItem; identity: Identity; data: PersonalSnapshot; team: PersonalTeamWork | undefined; pending: boolean; send: PersonalSend; onTask: (task: TeamTask) => void; feedback: string | undefined }) {
  const assignments = useQuery({ queryKey: ['assignments', identity.id, item.projectId], queryFn: () => assignmentSnapshot(item.projectId ?? ''), enabled: Boolean(item.projectId), retry: false });
  const assignment = team?.assignments.find((entry) => entry.id === item.assignmentId);
  const task = team?.tasks.find((entry) => entry.id === assignment?.taskId);
  const project = team?.projects.find((entry) => entry.id === item.projectId);
  return <PersonalCard item={item} own data={data} assignments={assignments.data} pending={pending} send={send} feedback={feedback ? <p role="alert" className="form-error">{feedback}</p> : null} source={<>{project && <span>{project.name}</span>}{task && <button className="text-button" onClick={() => onTask(task)} title={`查看团队任务：${task.title}`}>↗ {task.title}</button>}</>} management={<><PersonalLifecycle item={item} identity={identity} />{item.kind === 'work' && <ManageLink item={item} identity={identity} pending={pending} send={send} />}</>} />;
}
