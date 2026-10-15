import { useState } from 'react';
import type { Assignment, Identity, OrganizationSnapshot, PersonalSnapshot, PersonalTeamWork } from '@ntfs/contracts';
import { useQuery } from '@tanstack/react-query';
import { workSnapshot } from '../work/api';
import { TaskDetail } from '../work/task-detail';

export type TeamTask = PersonalTeamWork['tasks'][number];
/** 团队任务库默认聚焦本人分工，可切换权限内全部工作，加入和查看无需离开看板。 */
export function TeamWorkPanel({ data, personal, identity, organization, pending, onAdd, onLocate, onDrag, onDragEnd, onClose, onTask }: {
  data: PersonalTeamWork; personal: PersonalSnapshot; identity: Identity; organization: OrganizationSnapshot; pending: boolean;
  onAdd: (assignment: Assignment, split: boolean) => void; onLocate: (id: string) => void;
  onDrag: (assignment: Assignment) => void; onDragEnd: () => void; onClose: () => void; onTask: (task: TeamTask) => void;
}) {
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [project, setProject] = useState('');
  const [query, setQuery] = useState('');
  const [person, setPerson] = useState('');
  const [showEnded, setShowEnded] = useState(false);
  const active = data.assignments.filter((entry) => !['exited', 'transferred'].includes(entry.status));
  const rows = data.tasks.filter((task) => (!project || task.projectId === project) && (!query || `${task.title} ${data.projects.find((entry) => entry.id === task.projectId)?.name ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    && (showEnded || (!['completed', 'cancelled'].includes(task.status) && !data.projects.find((entry) => entry.id === task.projectId)?.archived))
    && (scope === 'all' || active.some((entry) => entry.taskId === task.id && entry.accountId === identity.id))
    && (!person || active.some((entry) => entry.taskId === task.id && entry.accountId === person)));
  return <aside className="personal-team-panel" aria-label="团队工作">
    <header><div><h2>团队工作 <span>{rows.length}</span></h2><p>把团队安排，变成自己的行动</p></div><button className="text-button" aria-label="收起团队工作" onClick={onClose}>×</button></header>
    <div className="view-tabs" aria-label="团队工作范围"><button aria-pressed={scope === 'mine'} onClick={() => { setScope('mine'); setPerson(''); }}>分配给我</button><button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>全部可见</button></div>
    <div className="personal-team-filters"><input aria-label="搜索团队工作" placeholder="搜索任务或项目" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="筛选团队工作项目" value={project} onChange={(event) => setProject(event.target.value)}><option value="">所有项目</option>{data.projects.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>{scope === 'all' && <select aria-label="筛选执行人" value={person} onChange={(event) => setPerson(event.target.value)}><option value="">所有执行人</option>{organization.accounts.filter((account) => active.some((entry) => entry.accountId === account.id)).map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}</select>}<label className="personal-check-filter"><input type="checkbox" checked={showEnded} onChange={(event) => setShowEnded(event.target.checked)} />包含已结束与归档</label></div>
    <div className="personal-team-list">{rows.map((task) => {
      const assignment = active.find((entry) => entry.taskId === task.id && entry.accountId === identity.id);
      const linked = assignment ? personal.items.filter((entry) => entry.assignmentId === assignment.id) : [];
      const parent = task.parentId ? data.tasks.find((entry) => entry.id === task.parentId) : undefined;
      const executable = !['completed', 'cancelled'].includes(task.status) && !data.projects.find((entry) => entry.id === task.projectId)?.archived && (!parent || !['completed', 'cancelled'].includes(parent.status)) && !data.tasks.some((entry) => entry.parentId === task.id);
      return <article key={task.id} className="personal-team-card" draggable={Boolean(assignment && executable && !pending && !linked.length)} onDragStart={(event) => { if (!assignment) return; event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('text/plain', assignment.id); onDrag(assignment); }} onDragEnd={onDragEnd}>
        <p className="personal-source-label">{data.projects.find((entry) => entry.id === task.projectId)?.name}{task.parentId && ' · 子任务'}</p><h3><button className="text-button" onClick={() => onTask(task)}>{task.title}</button></h3>
        {assignment?.content && assignment.content !== task.title && <p className="personal-team-content">我的分工 · {assignment.content}</p>}
        <div className="personal-team-people">{active.filter((entry) => entry.taskId === task.id).map((entry) => organization.accounts.find((account) => account.id === entry.accountId)?.displayName ?? '成员').join('、') || '尚未分配人员'}</div>
        <div className="personal-team-actions">{linked[0] ? <><button className="personal-added" onClick={() => onLocate(linked[0]?.id ?? '')}>✓ 已加入 · {linked.length} 项</button>{executable && <button className="text-button" disabled={pending} onClick={() => { if (assignment) onAdd(assignment, true); }}>再拆一项</button>}</> : assignment && executable ? <button className="primary-button" disabled={pending} onClick={() => onAdd(assignment, false)}>＋ 加入我的工作</button> : <button onClick={() => onTask(task)}>{executable ? '查看并认领' : '查看任务'}</button>}</div>
      </article>;
    })}{!rows.length && <div className="personal-panel-empty">{query || project || person ? '没有符合筛选条件的任务' : scope === 'mine' ? '暂时没有分配给你的工作' : '暂无可见团队任务'}{scope === 'mine' && <button className="text-button" onClick={() => setScope('all')}>查看全部团队工作 →</button>}</div>}</div>
    <p className="personal-team-tip">可直接拖入看板，也可点击加入后再拆分。</p>
  </aside>;
}

/** 复用团队详情与认领权限；关联来源在本页打开，关闭后返回原看板位置。 */
export function PersonalTeamDetail({ task, identity, organization, onClose, onSelect }: { task: TeamTask; identity: Identity; organization: OrganizationSnapshot; onClose: () => void; onSelect: (task: TeamTask) => void }) {
  const state = useQuery({ queryKey: ['work', identity.id, task.projectId], queryFn: () => workSnapshot(task.projectId) });
  const current = state.data?.tasks.find((entry) => entry.id === task.id);
  if (state.isError) return <div role="alert">团队任务读取失败。<button onClick={() => { void state.refetch(); }}>重试</button><button onClick={onClose}>关闭</button></div>;
  if (!state.data || !current) return <p role="status">正在读取任务…<button onClick={onClose}>取消</button></p>;
  return <TaskDetail task={current} data={state.data} identity={identity} organization={organization} onClose={onClose} onSelect={(id) => { const next = state.data.tasks.find((entry) => entry.id === id); if (next) onSelect(next); }} />;
}
