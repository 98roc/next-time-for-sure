import { TaskRemark } from './task-remark';
import { useId, useState } from 'react';
import { v2TaskCommandSchema, type V2Completion, type V2ProjectTaskInput } from '@ntfs/contracts';
import { TaskCompletion } from './task-results';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { ModalPage, useModal } from './modal';
import { currentPeriod, Feedback, Field, useAction } from './controls';
import { PriorityField, TaskFields } from './task-fields';
import { otherTaskSource, taskSourceProjects, TaskCreateSource } from './task-create-source';

/** 单条新建、批量新建和待建转换复用核心字段，入口只提供默认项目与日期。 */
export function TaskCreate({ projectId, periodId, personal = false, batch = false, backlog, onDone }: { projectId?: string; periodId?: string; personal?: boolean; batch?: boolean; backlog?: { id: string; version: number; title: string; priority: number; creatorId: string }; onDone?: () => void }) {
  const { data, user, run, notify } = useWorkspace(), modal = useModal(), action = useAction(), formId = useId();
  const initialProject = projectId ?? (personal ? 'private' : data.projects.find((row) => row.canCreate)?.id ?? '');
  const [source, setSource] = useState(initialProject);
  const forOthers = personal && source === otherTaskSource;
  const personalPlacement = personal && !forOthers;
  const projects = taskSourceProjects(data, user);
  const [categoryId, setCategoryId] = useState(data.categories.find((row) => row.status === 'not_started' && row.isDefault)?.id ?? '');
  const makeRow = (): V2ProjectTaskInput => ({ projectId: initialProject, title: backlog?.title ?? '', priority: backlog?.priority ?? 3, executorId: user.isSuperAdmin || data.projects.find((row) => row.id === initialProject)?.members.some((row) => row.accountId === user.id) ? user.id : '', periodId: periodId ?? currentPeriod(data.periods, data.today), plannedDays: null, milestoneId: null });
  const [rows, setRows] = useState(() => [{ key: createOperationId(), value: makeRow() }]);
  const [initial] = useState(() => JSON.stringify({ source, categoryId, rows }));
  const dirty = JSON.stringify({ source, categoryId, rows }) !== initial;

  /** 更换来源或项目时清除跨项目执行人和里程碑，保留已经输入的任务内容。 */
  function changeProject(id: string, others: boolean) {
    setRows((previous) => previous.map((row) => ({ ...row, value: { ...row.value, projectId: id, executorId: others ? '' : user.id, milestoneId: null } })));
  }
  function changeSource(value: string) {
    setSource(value);
    changeProject(value === otherTaskSource ? projects.others[0]?.id ?? '' : value, value === otherTaskSource);
  }

  async function save(completion?: V2Completion) {
    const first = rows[0]?.value;
    if (!first) throw new Error('请至少填写一条任务。');
    if (forOthers && (!projects.others.some((project) => project.id === first.projectId) || !first.executorId || first.executorId === user.id)) throw new Error('请选择有安排权限的项目和其他执行人。');
    if (backlog) {
      await run('projects', { action: 'convert_backlog', operationId: createOperationId(), backlogId: backlog.id, version: backlog.version, task: first });
    } else {
      const candidate = source === 'private' ? { action: 'create_private', operationId: createOperationId(), task: { title: first.title, priority: first.priority, remark: first.remark, categoryId } } : batch ? { action: 'create_batch', operationId: createOperationId(), tasks: rows.map((row) => row.value) } : { action: 'create_project', operationId: createOperationId(), task: { ...first, ...(completion ? { completion } : {}) }, ...(personalPlacement ? { categoryId } : {}) };
      const parsed = v2TaskCommandSchema.safeParse(candidate);
      if (!parsed.success) throw new Error('请检查任务名称、执行人、日期区间和预计天数。');
      await run('tasks', parsed.data);
    }
  }
  function finish() { if (onDone) onDone(); else modal.finish(); if (forOthers) notify('操作成功'); }
  function submit() {
    const first = rows[0]?.value;
    if (first && source !== 'private' && personalPlacement && data.categories.find((row) => row.id === categoryId)?.status === 'completed') {
      modal.push(<TaskCompletion title={first.title} arrangements={[{ periodId: first.periodId, plannedDays: first.plannedDays }, ...(first.additionalArrangements ?? [])]} onConfirm={save} onDone={finish} />);
    } else void action.act(async () => { await save(); finish(); });
  }
  return <ModalPage title={backlog ? '转为正式任务' : batch ? '批量新增任务' : '新建任务'} busy={action.busy} dirty={dirty} wide={batch || source !== 'private'} actions={<button className="nt-primary" form={formId} type="submit" disabled={action.busy}>{backlog ? '转为任务' : '保存'}</button>}>
    <form id={formId} onSubmit={(event) => { event.preventDefault(); submit(); }}><fieldset disabled={action.busy}>
      {personal ? <TaskCreateSource source={source} projectId={rows[0]?.value.projectId ?? ''} projects={projects} onSource={changeSource} onProject={(id) => changeProject(id, true)} /> : <p className="v2-context">项目：{data.projects.find((row) => row.id === source)?.name} · 创建人：{backlog ? data.accounts.find((row) => row.id === backlog.creatorId)?.displayName ?? '历史成员' : user.displayName}</p>}
      {batch && <div className="v2-section-head"><h3>任务记录</h3><button type="button" onClick={() => setRows((previous) => [...previous, { key: createOperationId(), value: { ...makeRow(), title: '', milestoneId: null } }])}>＋ 添加一行</button></div>}
      <div className="v2-records">{rows.map((row, index) => <section className={batch ? 'v2-record' : ''} key={row.key}>
        {batch && <div className="v2-section-head"><h3>任务 {index + 1}</h3><button type="button" disabled={rows.length === 1} onClick={() => setRows((previous) => previous.filter((item) => item.key !== row.key))}>移除此行</button></div>}
        {source === 'private' ? <div className="v2-fields"><Field label="任务名称" full><input required maxLength={200} value={row.value.title} onChange={(event) => setRows([{ ...row, value: { ...row.value, title: event.target.value } }])} /></Field><PriorityField value={row.value.priority} onChange={(priority) => setRows([{ ...row, value: { ...row.value, priority } }])} /></div> : <TaskFields fromBacklog={Boolean(backlog)} value={row.value} onChange={(value) => setRows((previous) => previous.map((item) => item.key === row.key ? { ...item, value } : item))} data={data} selfId={user.id} excludeSelf={forOthers} onlySelf={personalPlacement || !data.projects.find((project) => project.id === row.value.projectId)?.canManage} />}
        {source === 'private' && <TaskRemark value={row.value.remark ?? ''} onChange={(remark) => setRows([{ ...row, value: { ...row.value, remark } }])} />}
      </section>)}</div>
      {personalPlacement && <Field label="个人分类"><select aria-label="个人分类" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>}
      <Feedback error={action.error} />
    </fieldset></form>
  </ModalPage>;
}
