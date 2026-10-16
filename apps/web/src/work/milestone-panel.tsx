import { createOperationId } from '../identity/operation-id';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { milestoneCommandSchema } from '@ntfs/contracts';
import type { Identity, MilestoneCommand, OrganizationSnapshot, WorkSnapshot } from '@ntfs/contracts';
import { Dialog } from '../layout/dialog';
import { milestoneCommand } from './milestones-api';
import { MilestoneDetail } from './milestone-detail';
import './milestones.css';

type Node = WorkSnapshot['milestones'][number];
type Props = { projectId: string; tasks: WorkSnapshot['tasks']; milestones: WorkSnapshot['milestones']; identity: Identity; organization: OrganizationSnapshot; canManage: boolean; query: string; onOpenTask: (id: string) => void };
type DateDraft = { milestoneId: string; version: number; expectedOn: string | null };

/** 独立目标按日期展示；关联任务只提供进展参考，不决定目标完成。 */
export function MilestonePanel({ projectId, tasks, milestones, identity, organization, canManage, query, onOpenTask }: Props) {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState<{ date: string | null } | null>(null);
  const [draft, setDraft] = useState<DateDraft | null>(null);
  const [dragging, setDragging] = useState<DateDraft | null>(null);
  const [dropTarget, setDropTarget] = useState('');
  const [error, setError] = useState('');
  const operation = useRef<{ content: string; id: string } | null>(null);
  const save = useMutation({ mutationFn: (command: MilestoneCommand) => milestoneCommand(command, identity.csrfToken), onSuccess: async () => {
    operation.current = null; setCreating(null);
    await client.invalidateQueries({ queryKey: ['work'] });
  } });
  const nodes = milestones.filter((entry) => entry.status !== 'removed');
  const dates = [...new Set(nodes.flatMap((entry) => entry.expectedOn ? [entry.expectedOn] : []))].sort();
  const selected = nodes.find((entry) => entry.id === selectedId);
  const project = organization.projects.find((entry) => entry.id === projectId);
  const owners = organization.accounts.filter((account) => !account.disabled && account.teamId === project?.teamId && project.members.some((member) => member.accountId === account.id && member.roles.some((role) => role === 'developer' || role === 'project_lead')));
  const defaultOwner = owners.find((entry) => entry.id === identity.id) ?? owners.find((entry) => project?.members.some((member) => member.accountId === entry.id && member.roles.includes('project_lead')));
  const feedback = (error || save.error) && <p role="alert" className="form-error">{error || save.error?.message}<button type="button" disabled={save.isPending} onClick={() => { void client.invalidateQueries({ queryKey: ['work'] }); }}>刷新核对</button></p>;

  /** 创建重试复用操作标识；所有变更仍由服务端重验权限和版本。 */
  function send(input: unknown) {
    const parsed = milestoneCommandSchema.safeParse(input);
    if (!parsed.success) { setError('请检查名称、负责人、日期和调整原因。'); return; }
    const command = parsed.data;
    if (command.action === 'create_node') {
      const content = JSON.stringify({ ...command, operationId: '' });
      if (operation.current?.content !== content) operation.current = { content, id: createOperationId() };
      command.operationId = operation.current.id;
    }
    setError(''); save.mutate(command);
  }
  function clear() { setError(''); save.reset(); }
  function add(date: string | null) { clear(); setCreating({ date }); }
  /** 拖放后要求填写原因，保留旧日期和版本供冲突校验。 */
  function drop(date: string | null) {
    if (!dragging || !canManage || save.isPending) return;
    if (dragging.expectedOn !== date) { clear(); setSelectedId(dragging.milestoneId); setDraft({ ...dragging, expectedOn: date }); }
    setDragging(null); setDropTarget('');
  }
  function node(entry: Node) {
    const related = tasks.filter((task) => task.milestoneId === entry.id);
    const completed = related.filter((task) => task.status === 'completed').length;
    return <button type="button" className={`fish-node ${entry.status === 'completed' ? 'completed' : 'not_started'}`} key={entry.id} draggable={canManage && !save.isPending}
      onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', entry.id); setDragging({ milestoneId: entry.id, version: entry.version, expectedOn: entry.expectedOn }); }} onDragEnd={() => { setDragging(null); setDropTarget(''); }}
      onClick={() => { clear(); setSelectedId(entry.id); setDraft(null); }}><strong>{entry.title}</strong><span className="fish-node-meta"><span>{entry.status === 'completed' ? '已确认完成' : '未完成'}</span></span><span className="detail-meta">{related.length ? `关联任务 ${completed}/${related.length} 已完成` : '尚未关联任务'}</span></button>;
  }
  const matches = (entry: Node) => entry.title.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  return <section className="panel milestone-panel" aria-label="项目里程碑"><div className="panel-title"><div><h2>项目规划 <span className="detail-meta">{nodes.length} 项</span></h2><p className="subtitle">先确定阶段目标，安排工作时再关联任务。</p></div></div>
    {save.isSuccess && <p role="status">已保存。</p>}
    <div className="fish-scroll" tabIndex={0} aria-label="里程碑时间轴，可横向滚动"><div className="fish-axis">{dates.map((date, index) => {
      const group = nodes.filter((entry) => entry.expectedOn === date);
      return <section key={date} className={`fish-day ${index % 2 ? 'below' : 'above'} ${dropTarget === date ? 'fish-drop-target' : ''}`} onDragOver={(event) => { if (canManage && dragging) { event.preventDefault(); setDropTarget(date); } }} onDrop={(event) => { event.preventDefault(); drop(date); }}>
        <div className="fish-date"><time dateTime={date}>{date.slice(5).replace('-', '/')}<small>{date.slice(0, 4)}</small></time><span className="fish-count">{group.length}</span>{canManage && <button aria-label={`在 ${date} 新增里程碑`} onClick={() => add(date)}>＋</button>}</div>
        <div className="fish-branch">{group.filter(matches).map(node)}</div>
      </section>;
    })}{dates.length === 0 && <div className="fish-empty"><p>还没有排期，添加里程碑开始规划。</p></div>}{canManage && <div className="fish-add-date"><button type="button" onClick={() => add(null)}>＋ 新增里程碑</button></div>}</div></div>
    <section className={`fish-unplanned ${dropTarget === 'unplanned' ? 'fish-drop-target' : ''}`} onDragOver={(event) => { if (canManage && dragging) { event.preventDefault(); setDropTarget('unplanned'); } }} onDrop={(event) => { event.preventDefault(); drop(null); }}><div className="panel-title"><h3>未规划日期</h3></div><div className="fish-unplanned-nodes">{nodes.filter((entry) => !entry.expectedOn && matches(entry)).map(node)}</div></section>
    {creating && <Dialog title="新增里程碑" onClose={() => setCreating(null)} busy={save.isPending}><form onSubmit={(event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      send({ action: 'create_node', projectId, ownerId: String(form.get('owner')), title: String(form.get('title')), expectedOn: String(form.get('date')) || null, operationId: createOperationId() });
    }}><fieldset disabled={save.isPending}><label>目标名称<input autoFocus name="title" required maxLength={200} placeholder="例如：完成项目联调验收" /></label><label>负责人<select name="owner" defaultValue={defaultOwner?.id ?? ''} required><option value="">请选择</option>{owners.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}</select></label><label>预计完成日期<input type="date" name="date" defaultValue={creating.date ?? ''} /><small>留空放入未规划日期</small></label><p className="detail-meta">创建后可在团队任务中关联此目标。</p>{feedback}<button className="primary-button">创建里程碑</button></fieldset></form></Dialog>}
    {selected && <MilestoneDetail key={selected.id} milestone={selected} linked={tasks.filter((entry) => entry.milestoneId === selected.id)}
      identity={identity} accounts={organization.accounts} owners={owners} canManage={canManage} initialDate={draft}
      onClose={() => { setSelectedId(''); setDraft(null); }} onOpenTask={onOpenTask} />}
  </section>;
}
