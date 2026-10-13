import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Assignment, Identity, WorkSnapshot } from '@ntfs/contracts';
import { personalCommand } from '../personal/api';

/** 将本人分工带入个人空间；保留来源关联，不复制分工事实或自动开始。 */
export function AssignmentPersonal({ task, entry, identity }: { task: WorkSnapshot['tasks'][number]; entry: Assignment; identity: Identity }) {
  const client = useQueryClient();
  const operation = useRef<{ title: string; id: string } | null>(null);
  const [created, setCreated] = useState(false);
  const save = useMutation({ mutationFn: (title: string) => {
    if (operation.current?.title !== title) operation.current = { title, id: crypto.randomUUID() };
    return personalCommand({ action: 'create_personal', kind: 'work', projectId: task.projectId, assignmentId: entry.id, title, description: '', acceptance: '', categoryId: null, operationId: operation.current.id }, identity.csrfToken);
  }, onSuccess: async () => {
    setCreated(true);
    await Promise.all(['personal', 'assignments', 'work'].map((key) => client.invalidateQueries({ queryKey: [key] })));
  } });
  return <details><summary>带入个人空间</summary>
    {created ? <p role="status">已建立关联个人事项。<a href="/personal">进入个人空间</a>；未自动开始或复制分工进展。</p> : <form onSubmit={(event) => { event.preventDefault(); save.mutate(String(new FormData(event.currentTarget).get('title')).trim()); }}>
      <label>个人事项标题<input name="title" required maxLength={200} defaultValue={task.title} /></label>
      {entry.status === 'completed' && <p>新增未完成的关联工作将恢复本人分工为未完成。</p>}
      {save.isError && <p role="alert" className="form-error">{save.error.message}</p>}
      <button disabled={save.isPending}>建立关联个人事项</button>
    </form>}
  </details>;
}
