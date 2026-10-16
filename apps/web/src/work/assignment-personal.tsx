import { createOperationId } from '../identity/operation-id';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Assignment, Identity, WorkSnapshot } from '@ntfs/contracts';
import { personalCommand, personalSnapshot } from '../personal/api';

/** 团队详情与个人看板共用幂等加入，重复进入只定位已有事项。 */
export function AssignmentPersonal({ entry, identity }: { task: WorkSnapshot['tasks'][number]; entry: Assignment; identity: Identity }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const operation = useRef<{ category: string; id: string } | null>(null);
  const personal = useQuery({ queryKey: ['personal', identity.id, 'mine'], queryFn: () => personalSnapshot('mine'), enabled: open });
  const status = entry.status === 'completed' ? 'completed' : entry.status === 'in_progress' ? 'in_progress' : 'not_started';
  const categories = personal.data?.categories.filter((category) => category.status === status) ?? [];
  const linked = personal.data?.items.filter((item) => item.assignmentId === entry.id) ?? [];
  const save = useMutation({ mutationFn: (category: string) => {
    if (operation.current?.category !== category) operation.current = { category, id: createOperationId() };
    return personalCommand({ action: 'import_assignment', assignmentId: entry.id, categoryId: category, split: false, operationId: operation.current.id }, identity.csrfToken);
  }, onSuccess: async () => { operation.current = null; await Promise.all(['personal', 'assignments', 'work'].map((key) => client.invalidateQueries({ queryKey: [key] }))); } });
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}><summary>加入我的工作</summary>
    {linked.length ? <p>已加入 {linked.length} 项。<a href="/personal">去我的工作继续安排与拆分 →</a></p> : <form onSubmit={(event) => { event.preventDefault(); const id = categories.length === 1 ? categories[0]?.id : String(new FormData(event.currentTarget).get('category')); if (id) save.mutate(id); }}>
      {categories.length > 1 && <label>放入分类<select name="category" required defaultValue=""><option value="" disabled>请选择分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>}
      {(save.isError || personal.isError) && <p role="alert">{save.error?.message || personal.error?.message}</p>}
      <button disabled={save.isPending || !categories.length}>加入我的工作</button>
    </form>}
  </details>;
}
