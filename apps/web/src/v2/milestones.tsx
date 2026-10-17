import { useId, useRef, useState } from 'react';
import type { V2Milestone } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { ModalPage, useModal } from './modal';
import { Feedback, Field, useAction } from './controls';
import { Confirmation } from './confirmation';
import { TaskEditor } from './task-editor';

/** 日期列、历史分页和未规划列表复用同一目标卡片及详情。 */
export function MilestonePanel({ projectId, overview = false }: { projectId: string; overview?: boolean }) {
  const { data } = useWorkspace(), modal = useModal(), scroll = useRef<HTMLDivElement>(null);
  const project = data.projects.find((row) => row.id === projectId), rows = data.milestones.filter((row) => row.projectId === projectId);
  const cutoff = data.naturalWeekStart;
  const old = rows.filter((row) => row.expectedOn && row.expectedOn < cutoff);
  const dates = [...new Set(rows.flatMap((row) => row.expectedOn && row.expectedOn >= cutoff ? [row.expectedOn] : []))].sort();
  return <section className="nt-panel"><div className="nt-row nt-between"><div><h3>{overview ? project?.name : '项目规划'} <span className="nt-muted">{rows.length} 项</span></h3><p className="nt-muted">{cutoff} 起的目标 · 早期目标在历史里程碑查看</p></div><div className="nt-row"><button className="nt-quiet" onClick={() => modal.open(<MilestoneList projectId={projectId} cutoff={cutoff} unplanned />)}>未规划节点</button>{project?.canManage && <button onClick={() => modal.open(<MilestoneForm projectId={projectId} />)}>＋ 新增里程碑</button>}</div></div>
    {old.length > 0 && <button className="nt-history-entry" onClick={() => modal.open(<MilestoneList projectId={projectId} cutoff={cutoff} />)}>历史里程碑 · {cutoff} 以前 · {old.length} 项 · {old.filter((row) => row.status !== 'completed').length} 项未完成 查看</button>}
    <div className="nt-tools"><span className="nt-muted">按预计完成日期排列 · 同日目标在同一列</span><div className="nt-row"><button aria-label="查看较早日期" onClick={() => scroll.current?.scrollBy({ left: -250, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}>←</button><button aria-label="查看后续日期" onClick={() => scroll.current?.scrollBy({ left: 250, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}>→</button></div></div>
    {dates.length ? <div ref={scroll} className="nt-date-scroll" aria-label="按日期分列的里程碑"><div className="nt-date-columns">{dates.map((date) => <section className="nt-date-column" key={date}><header className="nt-date-heading"><time dateTime={date}>{date}<small>{rows.filter((row) => row.expectedOn === date).length} 项目标</small></time></header><div className="nt-date-cards">{rows.filter((row) => row.expectedOn === date).map((row) => <MilestoneCard key={row.id} milestone={row} />)}</div></section>)}</div></div> : <div className="nt-empty">当前及后续日期暂无已排期目标</div>}
  </section>;
}

/** 卡片显示完成数量及不能完成的原因，不用百分比代替阶段目标判断。 */
function MilestoneCard({ milestone }: { milestone: V2Milestone }) {
  const { data } = useWorkspace(), modal = useModal();
  const tasks = data.tasks.filter((row) => row.milestoneId === milestone.id), unfinished = tasks.filter((row) => row.status !== 'completed').length;
  const canConfirm = data.projects.find((row) => row.id === milestone.projectId)?.canConfirmMilestone;
  return <article className={`nt-lane-card ${milestone.status === 'completed' ? 'done' : ''}`}><button className="nt-link" onClick={() => modal.push(<MilestoneDetail milestoneId={milestone.id} />)}>{milestone.title}</button><p>{tasks.length ? `关联任务 ${tasks.length - unfinished}/${tasks.length} 已完成` : '尚未关联任务'}</p><footer><span className="nt-badge">{milestone.status === 'completed' ? '已完成' : '未完成'}</span>{milestone.status === 'open' && <CompleteButton milestone={milestone} disabled={unfinished > 0 || !canConfirm} />}</footer>{unfinished > 0 && <p>还有 {unfinished} 项任务未完成</p>}{!canConfirm && milestone.status === 'open' && <p>由项目研发负责人确认完成</p>}{milestone.needsReview && <p>关联任务有回退，请核验阶段目标</p>}</article>;
}

/** 完成和重开只记录目标状态，不批量改动关联任务。 */
function CompleteButton({ milestone, disabled = false }: { milestone: V2Milestone; disabled?: boolean }) {
  const { run } = useWorkspace(), modal = useModal();
  const action = milestone.status === 'completed' ? 'reopen_milestone' : 'complete_milestone';
  const label = milestone.status === 'completed' ? '重开里程碑' : '标记完成';
  return <button disabled={disabled} onClick={() => modal.push(<Confirmation label={label} intent={{ action, milestoneId: milestone.id, version: milestone.version }} onConfirm={(confirmation) => run('projects', { action, operationId: createOperationId(), milestoneId: milestone.id, version: milestone.version, confirmation })} />)}>{label}</button>;
}

/** 历史每页十条；进入目标后在同层返回到原页码。 */
function MilestoneList({ projectId, cutoff, unplanned = false }: { projectId: string; cutoff: string; unplanned?: boolean }) {
  const { data } = useWorkspace(), modal = useModal(), [page, setPage] = useState(0);
  const rows = data.milestones.filter((row) => row.projectId === projectId && (unplanned ? row.expectedOn === null : row.expectedOn !== null && row.expectedOn < cutoff)).sort((a, b) => (b.expectedOn ?? '').localeCompare(a.expectedOn ?? ''));
  const pages = Math.max(1, Math.ceil(rows.length / 10)), current = Math.min(page, pages - 1);
  return <ModalPage title={unplanned ? '未规划节点' : '历史里程碑'} wide actions={unplanned && data.projects.find((row) => row.id === projectId)?.canManage ? <button onClick={() => modal.push(<MilestoneForm projectId={projectId} />)}>＋ 新增里程碑</button> : undefined}><p className="v2-context">{data.projects.find((row) => row.id === projectId)?.name} · {rows.length} 项</p>{unplanned ? <div className="nt-unplanned-list">{rows.map((row) => <MilestoneCard key={row.id} milestone={row} />)}</div> : <><div className="nt-scroll"><table className="nt-table"><thead><tr><th>里程碑</th><th>预计完成日期</th><th>状态</th><th>关联任务</th></tr></thead><tbody>{rows.slice(current * 10, current * 10 + 10).map((row) => { const tasks = data.tasks.filter((task) => task.milestoneId === row.id); return <tr key={row.id}><td><button className="nt-link" onClick={() => modal.push(<MilestoneDetail milestoneId={row.id} />)}>{row.title}</button></td><td>{row.expectedOn}</td><td>{row.status === 'completed' ? '已完成' : '未完成'}</td><td>{tasks.filter((task) => task.status === 'completed').length} / {tasks.length}</td></tr>; })}</tbody></table></div><div className="nt-pager"><span>共 {rows.length} 项 · 每页 10 项</span><div className="nt-row"><button disabled={current === 0} onClick={() => setPage(current - 1)}>上一页</button><span>第 {current + 1} / {pages} 页</span><button disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>下一页</button></div></div></>}{!rows.length && <div className="nt-empty">暂无记录</div>}</ModalPage>;
}

/** 详情直接读取共享任务，解除关联保留任务与所有安排。 */
export function MilestoneDetail({ milestoneId }: { milestoneId: string }) {
  const { data, run } = useWorkspace(), modal = useModal(), milestone = data.milestones.find((row) => row.id === milestoneId);
  if (!milestone) return <ModalPage title="里程碑"><p>里程碑不存在或已失去访问权限。</p></ModalPage>;
  const project = data.projects.find((row) => row.id === milestone.projectId), tasks = data.tasks.filter((row) => row.milestoneId === milestoneId), unfinished = tasks.filter((row) => row.status !== 'completed').length;
  return <ModalPage title="里程碑详情" actions={<>{project?.canManage && <button onClick={() => modal.push(<MilestoneForm projectId={milestone.projectId} milestone={milestone} />)}>编辑</button>}<CompleteButton milestone={milestone} disabled={!project?.canConfirmMilestone || (milestone.status === 'open' && unfinished > 0)} /></>}><h3>{milestone.title}</h3><dl className="v2-facts"><dt>项目</dt><dd>{project?.name}</dd><dt>状态</dt><dd>{milestone.status === 'completed' ? '已完成' : '未完成'}</dd><dt>预计完成日期</dt><dd>{milestone.expectedOn ?? '未规划'}</dd><dt>责任归属</dt><dd>{data.accounts.find((row) => row.id === milestone.ownerId)?.displayName ?? '历史成员'}</dd></dl>{milestone.needsReview && <p className="v2-error">关联任务已回退，阶段目标需要项目研发负责人核验。</p>}{unfinished > 0 && milestone.status === 'open' && <p>还有 {unfinished} 项任务未完成，完成后才能确认目标。</p>}{!project?.canConfirmMilestone && <p className="v2-context">标记完成和重开由本项目任意研发负责人操作。</p>}<h3>关联任务 · {tasks.length}</h3><ul className="nt-link-list">{tasks.map((task) => <li key={task.id}><button className="nt-link" onClick={() => modal.push(<TaskEditor task={task} />)}>{task.title}</button>{project?.canManage && <button onClick={() => modal.push(<Confirmation label="解除里程碑关联" intent={{ action: 'unlink_milestone', taskId: task.id, version: task.version }} onConfirm={(confirmation) => run('projects', { action: 'unlink_milestone', taskId: task.id, version: task.version, operationId: createOperationId(), confirmation })} />)}>解除关联</button>}</li>)}</ul>{!tasks.length && <p className="nt-empty">尚未关联任务</p>}</ModalPage>;
}

/** 编辑目标时责任归属用于成员移出检查，不限制其他研发负责人确认。 */
function MilestoneForm({ projectId, milestone }: { projectId: string; milestone?: V2Milestone }) {
  const { data, user, run } = useWorkspace(), modal = useModal(), action = useAction(), id = useId();
  const project = data.projects.find((row) => row.id === projectId), members = data.accounts.filter((row) => project?.members.some((member) => member.accountId === row.id) || row.id === milestone?.ownerId);
  const [title, setTitle] = useState(milestone?.title ?? ''), [date, setDate] = useState(milestone?.expectedOn ?? ''), [ownerId, setOwner] = useState(milestone?.ownerId ?? members.find((row) => row.id === user.id && !row.disabled)?.id ?? members.find((row) => !row.disabled)?.id ?? '');
  const dirty = title !== (milestone?.title ?? '') || date !== (milestone?.expectedOn ?? '') || (milestone !== undefined && ownerId !== milestone.ownerId);
  return <ModalPage title={milestone ? '编辑里程碑' : '新增里程碑'} dirty={dirty} busy={action.busy} actions={<button type="submit" form={id} className="nt-primary" disabled={action.busy}>保存</button>}><form id={id} onSubmit={(event) => { event.preventDefault(); void action.act(async () => { const fields = { title, expectedOn: date || null, ownerId, operationId: createOperationId() }; await run('projects', milestone ? { ...fields, action: 'edit_milestone', milestoneId: milestone.id, version: milestone.version } : { ...fields, action: 'create_milestone', projectId }); modal.finish(); }); }}><fieldset disabled={action.busy}><div className="v2-fields"><Field label="阶段目标" full><input required value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></Field><Field label="预计完成日期（选填）"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field><Field label="责任归属"><select value={ownerId} required onChange={(event) => setOwner(event.target.value)}><option value="">请选择成员</option>{members.map((row) => <option key={row.id} value={row.id} disabled={row.disabled && row.id !== ownerId}>{row.displayName}{row.disabled ? '（已停用）' : ''}</option>)}</select></Field></div><Feedback error={action.error} /></fieldset></form></ModalPage>;
}
