import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { v2StatusLabels, v2StatusSchema, v2TaskEditSchema, type V2ImpactIntent, type V2ProjectTaskInput, type V2Task, type V2TaskEdit } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { ModalPage, useModal } from './modal';
import { Feedback, Field, periodLabel, StatusBadge, useAction } from './controls';
import { PriorityField, TaskFields } from './task-fields';
import { Confirmation, Confirmations } from './confirmation';
import { readHistory } from './api';

/** 共用任务详情按真实权限开放字段，编辑期间不会用轮询结果覆盖草稿。 */
export function TaskEditor({ task, periodId, historicalStatus }: { task: V2Task; periodId?: string; historicalStatus?: string }) {
  const { data, user, run, notify } = useWorkspace(), modal = useModal(), action = useAction(), formId = useId();
  const project = data.projects.find((row) => row.id === task.projectId), manage = task.kind === 'private' || Boolean(project?.canManage), self = task.executorId === user.id;
  const canStatus = manage || self, canDelete = manage || (task.creatorId === user.id && task.status === 'not_started');
  const arrangements = data.arrangements.filter((row) => row.taskId === task.id);
  const firstArrangement = arrangements.find((row) => row.periodId === periodId) ?? arrangements[0];
  const [sourcePeriod, setSourcePeriod] = useState(firstArrangement?.periodId ?? '');
  const [draft, setDraft] = useState<V2ProjectTaskInput>({ projectId: task.projectId ?? '', title: task.title, priority: task.priority, executorId: task.executorId, milestoneId: task.milestoneId, periodId: firstArrangement?.periodId ?? '', plannedDays: firstArrangement?.plannedDays ?? null });
  const [status, setStatus] = useState(task.status);
  const [initialCategory] = useState(() => data.placements.find((row) => row.taskId === task.id)?.categoryId ?? '');
  const [categoryId, setCategoryId] = useState(initialCategory);
  const originalArrangement = arrangements.find((row) => row.periodId === sourcePeriod);
  const detailsChanged = draft.title !== task.title || draft.priority !== task.priority || draft.executorId !== task.executorId || draft.milestoneId !== task.milestoneId;
  const arrangementChanged = task.kind === 'project' && (draft.periodId !== sourcePeriod || draft.plannedDays !== (originalArrangement?.plannedDays ?? null));
  const dirty = detailsChanged || arrangementChanged || status !== task.status || categoryId !== initialCategory;
  const current = data.tasks.find((row) => row.id === task.id);
  const stale = !current || current.version !== task.version;

  async function save(confirmations: { arrangement?: string; milestone?: string } = {}) {
    const command: V2TaskEdit = { action: 'save_task', operationId: createOperationId(), taskId: task.id, version: task.version,
      ...(detailsChanged ? { details: task.kind === 'private' ? { kind: 'private', title: draft.title, priority: draft.priority } : { kind: 'project', title: draft.title, priority: draft.priority, executorId: draft.executorId, milestoneId: draft.milestoneId } } : {}),
      ...(status !== task.status ? { status } : {}), ...(draft.executorId === user.id && categoryId && categoryId !== initialCategory ? { categoryId } : {}),
      ...(confirmations.milestone ? { milestoneConfirmation: confirmations.milestone } : {}),
      ...(arrangementChanged && confirmations.arrangement ? { arrangement: { periodId: sourcePeriod, targetPeriodId: draft.periodId, plannedDays: draft.plannedDays, confirmation: confirmations.arrangement } } : {}),
    };
    const parsed = v2TaskEditSchema.safeParse(command); if (!parsed.success) throw new Error('请检查名称、执行人、日期和预计天数。');
    await run('edit', parsed.data);
    if (self && draft.executorId !== user.id) notify('已改派，该任务不再显示在我的工作中。');
    else if (status !== task.status) notify(`已改为${v2StatusLabels[status]}，列表按当前筛选更新。`);
  }
  function submit() {
    const intents: V2ImpactIntent[] = [];
    if (task.milestoneId && task.milestoneId !== draft.milestoneId) intents.push({ action: 'unlink_milestone', taskId: task.id, version: task.version });
    if (arrangementChanged) intents.push({ action: 'change_arrangement', taskId: task.id, version: task.version, periodId: sourcePeriod, targetPeriodId: draft.periodId });
    if (intents.length) modal.push(<Confirmations intents={intents} label="确认保存修改" onConfirm={(values) => save(Object.fromEntries(intents.map((intent, index) => [intent.action === 'unlink_milestone' ? 'milestone' : 'arrangement', values[index]])))} onDone={modal.finish} />);
    else void action.act(async () => { await save(); modal.finish(); });
  }
  function remove() { modal.push(<Confirmation intent={{ action: 'delete_task', taskId: task.id, version: task.version }} label="删除任务" danger onConfirm={(confirmation) => run('tasks', { action: 'delete', taskId: task.id, version: task.version, operationId: createOperationId(), confirmation })} onDone={modal.finish} />); }
  return <ModalPage title="任务详情" busy={action.busy} dirty={dirty} actions={<>
    {canDelete && <button className="v2-danger" disabled={action.busy || stale} onClick={remove}>删除任务</button>}
    {task.kind === 'project' && manage && <button disabled={arrangements.length <= 1 || stale || action.busy} title={arrangements.length <= 1 ? '至少保留一个日期区间，请改排到其他区间' : undefined} onClick={() => modal.push(<Confirmation intent={{ action: 'remove_arrangement', taskId: task.id, version: task.version, periodId: sourcePeriod }} label="取消此区间安排" onConfirm={(confirmation) => run('tasks', { action: 'remove_arrangement', taskId: task.id, version: task.version, periodId: sourcePeriod, operationId: createOperationId(), confirmation })} onDone={modal.finish} />)}>取消此区间安排</button>}
    {canStatus && <button className="nt-primary" type="submit" form={formId} disabled={action.busy || stale || !dirty}>保存</button>}
  </>}>
    <p className="v2-context">{task.kind === 'private' ? '个人 · 仅自己可见' : `项目：${project?.name ?? '项目'}`} · 创建人：{data.accounts.find((row) => row.id === task.creatorId)?.displayName ?? (self ? user.displayName : '历史成员')}</p>
    {historicalStatus && <p className="v2-context">区间结束时状态：{historicalStatus}；下方维护当前任务。</p>}
    {stale && <p className="v2-error" role="alert">任务已更新或删除。已保留你的输入，请关闭后重新打开核对。</p>}
    <form id={formId} onSubmit={(event) => { event.preventDefault(); submit(); }}><fieldset disabled={action.busy || stale}>
      {task.kind === 'project' && manage ? <>
        {arrangements.length > 1 && <Field label="当前编辑的安排"><select value={sourcePeriod} onChange={(event) => { const row = arrangements.find((item) => item.periodId === event.target.value); if (row) { setSourcePeriod(row.periodId); setDraft((previous) => ({ ...previous, periodId: row.periodId, plannedDays: row.plannedDays })); } }}>{arrangements.map((row) => { const period = data.periods.find((item) => item.id === row.periodId); return <option key={row.periodId} value={row.periodId}>{period ? periodLabel(period) : row.periodId}</option>; })}</select></Field>}
        <TaskFields value={draft} onChange={setDraft} data={data} selfId={user.id} showDays={Boolean(periodId)} />
      </> : task.kind === 'private' ? <div className="v2-fields"><Field label="任务名称" full><input required maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field><PriorityField value={draft.priority} onChange={(priority) => setDraft({ ...draft, priority })} /></div> : <dl className="v2-facts"><dt>任务名称</dt><dd>{task.title}</dd><dt>执行人</dt><dd>{data.accounts.find((row) => row.id === task.executorId)?.displayName ?? '历史成员'}</dd><dt>优先级</dt><dd>{task.priority}</dd><dt>日期区间</dt><dd>{arrangements.map((row) => { const period = data.periods.find((item) => item.id === row.periodId); return <div key={row.periodId}>{period ? periodLabel(period) : '区间不存在'}</div>; })}</dd><dt>关联里程碑</dt><dd>{data.milestones.find((row) => row.id === task.milestoneId)?.title ?? '未关联里程碑'}</dd></dl>}
      <div className="v2-fields"><Field label="当前执行状态">{canStatus ? <select value={status} onChange={(event) => { const next = v2StatusSchema.parse(event.target.value); setStatus(next); if (self && next !== status) setCategoryId(data.categories.find((row) => row.status === next && row.isDefault)?.id ?? ''); }}>{v2StatusSchema.options.map((value) => <option key={value} value={value}>{v2StatusLabels[value]}</option>)}</select> : <StatusBadge status={task.status} />}</Field>
        {self && draft.executorId === user.id && <Field label="个人分类"><select value={categoryId} onChange={(event) => { const row = data.categories.find((item) => item.id === event.target.value); if (row) { setCategoryId(row.id); setStatus(row.status); } }}>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>}
      </div>
      {task.kind === 'project' && !manage && <p className="v2-context">名称、执行人、日期、优先级和里程碑由团队负责人或项目研发负责人维护。</p>}
      {task.kind === 'project' && manage && arrangements.length <= 1 && <p className="v2-context">至少保留一个日期区间；需要调整时间时可直接改排。</p>}
      <Feedback error={action.error} />
    </fieldset></form>
    <button className="nt-link" onClick={() => modal.push(<TaskHistory taskId={task.id} />)}>操作历史</button>
  </ModalPage>;
}

/** 不可变事件显示当时名称和实际操作者，缺证据明确标示。 */
export function TaskHistory({ taskId }: { taskId: string }) {
  const query = useQuery({ queryKey: ['v2', 'history', taskId], queryFn: () => readHistory(taskId) });
  return <ModalPage title="任务历史">{query.isPending ? <p>正在读取…</p> : query.error ? <Feedback error={query.error.message} /> : <ol className="v2-history">{query.data?.slice().reverse().map((event) => <li key={event.id}><strong>{event.snapshot.title}</strong><p>{new Date(event.occurredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} · {event.actorName ?? '历史操作者'} · {event.action === 'migrated' ? '迁移保留，早期事实可能不完整' : event.action === 'deleted' ? '删除任务' : v2StatusLabels[event.snapshot.status]}</p><small>执行人：{event.executorName ?? '历史姓名不可还原'}</small></li>)}</ol>}</ModalPage>;
}
