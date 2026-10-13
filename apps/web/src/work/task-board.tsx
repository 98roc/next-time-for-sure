import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Identity, OrganizationSnapshot, TaskCommand, TaskImpact, WorkSnapshot } from '@ntfs/contracts';
import { taskCommand, taskImpact } from './tasks-api';
import { assignmentSnapshot } from './assignments-api';
import './task-board.css';

type Task = WorkSnapshot['tasks'][number];
const columns = [{ status: 'not_started', title: '待开始' }, { status: 'in_progress', title: '进行中' }, { status: 'completed', title: '已完成' }];
/** 团队状态移动使用现有业务命令，落点不直接赋值状态或代改成员执行事实。 */
export function TaskBoard({ tasks, identity, organization, projectId }: { tasks: Task[]; identity: Identity; organization: OrganizationSnapshot; projectId: string }) {
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
  const save = useMutation({ mutationFn: (command: TaskCommand) => taskCommand(command, identity.csrfToken), onSuccess: async () => { setReview(null); setReopen(null); await Promise.all(['work', 'assignments', 'personal'].map((key) => client.invalidateQueries({ queryKey: [key] }))); } });
  const busy = save.isPending || loading;
  const project = organization.projects.find((entry) => entry.id === projectId);
  const manager = organization.teams.some((team) => team.id === project?.teamId && team.leaderId === identity.id) || project?.members.some((member) => member.accountId === identity.id && member.roles.includes('project_lead'));
  const stopped = (task: Task) => ['completed', 'cancelled'].includes(task.status);
  const canMove = (task: Task) => task.ownerId === identity.id || (stopped(task) && manager);
  const hasAssignment = (task: Task) => assignments.data?.assignments.some((entry) => (entry.taskId === task.id || tasks.some((child) => child.parentId === task.id && child.id === entry.taskId)) && !['exited', 'transferred'].includes(entry.status));

  async function move(task: Task, status: string) {
    setDragged(null); setTarget(''); setError(''); setReview(null); setReopen(null);
    if (busy || task.status === status) return;
    if (!canMove(task)) { setError('没有该任务的状态操作权限。'); return; }
    if (stopped(task)) {
      const restored = task.startedAt ? 'in_progress' : 'not_started';
      if (status !== restored) { setError(`重开后按原开始记录恢复为${restored === 'in_progress' ? '进行中' : '待开始'}，不能拖动伪造执行时间。`); return; }
      setReopen(task); return;
    }
    if (status === 'not_started') { setError('进行中的任务不能直接退回待开始；请保留实际开始记录。'); return; }
    if (status === 'in_progress') { save.mutate({ action: 'start_task', taskId: task.id, version: task.version }); return; }
    if (status === 'completed') {
      setLoading(true);
      try { setReview(await taskImpact(task.id, 'complete_task')); }
      catch (failure) { setError(failure instanceof Error ? failure.message : '读取影响范围失败。'); }
      finally { setLoading(false); }
    }
  }
  function card(task: Task) {
    const destination = stopped(task) ? (task.startedAt ? 'in_progress' : 'not_started') : task.status === 'not_started' ? 'in_progress' : 'completed';
    return <article className="task-board-card" key={task.id} draggable={Boolean(canMove(task) && !busy)} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', task.id); setDragged(task); }} onDragEnd={() => { setDragged(null); setTarget(''); }}>
      <h3><a href={`#task-${task.id}`}>{task.title}</a></h3><p>{task.parentId ? '子任务 · ' : ''}{organization.accounts.find((entry) => entry.id === task.ownerId)?.displayName ?? '成员'}</p>{task.expectedOn && <p>预计 {task.expectedOn}</p>}{assignments.data && !assignments.isError && !hasAssignment(task) && <span className="status-badge">待分配</span>}
      {canMove(task) && <div><button disabled={busy} onClick={() => { void move(task, destination); }}>{stopped(task) ? '重开…' : task.status === 'not_started' ? '开始' : '整体结束…'}</button>{task.status === 'not_started' && <button disabled={busy} onClick={() => { void move(task, 'completed'); }}>整体结束…</button>}</div>}
    </article>;
  }
  return <section className="panel"><h2>团队状态看板</h2><p>拖动或使用卡片按钮执行相同规则；保存成功才改变位置，完成需确认整体范围。</p><div className="assignment-actions"><label><input type="checkbox" checked={unassigned} disabled={!assignments.data || assignments.isError} onChange={(event) => setUnassigned(event.target.checked)} />只看待分配</label><label><input type="checkbox" checked={cancelled} onChange={(event) => setCancelled(event.target.checked)} />查看已取消</label></div>
      {assignments.isError && <p role="alert">分工加载失败，待分配标记暂不可用。<button onClick={() => { void assignments.refetch(); }}>重试</button></p>}
      {(error || save.isError) && <p role="alert" className="form-error">{error || save.error?.message} 卡片保留已保存位置。<button onClick={() => { setReview(null); setReopen(null); void client.invalidateQueries({ queryKey: ['work'] }); }}>刷新核对</button></p>}
      {review && <section className="request-card" role="region" aria-label="整体结束确认"><h3>确认整体结束</h3><p>停止该任务范围继续执行，保留成员本人状态及时间。</p><ul>{review.children.map((entry) => <li key={entry.id}>子任务：{entry.title}</li>)}{review.assignments.map((entry) => <li key={entry.id}>分工：{organization.accounts.find((account) => account.id === entry.accountId)?.displayName ?? '成员'} · {entry.content}</li>)}{review.personal.map((entry) => <li key={entry.id}>个人工作：{entry.title}</li>)}</ul><p>另有 {review.hiddenPersonalCount} 条受查看权限保护的未完成个人工作。</p><button disabled={busy} onClick={() => save.mutate({ action: 'complete_task', taskId: review.taskId, version: review.version, confirmation: review.confirmation })}>确认整体结束</button><button onClick={() => setReview(null)}>取消移动</button></section>}
      {reopen && <form className="request-card" onSubmit={(event) => { event.preventDefault(); const reason = String(new FormData(event.currentTarget).get('reason')).trim(); if (!reason) return; save.mutate({ action: 'reopen_task', taskId: reopen.id, version: reopen.version, reason }); }}><h3>重开 {reopen.title}</h3><label>原因<textarea name="reason" required maxLength={20000} /></label><button disabled={busy}>确认重开</button><button type="button" onClick={() => setReopen(null)}>取消移动</button></form>}
      <div className="task-board-columns">{columns.map((column) => <section key={column.status} className={target === column.status ? 'task-board-column drop-active' : 'task-board-column'} onDragOver={(event) => { if (dragged && !busy) { event.preventDefault(); setTarget(column.status); } }} onDrop={(event) => { event.preventDefault(); if (dragged) void move(dragged, column.status); }}><h3>{column.title}</h3>{target === column.status && <p className="drop-placeholder">松开执行对应状态操作</p>}{tasks.filter((task) => task.status === column.status && (!unassigned || assignments.isError || !hasAssignment(task))).map(card)}</section>)}</div>
      {cancelled && <section><h3>已取消任务</h3>{tasks.filter((task) => task.status === 'cancelled').map(card)}</section>}
  </section>;
}
