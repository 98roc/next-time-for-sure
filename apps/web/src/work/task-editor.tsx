import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Identity, WorkSnapshot } from '@ntfs/contracts';
import { milestoneCommand } from './milestones-api';

/** 任务详情内容编辑入口；权限和并发版本仍由后端校验。 */
export function TaskEditor({ task, identity }: { task: WorkSnapshot['tasks'][number]; identity: Identity }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const save = useMutation({
    mutationFn: (fields: { title: string; description: string; acceptance: string }) => milestoneCommand({ action: 'edit_task', taskId: task.id, version: task.version, ...fields }, identity.csrfToken),
    onSuccess: async () => { setEditing(false); await Promise.all(['work', 'weekly', 'reports'].map((key) => client.invalidateQueries({ queryKey: [key] }))); },
  });
  if (task.ownerId !== identity.id) return null;
  return <div className="task-content-editor"><button aria-expanded={editing} disabled={save.isPending} onClick={() => setEditing(!editing)}>{editing ? '收起编辑' : '编辑任务内容'}</button>{editing && <>
    {save.isError && <p role="alert" className="form-error">{save.error.message}</p>}
    <form onSubmit={(event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      save.mutate({ title: String(form.get('title')), description: String(form.get('description')), acceptance: String(form.get('acceptance')) });
    }}><fieldset disabled={save.isPending}>
      <label>标题<input name="title" required maxLength={200} defaultValue={task.title} /></label>
      <label>说明<textarea name="description" maxLength={20000} defaultValue={task.description} /></label>
      <label>完成标准<textarea name="acceptance" maxLength={20000} defaultValue={task.acceptance} /></label>
      <button>保存任务内容</button>
    </fieldset></form>
  </>}</div>;
}
