import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Identity, LifecycleIntent, OrganizationSnapshot, TaskCommand, TaskImpact, WorkSnapshot } from '@ntfs/contracts';
import { taskCommand, taskImpact } from './tasks-api';
import { assignmentSnapshot } from './assignments-api';
import { LifecyclePanel } from '../lifecycle/lifecycle-panel';
import './task-board.css';

type Task = WorkSnapshot['tasks'][number];
const columns = [{ status: 'not_started', title: '待开始' }, { status: 'in_progress', title: '进行中' }, { status: 'completed', title: '已完成' }];
/** 团队状态移动使用现有业务命令，落点不直接赋值状态或代改成员执行事实。 */
export function TaskBoard({ tasks, identity, organization, projectId, query, onOpenTask }: { tasks: Task[]; identity: Identity; organization: OrganizationSnapshot; projectId: string; query: string; onOpenTask: (id: string) => void }) {
  const client = useQueryClient();
  const assignments = useQuery({ queryKey: ['assignments', identity.id, projectId], queryFn: () => assignmentSnapshot(projectId), retry: false });
  const [dragged, setDragged] = useState<Task | null>(null);
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  const [review, setReview] = useState<TaskImpact | null>(null);
  const [reopen, setReopen] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [unassigned, setUnassigned] = useState(false);
  const [deletion, setDeletion] = useState<LifecycleIntent | null>(null);
  const save = useMutation({ mutationFn: (command: TaskCommand) => taskCommand(command, identity.csrfToken), onSuccess: async () => { setReview(null); setReopen(null); await Promise.all(['work', 'assignments', 'personal'].map((key) => client.invalidateQueries({ queryKey: [key] }))); } });
  const busy = save.isPending || loading;
  const project = organization.projects.find((entry) => entry.id === projectId);
  const manager = organization.teams.some((team) => team.id === project?.teamId && team.leaderId === identity.id) || project?.members.some((member) => member.accountId === identity.id && member.roles.includes('project_lead'));
  const canAssign = organization.policies.some((policy) => policy.permissions.includes('work.assign') && (policy.role === 'team_leader' ? organization.teams.some((team) => team.id === project?.teamId && team.leaderId === identity.id) : policy.role === 'group_leader' && organization.groups.some((group) => group.teamId === project?.teamId && group.leaderId === identity.id)));
  const stopped = (task: Task) => ['completed', 'cancelled'].includes(task.status);
  const canMove = (task: Task) => task.ownerId === identity.id || (stopped(task) && manager);
  const hasAssignment = (task: Task) => assignments.data?.assignments.some((entry) => (entry.taskId === task.id || tasks.some((child) => child.parentId === task.id && child.id === entry.taskId)) && !['exited', 'transferred'].includes(entry.status));
  // 计数与卡片共用展示范围；拖拽排序仍使用完整任务集合。
  const visibleTasks = tasks.filter((task) => task.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (cancelled || task.status !== 'cancelled') && (!unassigned || assignments.isError || !hasAssignment(task)));
  function reorder(task: Task, beforeId: string | null) {
    setDragged(null); setTarget(''); setError('');
    if (busy || task.id === beforeId) return;
    save.mutate({ action: 'reorder_task', taskId: task.id, version: task.version, beforeId, order: tasks.filter((entry) => entry.status === task.status).map(({ id, version }) => ({ id, version })) });
  }

  async function move(task: Task, status: string) {
    setDragged(null); setTarget(''); setError(''); setReview(null); setReopen(null);
    if (busy) return;
    if (task.status === status) { reorder(task, null); return; }
    if (!canMove(task)) { setError('没有该任务的状态操作权限。'); return; }
    if (stopped(task)) {
      const restored = task.startedAt ? 'in_progress' : 'not_started';
      if (status !== restored) { setError(`重开后按原开始记录恢复为${restored === 'in_progress' ? '进行中' : '待开始'}，不能拖动伪造执行时间。`); return; }
      setReopen(task); return;
    }
    if (status === 'not_started') { save.mutate({ action: 'undo_start_task', taskId: task.id, version: task.version }); return; }
    if (status === 'in_progress') { save.mutate({ action: 'start_task', taskId: task.id, version: task.version }); return; }
    if (status === 'completed') {
      setLoading(true);
      try { setReview(await taskImpact(task.id, 'complete_task')); }
      catch (failure) { setError(failure instanceof Error ? failure.message : '读取影响范围失败。'); }
      finally { setLoading(false); }
    }
  }
  function card(task: Task) {
    const needsPeople = !stopped(task) && assignments.data && !assignments.isError && !hasAssignment(task);
    const destination = stopped(task) ? (task.startedAt ? 'in_progress' : 'not_started') : task.status === 'not_started' ? 'in_progress' : 'completed';
    const column = tasks.filter((entry) => entry.status === task.status);
    const previous = column[column.findIndex((entry) => entry.id === task.id) - 1];
    return <article className="task-board-card" key={task.id} onDragOver={(event) => { if (dragged?.status === task.status && dragged.id !== task.id && !busy) { event.preventDefault(); event.stopPropagation(); setTarget(task.id); } }} onDrop={(event) => { if (dragged?.status === task.status) { event.preventDefault(); event.stopPropagation(); reorder(dragged, task.id); } }} draggable={Boolean(canMove(task) && !busy)} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', task.id); setDragged(task); }} onDragEnd={() => { setDragged(null); setTarget(''); }}>
      {target === task.id && <p className="drop-placeholder">插入此卡片之前</p>}
      <div className="task-card-heading"><h3><button className="text-button" title={task.title} onClick={() => onOpenTask(task.id)}>{task.title}</button></h3>
        {(task.ownerId === identity.id || manager) && <details className="task-card-menu" name="task-card-actions" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary aria-label={`更多操作：${task.title}`} title="更多操作">···</summary><div onClick={(event) => { if (event.target instanceof HTMLButtonElement) { event.currentTarget.parentElement?.removeAttribute('open'); event.currentTarget.parentElement?.querySelector('summary')?.focus(); } }}>
          {task.ownerId === identity.id && <>
          <button disabled={busy || !previous} onClick={() => { if (previous) reorder(task, previous.id); }}>上移</button><button disabled={busy || column.at(-1)?.id === task.id} onClick={() => reorder(task, null)}>移至列末</button>
          {task.status === 'not_started' && <button disabled={busy} onClick={() => { void move(task, 'completed'); }}>整体结束…</button>}
          {task.status === 'in_progress' && <button disabled={busy} onClick={() => { void move(task, 'not_started'); }}>撤销开始</button>}
          </>}
          <button className="task-delete-action" disabled={busy} onClick={() => setDeletion({ action: 'delete_task', objectId: task.id })}>删除任务…</button>
        </div></details>}
      </div>
      <div className="task-card-meta"><span>{task.parentId ? '子任务 · ' : ''}{organization.accounts.find((entry) => entry.id === task.ownerId)?.displayName ?? '成员'}</span>{task.expectedOn && <span>预计 {task.expectedOn}</span>}</div>
      {task.blockedReason && <p className="task-card-blocker" title={task.blockedReason}>受阻 · {task.blockedReason}</p>}
      <div className="task-card-footer">{needsPeople && <button className="primary-button" onClick={() => onOpenTask(task.id)}>{canAssign ? '分配人员 →' : '查看 / 认领'}</button>}
        {canMove(task) && <button className={needsPeople ? 'task-card-secondary' : 'task-card-next'} disabled={busy} onClick={() => { void move(task, destination); }}>{stopped(task) ? '重开…' : task.status === 'not_started' ? '开始' : '整体结束…'}</button>}
      </div>
    </article>;
  }
  return <section className="task-board" aria-label="任务看板"><div className="task-board-toolbar"><span className="detail-meta">{visibleTasks.length} 项任务</span><div className="assignment-actions"><label><input type="checkbox" checked={unassigned} disabled={!assignments.data || assignments.isError} onChange={(event) => setUnassigned(event.target.checked)} />只看待分配</label><label><input type="checkbox" checked={cancelled} onChange={(event) => setCancelled(event.target.checked)} />查看已取消</label></div></div>
      {deletion && <LifecyclePanel identity={identity} initialIntent={deletion} options={[{ label: '删除任务', intent: deletion }]} onClose={() => setDeletion(null)} />}
      {assignments.isError && <p role="alert">分工加载失败，待分配标记暂不可用。<button onClick={() => { void assignments.refetch(); }}>重试</button></p>}
      {(error || save.isError) && <p role="alert" className="form-error">{error || save.error?.message} 卡片保留已保存位置。<button onClick={() => { setReview(null); setReopen(null); void client.invalidateQueries({ queryKey: ['work'] }); }}>刷新核对</button></p>}
      {review && <section className="request-card" role="region" aria-label="整体结束确认"><h3>确认整体结束</h3><p>停止该任务范围继续执行，保留成员本人状态及时间。</p><ul>{review.children.map((entry) => <li key={entry.id}>子任务：{entry.title}</li>)}{review.assignments.map((entry) => <li key={entry.id}>分工：{organization.accounts.find((account) => account.id === entry.accountId)?.displayName ?? '成员'} · {entry.content}</li>)}{review.personal.map((entry) => <li key={entry.id}>个人工作：{entry.title}</li>)}</ul><p>另有 {review.hiddenPersonalCount} 条受查看权限保护的未完成个人工作。</p><button disabled={busy} onClick={() => save.mutate({ action: 'complete_task', taskId: review.taskId, version: review.version, confirmation: review.confirmation })}>确认整体结束</button><button onClick={() => setReview(null)}>取消移动</button></section>}
      {reopen && <form className="request-card" onSubmit={(event) => { event.preventDefault(); const reason = String(new FormData(event.currentTarget).get('reason')).trim(); if (!reason) return; save.mutate({ action: 'reopen_task', taskId: reopen.id, version: reopen.version, reason }); }}><h3>重开 {reopen.title}</h3><label>原因<textarea name="reason" required maxLength={20000} /></label><button disabled={busy}>确认重开</button><button type="button" onClick={() => setReopen(null)}>取消移动</button></form>}
      <div className="task-board-columns">{columns.map((column) => <section key={column.status} className={target === column.status ? 'task-board-column drop-active' : 'task-board-column'} onDragOver={(event) => { if (dragged && !busy) { event.preventDefault(); setTarget(column.status); } }} onDrop={(event) => { event.preventDefault(); if (dragged) void move(dragged, column.status); }}><h3>{column.title} <small>{visibleTasks.filter((task) => task.status === column.status).length}</small></h3>{target === column.status && <p className="drop-placeholder">松开执行对应状态操作</p>}{visibleTasks.filter((task) => task.status === column.status).map(card)}</section>)}</div>
      {cancelled && <section><h3>已取消任务</h3>{visibleTasks.filter((task) => task.status === 'cancelled').map(card)}</section>}
  </section>;
}
