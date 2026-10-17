import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { v2StatusLabels, type V2SummaryRow } from '@ntfs/contracts';
import { useWorkspace } from './workspace';
import { useModal } from './modal';
import { currentPeriod, Feedback, PeriodSelect, periodLabel, StatusBadge } from './controls';
import { readSummary } from './api';
import { TaskEditor, TaskHistory } from './task-editor';
import { TaskCreate } from './task-create';
import { BacklogForm, BacklogList } from './backlog';
import { MilestonePanel } from './milestones';

/** 项目汇总、项目内页和里程碑总览共用当前授权项目，不建立独立任务副本。 */
export function ProjectsPageV2() {
  const { data } = useWorkspace(), [params, setParams] = useSearchParams();
  const selected = params.get('project'), allMilestones = params.get('view') === 'milestones', tab = params.get('tab') ?? 'tasks';
  const project = data.projects.find((row) => row.id === selected);
  const [periodId, setPeriod] = useState(() => currentPeriod(data.periods, data.today));
  function openProject(id: string) { setParams({ project: id, tab: 'tasks' }); }
  const roles = (role: string) => project?.members.filter((row) => row.roles.some((value) => value === role)).map((row) => data.accounts.find((account) => account.id === row.accountId)?.displayName ?? '历史成员').join('、');
  if (project) return <><button className="nt-link" onClick={() => setParams({})}>← 项目汇总</button><div className="v2-page-heading"><h2>{project.name}</h2><p className="nt-muted">研发负责人 {roles('project_lead')} · 项目经理 {roles('project_manager')} · {project.members.length} 位成员</p></div><div className="nt-tabs">{[{ id: 'tasks', label: '任务' }, { id: 'milestones', label: '里程碑' }, { id: 'backlog', label: '待建任务' }].map((item) => <button key={item.id} aria-pressed={tab === item.id} onClick={() => setParams({ project: project.id, tab: item.id })}>{item.label}</button>)}</div>{tab === 'milestones' ? <MilestonePanel projectId={project.id} /> : tab === 'backlog' ? <BacklogList projectId={project.id} /> : <ProjectTasks projectId={project.id} />}</>;
  if (allMilestones) return <><button className="nt-link" onClick={() => setParams({})}>← 项目汇总</button><h2 className="v2-page-heading">里程碑总览</h2>{data.projects.map((row) => <MilestonePanel key={row.id} projectId={row.id} overview />)}{!data.projects.length && <div className="nt-empty">暂无可见项目</div>}</>;
  return <><div className="nt-row nt-between"><div><h2>项目</h2><p className="nt-muted">{data.teamLeader ? '本团队项目' : '我参与的项目'} · {data.projects.length} 个</p></div><button onClick={() => setParams({ view: 'milestones' })}>里程碑总览</button></div><div className="nt-tools"><span className="nt-muted">任务执行情况</span><PeriodSelect label="汇总日期区间" periods={data.periods} value={periodId} onChange={setPeriod} /></div><ProjectOverview periodId={periodId} openProject={openProject} /></>;
}

/** 历史汇总的名称、执行人和状态来自区间末快照；点开后明确当前任务状态。 */
function ProjectOverview({ periodId, openProject }: { periodId: string; openProject: (id: string) => void }) {
  const { data } = useWorkspace(), modal = useModal();
  const query = useQuery({ queryKey: ['v2', 'summary', periodId], queryFn: () => readSummary(periodId), enabled: Boolean(periodId), refetchInterval: 10000 });
  if (query.isPending && periodId) return <p role="status">正在读取区间执行情况…</p>;
  if (query.error) return <Feedback error={query.error.message} />;
  return <>{data.projects.map((project) => {
    const rows = (query.data ?? []).filter((row) => row.projectId === project.id).sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3)), backlog = data.backlog.filter((row) => row.projectId === project.id);
    const leads = project.members.filter((row) => row.roles.includes('project_lead')).map((row) => data.accounts.find((account) => account.id === row.accountId)?.displayName ?? '历史成员').join('、');
    return <article className="nt-project" key={project.id}><header className="nt-project-head nt-row nt-between"><div><h3><button className="nt-link" onClick={() => openProject(project.id)}>{project.name} →</button></h3><p className="nt-muted">未开始 {rows.filter((row) => row.status === 'not_started').length} · 进行中 {rows.filter((row) => row.status === 'in_progress').length} · 已完成 {rows.filter((row) => row.status === 'completed').length}</p></div><span className="nt-caption">研发负责人 {leads}</span></header><div className={`nt-columns ${backlog.length ? '' : 'nt-full'}`}><section className="nt-section"><h4>区间任务 · {rows.length}</h4><SummaryTable rows={rows} periodId={periodId} /></section>{backlog.length > 0 && <section className="nt-section"><h4>待建任务 · {backlog.length}</h4>{backlog.map((row) => <div className="nt-backlog" key={row.id}><button className="nt-link" onClick={() => modal.open(<BacklogForm projectId={project.id} backlog={row} />)}>{row.title}</button><span className="nt-prio">{row.priority}</span></div>)}</section>}</div></article>;
  })}{!data.projects.length && <div className="nt-empty">暂无可见项目，请联系团队负责人加入项目。</div>}</>;
}

