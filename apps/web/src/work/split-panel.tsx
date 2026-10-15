import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorSchema, splitCommandSchema } from '@ntfs/contracts';
import type { Identity, OrganizationSnapshot, SplitCommand, WorkSnapshot } from '@ntfs/contracts';
import { assignmentSnapshot } from './assignments-api';

/** 显式列出子任务和分工去向，失败时保留输入，不做乐观迁移。 */
export function SplitPanel({ task, identity, organization }: { task: WorkSnapshot['tasks'][number]; identity: Identity; organization: OrganizationSnapshot }) {
  const client = useQueryClient();
  const state = useQuery({ queryKey: ['assignments', identity.id, task.projectId], queryFn: () => assignmentSnapshot(task.projectId), retry: false });
  const [children, setChildren] = useState<SplitCommand['children']>(() => [{ key: crypto.randomUUID(), title: '', description: '', acceptance: '' }]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const operation = useRef<{ content: string; id: string } | null>(null);
  const moves = state.data?.assignments.filter((entry) => entry.taskId === task.id && !['exited', 'transferred'].includes(entry.status)) ?? [];
  const save = useMutation({
    mutationFn: async (command: SplitCommand) => {
      const response = await fetch('/api/v1/tasks/split', { method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': identity.csrfToken }, body: JSON.stringify(command) });
      if (!response.ok) { const parsed = apiErrorSchema.safeParse(await response.json()); throw new Error(parsed.success ? parsed.data.message : '拆分失败，请重试。'); }
    },
    onSuccess: async () => {
      operation.current = null; setNotice('子任务已建立，分工及个人关联已同步迁移，历史保持原记录。');
      setChildren([{ key: crypto.randomUUID(), title: '', description: '', acceptance: '' }]);
      await Promise.all(['work', 'assignments', 'personal'].map((key) => client.invalidateQueries({ queryKey: [key] })));
    },
  });
  function edit(key: string, field: 'title' | 'description' | 'acceptance', value: string) { setChildren(children.map((child) => child.key === key ? { ...child, [field]: value } : child)); }
  return <details className="request-card"><summary>创建子任务并迁移安排</summary><p>只允许一层子任务，默认继承当前主负责人。有效分工须全部迁移到子任务；迁移另需对应小组的安排权限。分工状态、实际时间和个人内容保持原样。</p>
    {(error || save.isError || state.isError) && <p role="alert" className="form-error">{error || save.error?.message || state.error?.message}<button onClick={() => { void state.refetch(); void client.invalidateQueries({ queryKey: ['work'] }); }}>刷新范围</button></p>}{notice && <p role="status">{notice}</p>}
    <form onSubmit={(event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      const parsed = splitCommandSchema.safeParse({ taskId: task.id, version: task.version, operationId: crypto.randomUUID(), children, moves: moves.map((entry) => ({ assignmentId: entry.id, version: entry.version, childKey: String(form.get(entry.id)) })) });
      if (!parsed.success) { setError('请填写子任务标题，并为每条分工选择有效去向。'); return; }
      const command = parsed.data; const content = JSON.stringify({ ...command, operationId: '' });
      if (operation.current?.content !== content) operation.current = { content, id: crypto.randomUUID() };
      command.operationId = operation.current.id; setError(''); setNotice(''); save.mutate(command);
    }}><fieldset disabled={save.isPending || !state.data || state.isError}>
      {children.map((child, index) => <fieldset key={child.key}><legend>子任务 {index + 1}</legend><label>标题<input required maxLength={200} value={child.title} onChange={(event) => edit(child.key, 'title', event.target.value)} /></label><label>说明（选填）<textarea maxLength={20000} value={child.description} onChange={(event) => edit(child.key, 'description', event.target.value)} /></label><label>完成标准（选填）<textarea maxLength={20000} value={child.acceptance} onChange={(event) => edit(child.key, 'acceptance', event.target.value)} /></label>{children.length > 1 && <button type="button" onClick={() => setChildren(children.filter((entry) => entry.key !== child.key))}>移除此草稿子任务</button>}</fieldset>)}
      <button type="button" disabled={children.length >= 20} onClick={() => setChildren([...children, { key: crypto.randomUUID(), title: '', description: '', acceptance: '' }])}>增加子任务</button>
      <h4>当前有效分工去向</h4>{moves.length === 0 ? <p>没有需迁移的有效分工。</p> : moves.map((entry) => <label key={entry.id}>{organization.accounts.find((account) => account.id === entry.accountId)?.displayName ?? '成员'} · {organization.groups.find((group) => group.id === entry.groupId)?.name ?? '团队直属'} · {entry.content || '未填写内容'}<select name={entry.id} required defaultValue=""><option value="">请选择目标子任务</option>{children.map((child, index) => <option key={child.key} value={child.key}>{child.title || `子任务 ${index + 1}`}</option>)}</select></label>)}
      <button>确认创建并迁移</button>
    </fieldset></form>
  </details>;
}
