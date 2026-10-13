import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { taskCommandSchema } from '@ntfs/contracts';
import type { Identity, OrganizationSnapshot, TaskCommand, TaskImpact, WorkSnapshot } from '@ntfs/contracts';
import { taskCommand, taskImpact } from './tasks-api';

/** 团队整体操作明确展示影响范围，不能用快捷按钮绕过二次确认。 */
export function TaskControls({ task, organization, identity }: { task: WorkSnapshot['tasks'][number]; organization: OrganizationSnapshot; identity: Identity }) {
  const client = useQueryClient();
  const [review, setReview] = useState<TaskImpact | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const project = organization.projects.find((entry) => entry.id === task.projectId);
  const manager = organization.teams.some((entry) => entry.id === project?.teamId && entry.leaderId === identity.id) || project?.members.some((entry) => entry.accountId === identity.id && entry.roles.includes('project_lead'));
  const owner = task.ownerId === identity.id;
  const stopped = ['completed', 'cancelled'].includes(task.status);
  const save = useMutation({ mutationFn: (command: TaskCommand) => taskCommand(command, identity.csrfToken), onSuccess: async () => { setReview(null); await Promise.all(['work', 'assignments', 'personal'].map((key) => client.invalidateQueries({ queryKey: [key] }))); } });
  function send(input: unknown) { const command = taskCommandSchema.safeParse(input); if (!command.success) { setError('请填写必要原因、有效主负责人或0～100的累计进度。'); return; } setError(''); save.mutate(command.data); }
  async function preview(intent: TaskImpact['intent']) { setLoading(true); setError(''); setReview(null); try { setReview(await taskImpact(task.id, intent)); } catch (failure) { setError(failure instanceof Error ? failure.message : '影响范围读取失败。'); } finally { setLoading(false); } }
  const pending = loading || save.isPending;
  return <section className="task-controls"><p>累计进度 {task.progress}% · 整体开始 {task.startedAt ? new Date(task.startedAt).toLocaleString('zh-CN') : '未记录'} · 整体结束 {task.endedAt ? new Date(task.endedAt).toLocaleString('zh-CN') : '未记录'}</p>
    {(error || save.isError) && <p role="alert" className="form-error">{error || save.error?.message} 请刷新核对；影响范围变化后须重新预览确认。<button onClick={() => { setReview(null); void client.invalidateQueries({ queryKey: ['work'] }); }}>刷新任务</button></p>}
    <div className="assignment-actions">{owner && !stopped && task.status !== 'in_progress' && <button disabled={pending} onClick={() => send({ action: 'start_task', taskId: task.id, version: task.version })}>开始团队任务</button>}{owner && !stopped && <button disabled={pending} onClick={() => { void preview('complete_task'); }}>结束整体任务</button>}{(owner || manager) && !stopped && <button disabled={pending} onClick={() => { void preview('cancel_task'); }}>取消任务…</button>}</div>
    {review && <form className="request-card" onSubmit={(event) => { event.preventDefault(); send({ action: review.intent, taskId: task.id, version: review.version, confirmation: review.confirmation, ...(review.intent === 'cancel_task' ? { reason: String(new FormData(event.currentTarget).get('reason')) } : {}) }); }}><h4>{review.intent === 'complete_task' ? '确认整体结束' : '确认取消任务'}</h4><p>以下工作尚未完成。提交后停止该范围继续执行，成员个人状态和时间保留；允许本人整理及补记。</p><ul>{review.children.map((entry) => <li key={entry.id}>子任务：{entry.title}</li>)}{review.assignments.map((entry) => <li key={entry.id}>分工：{organization.accounts.find((account) => account.id === entry.accountId)?.displayName ?? '成员'} · {entry.content || '未填写内容'}</li>)}{review.personal.map((entry) => <li key={entry.id}>关联工作：{entry.title}</li>)}</ul>{review.hiddenPersonalCount > 0 && <p>另有 {review.hiddenPersonalCount} 条无权查看源内容的关联工作。</p>}{!review.children.length && !review.assignments.length && !review.personal.length && !review.hiddenPersonalCount && <p>没有未完成关联工作，仍由主负责人确认整体结果。</p>}{review.intent === 'cancel_task' && <label>取消原因<textarea name="reason" required maxLength={20000} /></label>}<button disabled={pending}>确认{review.intent === 'complete_task' ? '结束' : '取消'}</button><button type="button" onClick={() => setReview(null)}>返回</button></form>}
    {(owner || manager) && stopped && <details><summary>重开任务</summary><form onSubmit={(event) => { event.preventDefault(); send({ action: 'reopen_task', taskId: task.id, version: task.version, reason: String(new FormData(event.currentTarget).get('reason')) }); }}><label>重开原因<textarea name="reason" required maxLength={20000} /></label><p>保留首次开始及历史完成记录；不自动重开子任务或更改成员本人状态。</p><button disabled={pending}>确认重开</button></form></details>}
    {owner && !stopped && <details><summary>维护累计进度</summary><form onSubmit={(event) => { event.preventDefault(); send({ action: 'task_progress', taskId: task.id, version: task.version, progress: Number(new FormData(event.currentTarget).get('progress')) }); }}><label>累计百分比<input type="number" name="progress" min={0} max={100} required defaultValue={task.progress} /></label><small>填写100%也不会自动结束任务。</small><button disabled={pending}>保存进度</button></form></details>}
    {manager && <details><summary>更换任务主负责人</summary><form onSubmit={(event) => { event.preventDefault(); send({ action: 'change_owner', taskId: task.id, version: task.version, ownerId: String(new FormData(event.currentTarget).get('ownerId')) }); }}><label>主负责人<select name="ownerId" defaultValue={task.ownerId}>{organization.accounts.filter((account) => !account.disabled && project?.members.some((member) => member.accountId === account.id && member.roles.some((role) => role === 'developer' || role === 'project_lead'))).map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}</select></label><button disabled={pending}>保存责任身份，不生成分工</button></form></details>}
  </section>;
}
