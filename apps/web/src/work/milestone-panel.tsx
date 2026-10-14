import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { milestoneCommandSchema } from '@ntfs/contracts';
import type { Identity, MilestoneCommand, OrganizationSnapshot, WorkSnapshot } from '@ntfs/contracts';
import { Dialog } from '../layout/dialog';
import { milestoneCommand } from './milestones-api';
import { TaskQuickActions } from './task-quick-actions';
import './milestones.css';

type Task = WorkSnapshot['tasks'][number];
type Props = { projectId: string; tasks: Task[]; identity: Identity; organization: OrganizationSnapshot; canManage: boolean; query: string; onOpenTask: (id: string) => void };
type DateDraft = { taskId: string; version: number; expectedOn: string | null };
const statuses = { not_started: '待开始', in_progress: '进行中', completed: '已完成', cancelled: '已取消' };

/** 日期组织共享任务；节点上完成名称、进度和排期操作，原有业务规则保持不变。 */
export function MilestonePanel({ projectId, tasks, identity, organization, canManage, query, onOpenTask }: Props) {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState<{ date: string | null } | null>(null);
  const [existing, setExisting] = useState(false);
  const [draft, setDraft] = useState<DateDraft | null>(null);
  const [removing, setRemoving] = useState(false);
  const [dragging, setDragging] = useState<DateDraft | null>(null);
  const [dropTarget, setDropTarget] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const operation = useRef<{ content: string; id: string } | null>(null);
  const save = useMutation({ mutationFn: (command: MilestoneCommand) => milestoneCommand(command, identity.csrfToken), onSuccess: async () => {
    operation.current = null; setCreating(null); setDraft(null); setRemoving(false); setNotice('已保存');
    await client.invalidateQueries({ queryKey: ['work'] });
  } });
  const nodes = tasks.filter((task) => task.inMilestone);
  const dates = [...new Set(nodes.flatMap((task) => task.expectedOn ? [task.expectedOn] : []))].sort();
  const selected = tasks.find((task) => task.id === selectedId);
  const project = organization.projects.find((entry) => entry.id === projectId);
  const owners = organization.accounts.filter((account) => !account.disabled && account.teamId === project?.teamId && project.members.some((member) => member.accountId === account.id && member.roles.some((role) => role === 'developer' || role === 'project_lead')));
  const defaultOwner = owners.find((entry) => entry.id === identity.id) ?? owners.find((entry) => project?.members.some((member) => member.accountId === entry.id && member.roles.includes('project_lead')));
  const conflicts = nodes.filter((task) => task.parentId && task.expectedOn && tasks.some((parent) => parent.id === task.parentId && parent.expectedOn && task.expectedOn && task.expectedOn > parent.expectedOn));
  const matches = (task: Task) => task.title.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const feedback = (error || save.error) && <p role="alert" className="form-error">{error || save.error?.message}<button disabled={save.isPending} onClick={() => { void client.invalidateQueries({ queryKey: ['work'] }); }}>刷新核对</button></p>;

  /** 先校验输入，创建重试复用幂等标识，成功后才同步图形。 */
  function send(input: unknown) {
    const parsed = milestoneCommandSchema.safeParse(input);
    if (!parsed.success) { setError('请检查名称、日期和调整原因。'); return; }
    const command = parsed.data;
    if (command.action === 'create_node') {
      const content = JSON.stringify({ ...command, operationId: '' });
      if (operation.current?.content !== content) operation.current = { content, id: crypto.randomUUID() };
      command.operationId = operation.current.id;
    }
    setError(''); setNotice(''); save.mutate(command);
  }
  function clearFeedback() { setError(''); save.reset(); }
  function add(date: string | null) { clearFeedback(); setExisting(false); setCreating({ date }); }
  /** 拖放只暂存版本和目标日期，用户确认原因后才提交。 */
  function drop(date: string | null) {
    if (!dragging || !canManage || save.isPending) return;
    if (dragging.expectedOn !== date) { clearFeedback(); setSelectedId(dragging.taskId); setDraft({ ...dragging, expectedOn: date }); }
    setDragging(null); setDropTarget('');
  }
  function node(task: Task) {
    return <button type="button" className={`fish-node ${task.status}`} key={task.id} aria-label={`${task.title}，${statuses[task.status]}，${task.progress}%`} draggable={canManage && !save.isPending}
      onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', task.id); setDragging({ taskId: task.id, version: task.version, expectedOn: task.expectedOn }); }} onDragEnd={() => { setDragging(null); setDropTarget(''); }}
      onClick={() => { clearFeedback(); setSelectedId(task.id); setDraft(null); setRemoving(false); }}><strong>{task.title}</strong><span className="fish-node-meta"><span>{statuses[task.status]}</span><span>{task.progress}%</span></span><progress value={task.progress} max={100} aria-label={`${task.title}累计进度`} />{task.blockedReason && <span className="fish-blocked">受阻</span>}</button>;
  }
  function closeNode() { setSelectedId(''); setDraft(null); setRemoving(false); clearFeedback(); }

  return <section className="panel milestone-panel" aria-label="项目里程碑"><div className="panel-title"><div><h2>项目规划 <span className="detail-meta">{nodes.length} 项</span></h2></div>{canManage && <button className="primary-button" onClick={() => add(null)}>＋ 新增节点</button>}</div>
    {notice && <p role="status">{notice}</p>}
    {conflicts.length > 0 && <details><summary>{conflicts.length} 项子任务晚于父任务，请核对日期</summary>{conflicts.map((task) => <p key={task.id}><button className="text-button" onClick={() => onOpenTask(task.id)}>{task.title}</button> · {task.expectedOn}</p>)}</details>}
    <div className="fish-scroll" tabIndex={0} aria-label="里程碑时间轴，可横向滚动"><div className="fish-axis">{dates.map((date, index) => {
      const group = nodes.filter((task) => task.expectedOn === date);
      return <section key={date} className={`fish-day ${index % 2 ? 'below' : 'above'} ${dropTarget === date ? 'fish-drop-target' : ''}`} onDragEnter={(event) => { if (canManage && dragging) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDragOver={(event) => { if (canManage && dragging) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(date); } }} onDrop={(event) => { event.preventDefault(); drop(date); }}>
        <div className="fish-date"><time dateTime={date}>{date.slice(5).replace('-', '/')}<small>{date.slice(0, 4)}</small></time><span className="fish-count" title={`${group.length} 个事项`}>{group.length}</span>{canManage && <button aria-label={`在 ${date} 新增节点`} onClick={() => add(date)}>＋</button>}</div>
        <div className="fish-branch">{group.filter(matches).map(node)}{dropTarget === date && <span className="fish-placeholder">移至 {date}</span>}</div>
      </section>;
    })}{dates.length === 0 && <div className="fish-empty"><p>还没有排期，添加第一个节点开始规划。</p>{canManage && <button onClick={() => add(null)}>＋ 添加节点</button>}</div>}
      {dates.length > 0 && canManage && <div className="fish-add-date"><button aria-label="新增日期节点" onClick={() => add(null)}>＋</button></div>}
    </div></div>
    <section className={`fish-unplanned ${dropTarget === 'unplanned' ? 'fish-drop-target' : ''}`} onDragEnter={(event) => { if (canManage && dragging) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDragOver={(event) => { if (canManage && dragging) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget('unplanned'); } }} onDrop={(event) => { event.preventDefault(); drop(null); }}><div className="panel-title"><h3>未规划 <span className="detail-meta">{nodes.filter((task) => !task.expectedOn).length} 项</span></h3>{canManage && <button onClick={() => add(null)}>＋ 添加事项</button>}</div><div className="fish-unplanned-nodes">{nodes.filter((task) => !task.expectedOn && matches(task)).map(node)}</div>{!nodes.some((task) => !task.expectedOn) && <p>暂不确定日期的事项放在这里</p>}</section>
    {creating && <Dialog title={existing ? '加入已有任务' : '新增里程碑节点'} onClose={() => setCreating(null)} busy={save.isPending}><form onSubmit={(event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget); const date = String(form.get('date')) || null;
      if (existing) { const task = tasks.find((entry) => entry.id === form.get('taskId')); if (task) send({ action: 'add_node', taskId: task.id, version: task.version, expectedOn: date }); }
      else if (defaultOwner) send({ action: 'create_node', projectId, ownerId: defaultOwner.id, title: String(form.get('title')), description: '', acceptance: '', expectedOn: date, operationId: crypto.randomUUID() });
    }}><fieldset disabled={save.isPending}>{existing ? <label>选择任务<select name="taskId" required><option value="">请选择</option>{tasks.filter((task) => !task.inMilestone).map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label> : <label>名称<input autoFocus name="title" required maxLength={200} placeholder="例如：完成项目联调" /></label>}<label>预计完成日期<input type="date" name="date" defaultValue={creating.date ?? ''} /><small>留空放入未规划</small></label>{!existing && <p className="detail-meta">{defaultOwner ? `主负责人：${defaultOwner.displayName}，可在任务详情中调整` : '项目尚无可用研发负责人，请先在团队管理中设置。'}</p>}{feedback}<button className="primary-button" disabled={!existing && !defaultOwner}>{save.isPending ? '正在添加…' : '添加节点'}</button><button type="button" className="text-button" onClick={() => { setExisting(!existing); clearFeedback(); }}>{existing ? '新建事项' : '从已有任务选择'}</button></fieldset></form></Dialog>}
    {selected && <Dialog title={selected.title} onClose={closeNode} busy={save.isPending}><div className="detail-meta"><span className="status-badge">{statuses[selected.status]}</span><span>{selected.expectedOn ?? '未规划'}</span><span>{organization.accounts.find((entry) => entry.id === selected.ownerId)?.displayName ?? '成员'}</span></div>
      {selected.ownerId === identity.id && !draft && !removing && <form onSubmit={(event) => { event.preventDefault(); send({ action: 'edit_task', taskId: selected.id, version: selected.version, title: String(new FormData(event.currentTarget).get('title')), description: selected.description, acceptance: selected.acceptance }); }}><label>名称<input key={`${selected.id}:${selected.version}`} name="title" required maxLength={200} defaultValue={selected.title} /></label><button disabled={save.isPending}>保存名称</button></form>}
      {!draft && !removing && <><TaskQuickActions key={selected.id} task={selected} identity={identity} /><div className="assignment-actions">{canManage && selected.inMilestone && <><button onClick={() => setDraft({ taskId: selected.id, version: selected.version, expectedOn: selected.expectedOn })}>调整日期</button><button onClick={() => setRemoving(true)}>移出里程碑…</button></>}<button onClick={() => { const id = selected.id; closeNode(); onOpenTask(id); }}>任务详情 →</button></div></>}
      {draft && <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); send({ action: 'reschedule_node', taskId: selected.id, version: draft.version, expectedOn: String(form.get('date')) || null, reason: String(form.get('reason')) }); }}><fieldset disabled={save.isPending}><label>预计完成日期<input type="date" name="date" defaultValue={draft.expectedOn ?? ''} /><small>清空日期后放入未规划</small></label><label>调整原因<input autoFocus name="reason" required maxLength={20000} placeholder="简要说明这次调整" /></label><div className="assignment-actions"><button className="primary-button">保存日期</button><button type="button" onClick={() => setDraft(null)}>取消</button></div></fieldset></form>}
      {removing && <form onSubmit={(event) => { event.preventDefault(); send({ action: 'remove_node', taskId: selected.id, version: selected.version, reason: String(new FormData(event.currentTarget).get('reason')) }); }}><fieldset disabled={save.isPending}><p>从图中移除，任务和已有工作记录继续保留。</p><label>移出原因<input autoFocus name="reason" required maxLength={20000} /></label><div className="assignment-actions"><button>确认移出</button><button type="button" onClick={() => setRemoving(false)}>取消</button></div></fieldset></form>}{feedback}
    </Dialog>}
  </section>;
}
