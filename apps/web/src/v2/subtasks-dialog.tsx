import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { v2SubtaskInputSchema, type V2SubtaskInput, type V2Subtasks, type V2Task } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { readSubtasks } from './api';
import { ModalPage, useModal } from './modal';
import { useWorkspace } from './workspace';
import { Feedback, useAction } from './controls';
import { usePrivateListSort } from './private-list-sort';

/** 子任务按当前用户和主任务查询，加载失败不允许保存空清单覆盖已有数据。 */
export function SubtasksDialog({ task }: { task: V2Task }) {
  const { user } = useWorkspace();
  const query = useQuery({ queryKey: ['v2', 'subtasks', user.id, task.id], queryFn: () => readSubtasks(task.id), refetchInterval: 10000 });
  if (!query.data) return <ModalPage title="子任务"><Feedback error={query.error?.message ?? ''} /><p>{query.error ? '无法读取子任务。' : '正在读取子任务…'}</p></ModalPage>;
  return <SubtasksContent task={task} incoming={query.data} readError={query.error?.message ?? ''} />;
}

/** 增删改、勾选及拖拽都维护同一份草稿，统一保存并保护轮询期间的输入。 */
function SubtasksContent({ task, incoming, readError }: { task: V2Task; incoming: V2Subtasks; readError: string }) {
  const { data, user, run } = useWorkspace(), modal = useModal(), action = useAction();
  const [initial] = useState(incoming), [items, setItems] = useState<V2SubtaskInput[]>(incoming.items.map(({ id, title, completed }) => ({ id, title, completed })));
  const [title, setTitle] = useState(''), [editing, setEditing] = useState<string | null>(null), [error, setError] = useState('');
  const original = initial.items.map(({ id, title, completed }) => ({ id, title, completed }));
  const dirty = JSON.stringify(items) !== JSON.stringify(original) || Boolean(title.trim());
  const current = data.tasks.find((row) => row.id === task.id), stale = incoming.version !== initial.version || !current || current.executorId !== user.id;
  const blocked = stale || action.busy || Boolean(readError);
  const sort = usePrivateListSort(items.map((row) => row.id), (ids) => setItems(ids.flatMap((id) => items.filter((row) => row.id === id))), blocked);

  function add() {
    const parsed = v2SubtaskInputSchema.safeParse({ id: createOperationId(), title, completed: false });
    if (!parsed.success) { setError('请填写不超过200字的子任务名称。'); return; }
    if (items.length >= 200) { setError('每个任务最多200条子任务。'); return; }
    setItems([...items, parsed.data]); setTitle(''); setError('');
  }
  function remove(item: V2SubtaskInput) {
    modal.push(<ConfirmSubtaskDelete item={item} onConfirm={() => { setItems((rows) => rows.filter((row) => row.id !== item.id)); setEditing(null); }} />);
  }
  async function save() {
    if (title.trim()) { setError('请先添加输入的子任务，或清空输入后保存。'); return; }
    const parsed = v2SubtaskInputSchema.array().safeParse(items);
    if (!parsed.success) { setError('子任务名称不能为空，且不能超过200字。'); return; }
    await run('subtasks', { action: 'save_subtasks', operationId: createOperationId(), taskId: task.id, version: initial.version, items: parsed.data, removedIds: initial.items.filter((item) => !items.some((row) => row.id === item.id)).map((item) => item.id) });
    modal.finish();
  }
  return <ModalPage title="子任务" subtitle="仅自己可见" dirty={dirty} busy={action.busy} actions={<button className="nt-primary" disabled={blocked || !dirty} onClick={() => { void action.act(save); }}>保存</button>}>
    <p className="v2-context">{current?.title ?? task.title}</p><div className="v2-private-list-summary">已完成 {items.filter((row) => row.completed).length} / {items.length}</div>
    {stale && <Feedback error="任务归属或子任务清单已变化。已保留你的输入，请重新打开核对。" />}
    <Feedback error={readError || action.error || error} />
    <div ref={sort.root} className="v2-private-list" {...sort.listProps}>{items.map((item) => <div key={item.id} data-sort-id={item.id} className={`v2-private-row v2-subtask-row ${item.completed ? 'is-completed' : ''}`}>
      {sort.handle(item.id, item.title)}<input type="checkbox" aria-label={`完成子任务：${item.title}`} checked={item.completed} disabled={blocked} onChange={(event) => setItems(items.map((row) => row.id === item.id ? { ...row, completed: event.target.checked } : row))} />
      <div className="v2-private-name">{editing === item.id ? <input aria-label="子任务名称" maxLength={200} value={item.title} disabled={blocked} onChange={(event) => setItems(items.map((row) => row.id === item.id ? { ...row, title: event.target.value } : row))} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); setEditing(null); } }} /> : <span>{item.title}</span>}</div>
      <button className="v2-private-action" disabled={blocked} onClick={() => setEditing(editing === item.id ? null : item.id)}>{editing === item.id ? '确定' : '编辑'}</button><button className="v2-private-action is-danger" disabled={blocked} onClick={() => remove(item)}>删除</button>
    </div>)}{items.length === 0 && <p className="v2-context">暂无子任务</p>}</div>
    <div className="v2-private-add"><input aria-label="新增子任务名称" placeholder="输入子任务名称" value={title} maxLength={200} disabled={blocked} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} /><button disabled={blocked} onClick={add}>添加</button></div>
  </ModalPage>;
}

/** 确认页使用自身的返回栈位置，只移除草稿项，不触发父清单的未保存退出。 */
function ConfirmSubtaskDelete({ item, onConfirm }: { item: V2SubtaskInput; onConfirm: () => void }) {
  const modal = useModal();
  return <ModalPage title="删除子任务" actions={<button className="v2-danger" onClick={() => { onConfirm(); modal.finish(); }}>确认删除</button>}><p>确认删除“{item.title}”？</p><p className="v2-context">不改变主任务状态，历史日报保留当时的完成记录。返回清单保存后生效。</p></ModalPage>;
}
