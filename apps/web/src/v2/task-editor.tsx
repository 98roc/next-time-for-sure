import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { v2AiContributionLabels, v2StatusLabels, v2StatusSchema, v2TaskEditSchema, type V2ImpactIntent, type V2ProjectTaskInput, type V2Task, type V2TaskEdit } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { ModalPage, useModal } from './modal';
import { Feedback, Field, StatusBadge, useAction } from './controls';
import { PriorityField, TaskFields } from './task-fields';
import { Confirmation, Confirmations } from './confirmation';
import { readHistory } from './api';
import { TaskArrangements } from './task-arrangements';
import { taskCompletion, TaskResultFields } from './task-results';
import { orderArrangements } from './arrangement-order';

/** 共用详情分离任务字段、周期安排及完成结果，权限按字段执行，整份草稿一次保存。 */
export function TaskEditor({ task, historicalStatus }: { task: V2Task; historicalStatus?: string }) {
  const { data, user, run, notify } = useWorkspace(), modal = useModal(), action = useAction(), formId = useId();
  const project = data.projects.find((row) => row.id === task.projectId), manage = task.kind === 'private' || Boolean(project?.canManage), self = task.executorId === user.id;
  const canStatus = manage || self, canDelete = manage || (task.creatorId === user.id && task.status === 'not_started');
  const [originalArrangements] = useState(() => orderArrangements(data.arrangements.filter((row) => row.taskId === task.id).map(({ periodId, plannedDays }) => ({ periodId, plannedDays })), data.periods));
  const [arrangements, setArrangements] = useState(originalArrangements);
  const [draft, setDraft] = useState<V2ProjectTaskInput>({ projectId: task.projectId ?? '', title: task.title, priority: task.priority, executorId: task.executorId, milestoneId: task.milestoneId, periodId: originalArrangements[0]?.periodId ?? '', plannedDays: originalArrangements[0]?.plannedDays ?? null });
  const [status, setStatus] = useState(task.status), [completion, setCompletion] = useState(() => taskCompletion(task));
  const [initialCategory] = useState(() => data.placements.find((row) => row.taskId === task.id)?.categoryId ?? '');
  const [categoryId, setCategoryId] = useState(initialCategory);
  const detailsChanged = draft.title !== task.title || draft.priority !== task.priority || draft.executorId !== task.executorId || draft.milestoneId !== task.milestoneId;
  const arrangementsChanged = task.kind === 'project' && JSON.stringify(arrangements) !== JSON.stringify(originalArrangements);
  const periodsChanged = arrangements.length !== originalArrangements.length || originalArrangements.some((row) => !arrangements.some((item) => item.periodId === row.periodId));
  const completionChanged = completion.actualDays !== (task.actualDays ?? null) || completion.aiContribution !== (task.aiContribution ?? null);
  const dirty = detailsChanged || arrangementsChanged || completionChanged || status !== task.status || categoryId !== initialCategory;
  const current = data.tasks.find((row) => row.id === task.id), stale = !current || current.version !== task.version;
  // 历史空结果只在本次完成或编辑结果时要求补齐，改名称不会触发历史补录。
  const requireResults = status === 'completed' && (task.status !== 'completed' || completionChanged);

  function changeStatus(next: V2Task['status']) {
    setStatus(next);
    if (next === 'completed' && task.kind === 'project' && status !== 'completed') setCompletion((value) => ({ ...value, aiContribution: value.aiContribution ?? 'high' }));
  }
  async function save(confirmations: { arrangement?: string; milestone?: string } = {}) {
    const command: V2TaskEdit = { action: 'save_task', operationId: createOperationId(), taskId: task.id, version: task.version,
      ...(detailsChanged ? { details: task.kind === 'private' ? { kind: 'private', title: draft.title, priority: draft.priority } : { kind: 'project', title: draft.title, priority: draft.priority, executorId: draft.executorId, milestoneId: draft.milestoneId } } : {}),
      ...(status !== task.status ? { status } : {}), ...(draft.executorId === user.id && categoryId && categoryId !== initialCategory ? { categoryId } : {}),
      ...(confirmations.milestone ? { milestoneConfirmation: confirmations.milestone } : {}),
      ...(arrangementsChanged ? { arrangements, ...(confirmations.arrangement ? { arrangementConfirmation: confirmations.arrangement } : {}) } : {}),
      ...(task.kind === 'project' && (completionChanged || requireResults) ? { completion } : {}),
    };
    const parsed = v2TaskEditSchema.safeParse(command); if (!parsed.success) throw new Error('请检查任务字段、周期安排及投入数值。');
    await run('edit', parsed.data);
    notify(self && draft.executorId !== user.id ? '已改派，该任务不再显示在我的工作中。' : '任务已保存。');
  }
  function submit() {
    const intents: V2ImpactIntent[] = [];
    if (task.milestoneId && task.milestoneId !== draft.milestoneId) intents.push({ action: 'unlink_milestone', taskId: task.id, version: task.version });
    if (periodsChanged) intents.push({ action: 'save_arrangements', taskId: task.id, version: task.version, arrangements });
    if (intents.length) modal.push(<Confirmations intents={intents} label="确认保存修改" onConfirm={(values) => save(Object.fromEntries(intents.map((intent, index) => [intent.action === 'unlink_milestone' ? 'milestone' : 'arrangement', values[index]])))} onDone={modal.finish} />);
    else void action.act(async () => { await save(); modal.finish(); });
  }
  function remove() { modal.push(<Confirmation intent={{ action: 'delete_task', taskId: task.id, version: task.version }} label="删除任务" danger onConfirm={(confirmation) => run('tasks', { action: 'delete', taskId: task.id, version: task.version, operationId: createOperationId(), confirmation })} onDone={modal.finish} />); }
  const statusFields = <><Field label="当前执行状态">{canStatus ? <select value={status} onChange={(event) => { const next = v2StatusSchema.parse(event.target.value); changeStatus(next); if (self && next !== status) setCategoryId(data.categories.find((row) => row.status === next && row.isDefault)?.id ?? ''); }}>{v2StatusSchema.options.map((value) => <option key={value} value={value}>{v2StatusLabels[value]}</option>)}</select> : <StatusBadge status={task.status} />}</Field>
    {self && draft.executorId === user.id && <Field label="个人分类"><select value={categoryId} onChange={(event) => { const row = data.categories.find((item) => item.id === event.target.value); if (row) { setCategoryId(row.id); changeStatus(row.status); } }}>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>}</>;
  return <ModalPage title="任务详情" busy={action.busy} dirty={dirty} actions={<>
    {canDelete && <button className="v2-danger" disabled={action.busy || stale} onClick={remove}>删除任务</button>}
    {canStatus && <button className="nt-primary" type="submit" form={formId} disabled={action.busy || stale || !dirty}>保存</button>}
  </>}>
    {stale && <p className="v2-error" role="alert">任务已更新或删除。已保留你的输入，请关闭后重新打开核对。</p>}
    <form id={formId} onSubmit={(event) => { event.preventDefault(); submit(); }}><fieldset disabled={action.busy || stale}>
      {task.kind === 'project' && manage ? <TaskFields value={draft} onChange={setDraft} data={data} selfId={user.id} showArrangement={false} originalMilestoneId={task.milestoneId}>{statusFields}</TaskFields> : task.kind === 'private' ? <div className="v2-fields"><Field label="任务名称" full><input required maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field><PriorityField value={draft.priority} onChange={(priority) => setDraft({ ...draft, priority })} />{statusFields}</div> : <><dl className="v2-facts"><dt>任务名称</dt><dd>{task.title}</dd><dt>执行人</dt><dd>{data.accounts.find((row) => row.id === task.executorId)?.displayName ?? '历史成员'}</dd><dt>优先级</dt><dd>{task.priority}</dd></dl><div className="v2-fields">{statusFields}<Field label="关联里程碑" full><input readOnly value={data.milestones.find((row) => row.id === task.milestoneId)?.title ?? '不关联里程碑'} /></Field></div></>}
      {historicalStatus && <small className="nt-muted">区间结束时：{historicalStatus}</small>}
      {task.kind === 'project' && <><TaskArrangements value={arrangements} onChange={setArrangements} periods={data.periods} canSchedule={manage} canEstimate={canStatus} />{status === 'completed' && <section className="v2-task-section"><div className="v2-section-head"><h3>完成结果</h3></div><TaskResultFields value={completion} onChange={setCompletion} required={requireResults} disabled={!canStatus} /></section>}</>}
      <Feedback error={action.error} />
    </fieldset></form>
    <div className="v2-task-meta"><span>{task.kind === 'private' ? '个人 · 仅自己可见' : `项目：${project?.name ?? '项目'}`} · 创建人：{data.accounts.find((row) => row.id === task.creatorId)?.displayName ?? (self ? user.displayName : '历史成员')}</span><button className="nt-link" onClick={() => modal.push(<TaskHistory taskId={task.id} />)}>操作历史</button></div>
  </ModalPage>;
}

/** 不可变事件显示当时结果及实际操作者，不拿现值回填历史。 */
export function TaskHistory({ taskId }: { taskId: string }) {
  const query = useQuery({ queryKey: ['v2', 'history', taskId], queryFn: () => readHistory(taskId) });
  return <ModalPage title="任务历史">{query.isPending ? <p>正在读取…</p> : query.error ? <Feedback error={query.error.message} /> : <ol className="v2-history">{query.data?.slice().reverse().map((event) => <li key={event.id}><strong>{event.snapshot.title}</strong><p>{new Date(event.occurredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} · {event.actorName ?? '历史操作者'} · {event.action === 'migrated' ? '迁移保留，早期事实可能不完整' : event.action === 'deleted' ? '删除任务' : v2StatusLabels[event.snapshot.status]}</p><small>执行人：{event.executorName ?? '历史姓名不可还原'}</small>{event.snapshot.kind === 'project' && (event.snapshot.actualDays != null || event.snapshot.aiContribution != null) && <p>累计实际投入：{event.snapshot.actualDays ?? '未填写'} 人天 · AI贡献率：{event.snapshot.aiContribution ? v2AiContributionLabels[event.snapshot.aiContribution] : '未填写'}</p>}</li>)}</ol>}</ModalPage>;
}
