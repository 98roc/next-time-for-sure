import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Identity, TaskCommand, TaskImpact, WorkSnapshot } from '@ntfs/contracts';
import { taskCommand, taskImpact } from './tasks-api';

/** 节点上的进度与执行快捷入口，复用任务权限、版本及完成预览契约。 */
export function TaskQuickActions({ task, identity }: { task: WorkSnapshot['tasks'][number]; identity: Identity }) {
  const client = useQueryClient();
  const [review, setReview] = useState<TaskImpact | null>(null);
  const preview = useMutation({ mutationFn: () => taskImpact(task.id, 'complete_task'), onSuccess: setReview });
  const save = useMutation({ mutationFn: (command: TaskCommand) => taskCommand(command, identity.csrfToken), onSuccess: async () => { setReview(null); await Promise.all(['work', 'assignments', 'personal'].map((key) => client.invalidateQueries({ queryKey: [key] }))); } });
  if (task.ownerId !== identity.id || ['completed', 'cancelled'].includes(task.status)) return <p className="detail-meta">累计进度 {task.progress}%</p>;
  const busy = save.isPending || preview.isPending;
  return <section aria-label="节点执行"><form className="quick-progress" onSubmit={(event) => { event.preventDefault(); save.mutate({ action: 'task_progress', taskId: task.id, version: task.version, progress: Number(new FormData(event.currentTarget).get('progress')) }); }}>
    <label>累计进度（%）<input key={`${task.id}:${task.version}`} name="progress" type="number" min="0" max="100" step="1" defaultValue={task.progress} required disabled={busy} /></label><button disabled={busy}>保存进度</button>
  </form><div className="assignment-actions">{task.status === 'not_started' && <button disabled={busy} onClick={() => save.mutate({ action: 'start_task', taskId: task.id, version: task.version })}>开始</button>}{task.status === 'in_progress' && <button disabled={busy} onClick={() => save.mutate({ action: 'undo_start_task', taskId: task.id, version: task.version })}>撤销开始</button>}<button disabled={busy} onClick={() => preview.mutate()}>完成…</button></div>
    {(save.error || preview.error) && <p role="alert" className="form-error">{save.error?.message || preview.error?.message}</p>}
    {save.isSuccess && <p role="status">已保存</p>}
    {review && <section className="panel"><h3>确认整体完成</h3><p>将停止该任务范围继续执行，保留个人记录。</p>{review.children.length + review.assignments.length + review.personal.length + review.hiddenPersonalCount > 0 && <><p>仍有以下未完成工作：</p><ul>{review.children.map((entry) => <li key={entry.id}>子任务：{entry.title}</li>)}{review.assignments.map((entry) => <li key={entry.id}>分工：{entry.content || '未填写内容'}</li>)}{review.personal.map((entry) => <li key={entry.id}>个人工作：{entry.title}</li>)}</ul>{review.hiddenPersonalCount > 0 && <p>另有 {review.hiddenPersonalCount} 项受查看权限保护的工作。</p>}</>}<div className="assignment-actions"><button className="primary-button" disabled={busy} onClick={() => save.mutate({ action: 'complete_task', taskId: task.id, version: review.version, confirmation: review.confirmation })}>确认完成</button><button disabled={busy} onClick={() => setReview(null)}>暂不完成</button></div></section>}
  </section>;
}