/** 项目汇总表突出执行情况，未知历史不推算为未开始或已完成。 */
function SummaryTable({ rows, periodId }: { rows: V2SummaryRow[]; periodId: string }) {
  const { data } = useWorkspace(), modal = useModal();
  return rows.length ? <div className="nt-scroll"><table className="nt-table"><thead><tr><th>任务</th><th>执行人</th><th>优先级</th><th>状态</th></tr></thead><tbody>{rows.map((row) => <tr key={row.taskId}><td><button className="nt-link" onClick={() => { const task = data.tasks.find((item) => item.id === row.taskId); modal.open(task ? <TaskEditor task={task} periodId={periodId} historicalStatus={row.status ? v2StatusLabels[row.status] : '不可还原'} /> : <TaskHistory taskId={row.taskId} />); }}>{row.title ?? '历史内容不可还原'}</button>{row.planning === 'unplanned' && <small className="v2-outside">计划外</small>}{row.historyIncomplete && <small className="v2-outside">早期历史不完整</small>}</td><td>{row.executorName ?? '历史姓名不可还原'}</td><td>{row.priority ?? '—'}</td><td><StatusBadge status={row.status} /></td></tr>)}</tbody></table></div> : <div className="nt-empty">该区间暂无安排或执行记录</div>;
}

/** 任务页默认全部未完成，日期筛选不默认隐藏积压和未来安排。 */
function ProjectTasks({ projectId }: { projectId: string }) {
  const { data } = useWorkspace(), modal = useModal(), [completed, setCompleted] = useState(false), [periodId, setPeriod] = useState('all');
  const project = data.projects.find((row) => row.id === projectId);
  const rows = data.tasks.filter((task) => task.projectId === projectId && (completed ? task.status === 'completed' : task.status !== 'completed') && (periodId === 'all' || data.arrangements.some((row) => row.taskId === task.id && row.periodId === periodId))).sort((a, b) => a.priority - b.priority);
  return <><div className="nt-tools"><div className="nt-row"><select aria-label="任务状态范围" value={completed ? 'done' : 'unfinished'} onChange={(event) => setCompleted(event.target.value === 'done')}><option value="unfinished">全部未完成</option><option value="done">已完成</option></select><PeriodSelect label="任务日期区间" periods={data.periods} value={periodId} all onChange={setPeriod} /></div><button className="nt-primary" disabled={!project?.canCreate} title={!project?.canCreate ? '仅项目经理角色可在待建任务中提出事项' : undefined} onClick={() => modal.open(<TaskCreate projectId={projectId} batch />)}>＋ 批量新增</button></div><div className="nt-project nt-scroll"><table className="nt-table"><thead><tr><th>任务名称</th><th>执行人</th><th>优先级</th><th>状态</th><th>日期区间 / 里程碑</th></tr></thead><tbody>{rows.map((task) => <tr key={task.id}><td><button className="nt-link" onClick={() => modal.open(<TaskEditor task={task} />)}>{task.title}</button></td><td>{data.accounts.find((row) => row.id === task.executorId)?.displayName ?? '历史成员'}</td><td>{task.priority}</td><td><StatusBadge status={task.status} /></td><td>{data.arrangements.filter((row) => row.taskId === task.id).map((row) => { const period = data.periods.find((item) => item.id === row.periodId); return <div className="nt-date" key={row.periodId}>{period ? periodLabel(period) : '区间不存在'}</div>; })}<span className="nt-muted">{data.milestones.find((row) => row.id === task.milestoneId)?.title ?? '未关联里程碑'}</span></td></tr>)}</tbody></table>{!rows.length && <div className="nt-empty">暂无符合条件的任务</div>}</div></>;
}
