import { useId, useState } from 'react';
import type { V2Milestone } from '@ntfs/contracts';
import { v2StatusLabels } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { ModalPage, useModal } from './modal';
import { Feedback, Field, useAction } from './controls';
import { Confirmation } from './confirmation';
import { MilestoneTaskIcon } from './milestone-parts';

/** 名称、日期、解除关联均为本地草稿；确认后以原版本一次提交，取消不改任务。 */
export function MilestoneForm({ projectId, milestone, focusDate = false }: { projectId: string; milestone?: V2Milestone; focusDate?: boolean }) {
  const { data, run } = useWorkspace(), modal = useModal(), action = useAction(), id = useId();
  const [title, setTitle] = useState(milestone?.title ?? ''), [date, setDate] = useState(milestone?.expectedOn ?? '');
  const [tasks] = useState(() => data.tasks.filter((row) => milestone && row.milestoneId === milestone.id));
  const [removed, setRemoved] = useState<string[]>([]);
  const dirty = title !== (milestone?.title ?? '') || date !== (milestone?.expectedOn ?? '') || removed.length > 0;
  const project = data.projects.find((row) => row.id === projectId);

  async function submit() {
    const fields = { title: title.trim(), expectedOn: date || null };
    if (milestone) {
      const intent = { action: 'edit_milestone' as const, milestoneId: milestone.id, version: milestone.version, ...fields, unlinkTasks: tasks.filter((row) => removed.includes(row.id)).map((row) => ({ taskId: row.id, version: row.version })) };
      if (date !== (milestone.expectedOn ?? '') || removed.length) {
        modal.push(<Confirmation label="保存目标变更" intent={intent} onConfirm={(confirmation) => run('projects', { ...intent, operationId: createOperationId(), confirmation })} onDone={() => modal.finish()} />);
        return;
      }
      await run('projects', { ...intent, operationId: createOperationId() });
    } else await run('projects', { ...fields, action: 'create_milestone', projectId, operationId: createOperationId() });
    modal.finish();
  }

  return <ModalPage title={`${project?.name ?? ''} / ${milestone ? '编辑目标' : '新增目标'}`} className="v2-ms-modal" closeLabel="关闭" dirty={dirty} busy={action.busy} hideCloseAction onClose={() => modal.back()} actions={<><button disabled={action.busy} onClick={() => modal.back()}>取消</button><button type="submit" form={id} className="nt-primary" disabled={action.busy || !title.trim() || Boolean(milestone && !dirty)}>保存</button></>}>
    <form id={id} className="v2-ms-form" onSubmit={(event) => { event.preventDefault(); void action.act(submit); }}><fieldset disabled={action.busy}>
      <div className="v2-fields"><Field label="目标名称" full><input required value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></Field><Field label="截止日期 · 可选" full><input type="date" autoFocus={focusDate} data-v2-autofocus={focusDate ? true : undefined} value={date} onChange={(event) => setDate(event.target.value)} /></Field></div>
      {milestone && <section className="v2-ms-edit-tasks"><div className="v2-ms-heading"><h3 className="v2-ms-section-title">关联任务</h3><span>{removed.length ? `待解除 ${removed.length} 项` : `${tasks.length} 项`}</span></div><ul className="v2-ms-tasks">{tasks.map((task) => {
        const unlink = removed.includes(task.id);
        return <li key={task.id} className={unlink ? 'is-removed' : undefined}><MilestoneTaskIcon status={task.status} /><div><span>{task.title}</span><small>{unlink ? '待解除关联 · 保存后生效' : `${v2StatusLabels[task.status]} · ${data.accounts.find((row) => row.id === task.executorId)?.displayName ?? '历史成员'}`}</small></div><button type="button" aria-label={`${unlink ? '恢复关联' : '解除关联'}：${task.title}`} onClick={() => setRemoved(unlink ? removed.filter((item) => item !== task.id) : [...removed, task.id])}>{unlink ? '恢复关联' : '解除关联'}</button></li>;
      })}</ul>{!tasks.length && <p className="v2-ms-empty">暂无关联任务</p>}</section>}
      <Feedback error={action.error} />
    </fieldset></form>
  </ModalPage>;
}
