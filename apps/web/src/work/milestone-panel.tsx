import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { milestoneCommandSchema } from '@ntfs/contracts';
import type { Identity, MilestoneCommand, OrganizationSnapshot, WorkSnapshot } from '@ntfs/contracts';
import { milestoneCommand } from './milestones-api';
import './milestones.css';

type Task = WorkSnapshot['tasks'][number];
type Props = { projectId: string; tasks: Task[]; identity: Identity; organization: OrganizationSnapshot; canManage: boolean };
const statuses = { not_started: '待开始', in_progress: '进行中', completed: '已完成', cancelled: '已取消' };
type DateDraft = { taskId: string; version: number; expectedOn: string | null };

/** 鱼骨图和任务列表使用同一快照；拖动先确认，写入成功后才更新位置。 */
export function MilestonePanel({ projectId, tasks, identity, organization, canManage }: Props) {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DateDraft | null>(null);
  const [dragging, setDragging] = useState<DateDraft | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const operation = useRef<{ content: string; id: string } | null>(null);
  const save = useMutation({
    mutationFn: (command: MilestoneCommand) => milestoneCommand(command, identity.csrfToken),
    onSuccess: async () => {
      operation.current = null; setDraft(null); setNotice('已保存，里程碑与任务内容同步更新。'); setRevision((value) => value + 1);
      await client.invalidateQueries({ queryKey: ['work'] });
    },
  });
  const nodes = tasks.filter((task) => task.inMilestone);
  const dates = [...new Set(nodes.flatMap((task) => task.expectedOn ? [task.expectedOn] : []))].sort();
  const selected = tasks.find((task) => task.id === selectedId);
  const dateConflicts = tasks.filter((task) => task.parentId && task.expectedOn && tasks.some((parent) => parent.id === task.parentId && parent.expectedOn && task.expectedOn && task.expectedOn > parent.expectedOn));
  const project = organization.projects.find((entry) => entry.id === projectId);
  const owners = organization.accounts.filter((account) => !account.disabled && project?.members.some((member) => member.accountId === account.id && member.roles.some((role) => role === 'developer' || role === 'project_lead')));

  function send(input: unknown) {
    const result = milestoneCommandSchema.safeParse(input);
    if (!result.success) { setError('请填写标题、有效主负责人及必要调整原因，并核对日期。'); return; }
    const command = result.data;
    if (command.action === 'create_node') {
      const content = JSON.stringify({ ...command, operationId: '' });
      if (operation.current?.content !== content) operation.current = { content, id: crypto.randomUUID() };
      command.operationId = operation.current.id;
    }
    setError(''); setNotice(''); save.mutate(command);
  }
  function drop(expectedOn: string | null) {
    if (!canManage || !dragging || save.isPending) return;
    setSelectedId(dragging.taskId); setDraft({ ...dragging, expectedOn }); setDragging(null); setDropTarget(null);
  }
  function node(task: Task) {
    return <button type="button" className={`fish-node ${task.status}`} key={task.id} aria-pressed={selectedId === task.id}
      draggable={canManage && !save.isPending} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', task.id); setDragging({ taskId: task.id, version: task.version, expectedOn: task.expectedOn }); }} onDragEnd={() => { setDragging(null); setDropTarget(null); }}
      onClick={() => { setSelectedId(task.id); setDraft(null); }}><strong>{task.title}</strong><span>{statuses[task.status]} · {organization.accounts.find((account) => account.id === task.ownerId)?.displayName ?? '成员'}</span></button>;
  }
  return <section className="panel milestone-panel" aria-label="项目里程碑"><h2>项目里程碑</h2><p>预计完成日期 · 同日支持多个事项 · 节点与团队任务共用数据</p>
    {dateConflicts.length > 0 && <div role="status"><p>以下子任务日期晚于父任务，请团队负责人或项目研发负责人核对规划；系统不会自动顺延父任务。</p><ul>{dateConflicts.map((task) => <li key={task.id}><a href={`#task-${task.id}`}>{task.title}</a> · {task.expectedOn}</li>)}</ul></div>}
    {(error || save.isError) && <p role="alert" className="form-error">{error || save.error?.message} 图中保留已保存位置；请刷新核对后重试。<button onClick={() => { void client.invalidateQueries({ queryKey: ['work'] }); }}>刷新规划</button></p>}{notice && <p role="status">{notice}</p>}
    {canManage && <p>点击节点可编辑日期、移出规划；也可拖至已有日期或未规划区，确认原因后保存。</p>}
    <div className="fish-scroll" tabIndex={0} aria-label="里程碑时间轴，可横向滚动"><div className="fish-axis">{dates.map((date, index) => <section key={date} className={`fish-day ${index % 2 ? 'below' : 'above'} ${dropTarget === date ? 'fish-drop-target' : ''}`} onDragOver={(event) => { if (canManage && dragging) { event.preventDefault(); setDropTarget(date); } }} onDrop={(event) => { event.preventDefault(); drop(date); }}><h3><time dateTime={date}>{date}</time></h3><div className="fish-branch">{nodes.filter((task) => task.expectedOn === date).map(node)}{dropTarget === date && <p className="fish-placeholder">松开后确认调整至 {date}</p>}</div></section>)}{dates.length === 0 && <p className="fish-empty">暂无已排期节点，可新增建设事项或从未规划区设置日期。</p>}</div></div>
    <section className={`fish-unplanned ${dropTarget === 'unplanned' ? 'fish-drop-target' : ''}`} onDragOver={(event) => { if (canManage && dragging) { event.preventDefault(); setDropTarget('unplanned'); } }} onDrop={(event) => { event.preventDefault(); drop(null); }}><h3>未规划</h3><p>已知工作、日期待定；不自动标记为计划外。</p><div>{nodes.filter((task) => !task.expectedOn).map(node)}</div>{dropTarget === 'unplanned' && <p className="fish-placeholder">松开后确认清空预计日期</p>}</section>
    {canManage && <details className="milestone-create"><summary>新增里程碑节点</summary><div className="milestone-editors"><form key={`create:${revision}`} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); send({ action: 'create_node', projectId, title: String(form.get('title')), description: String(form.get('description')), acceptance: String(form.get('acceptance')), ownerId: String(form.get('ownerId')), expectedOn: String(form.get('expectedOn')) || null, operationId: crypto.randomUUID() }); }}><fieldset disabled={save.isPending}><legend>创建新建设事项</legend><label>标题<input name="title" required maxLength={200} /></label><label>主负责人<select name="ownerId" required>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.displayName}</option>)}</select></label><label>说明（选填）<textarea name="description" maxLength={20000} /></label><label>完成标准（选填）<textarea name="acceptance" maxLength={20000} /></label><label>预计完成日期（空为未规划）<input type="date" name="expectedOn" /></label><button>创建任务并加入里程碑</button></fieldset></form>
      <form key={`add:${revision}`} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const task = tasks.find((entry) => entry.id === form.get('taskId')); if (task) send({ action: 'add_node', taskId: task.id, expectedOn: String(form.get('expectedOn')) || null, version: task.version }); }}><fieldset disabled={save.isPending}><legend>加入已有团队任务</legend><label>任务<select name="taskId" required><option value="">请选择</option>{tasks.filter((task) => !task.inMilestone).map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><label>预计完成日期<input type="date" name="expectedOn" /></label><button>加入，不复制任务</button></fieldset></form></div></details>}
    {selected && <section className="milestone-detail" key={`${selected.id}:${selected.version}`} aria-label="选中节点详情"><h3>{selected.title}</h3><p>{statuses[selected.status]} · {selected.inMilestone ? selected.expectedOn ?? '未规划' : '已移出里程碑'}</p>{selected.description && <p>{selected.description}</p>}{selected.acceptance && <p>完成标准 · {selected.acceptance}</p>}<a href={`#task-${selected.id}`}>查看同一任务的人员分工与进展</a>
      {canManage && selected.inMilestone && <div className="milestone-editors"><form key={draft ? `${draft.taskId}:${draft.version}:${draft.expectedOn}` : 'date'} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); send({ action: 'reschedule_node', taskId: selected.id, expectedOn: String(form.get('expectedOn')) || null, reason: String(form.get('reason')), version: draft?.version ?? selected.version }); }}><fieldset disabled={save.isPending}><legend>{draft ? '确认拖动调整' : '修改节点日期'}</legend><label>预计完成日期（清空移至未规划）<input type="date" name="expectedOn" defaultValue={(draft?.taskId === selected.id ? draft.expectedOn : selected.expectedOn) ?? ''} /></label><label>调整原因<textarea name="reason" required maxLength={20000} /></label><button>保存日期</button>{draft && <button type="button" onClick={() => setDraft(null)}>取消拖动</button>}</fieldset></form>
        <form onSubmit={(event) => { event.preventDefault(); send({ action: 'remove_node', taskId: selected.id, version: selected.version, reason: String(new FormData(event.currentTarget).get('reason')) }); }}><fieldset disabled={save.isPending}><legend>移出里程碑</legend><p>只移除图中节点，团队任务、分工、个人工作和历史均保留。</p><label>移出原因<textarea name="reason" required maxLength={20000} /></label><button>确认移出，保留任务</button></fieldset></form></div>}
      {selected.ownerId === identity.id && <details><summary>编辑任务内容（主负责人）</summary><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); send({ action: 'edit_task', taskId: selected.id, version: selected.version, title: String(form.get('title')), description: String(form.get('description')), acceptance: String(form.get('acceptance')) }); }}><fieldset disabled={save.isPending}><label>标题<input name="title" required maxLength={200} defaultValue={selected.title} /></label><label>说明<textarea name="description" maxLength={20000} defaultValue={selected.description} /></label><label>完成标准<textarea name="acceptance" maxLength={20000} defaultValue={selected.acceptance} /></label><button>保存任务内容</button></fieldset></form></details>}
    </section>}
  </section>;
}
