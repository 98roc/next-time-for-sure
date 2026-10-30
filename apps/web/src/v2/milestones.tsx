import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { V2Milestone } from '@ntfs/contracts';
import { useWorkspace } from './workspace';
import { ModalPage, useModal } from './modal';
import { useProjectSort } from './project-sort';
import { MilestoneForm } from './milestone-form';
import { MilestoneDetail } from './milestone-detail';
import { Deadline, MilestoneStatus, MilestoneIcon } from './milestone-parts';
import './milestones.css';
import { MilestoneRoadmap } from './milestone-roadmap';
import { MilestoneModeControl } from './milestone-mode';

export { MilestoneDetail } from './milestone-detail';

/** 所有总览入口复用项目页共享顺序，只在独立页面展示。 */
export function MilestoneOverview() {
  const { data } = useWorkspace();
  const sort = useProjectSort(data.projects.map((row) => row.id), 'projects');
  return <div className="v2-milestone-overview">{sort.ids.map((id) => <MilestonePanel key={id} projectId={id} overview />)}{!data.projects.length && <p className="v2-context">暂无可见项目</p>}</div>;
}

/** 截止日期为主轴，同日目标纵向排列；未规划有数据才显示，首次进入默认折叠。 */
export function MilestonePanel({ projectId, overview = false }: { projectId: string; overview?: boolean }) {
  const { data } = useWorkspace(), modal = useModal();
  const [expanded, setExpanded] = useState(false), unplannedId = useId();
  const project = data.projects.find((row) => row.id === projectId);
  if (!project) return null;
  const rows = data.milestones.filter((row) => row.projectId === projectId);
  const cutoff = data.naturalWeekStart, old = rows.filter((row) => row.expectedOn && row.expectedOn < cutoff);
  const planned = rows.filter((row) => row.expectedOn && row.expectedOn >= cutoff), unplanned = rows.filter((row) => !row.expectedOn);
  const dates = [...new Set(planned.flatMap((row) => row.expectedOn ? [row.expectedOn] : []))].sort();
  const nearest = dates.flatMap((date) => planned.filter((row) => row.expectedOn === date)).find((row) => row.status === 'open');
  const oldUnfinished = old.filter((row) => row.status === 'open').length;
  return <section className={`v2-milestone-panel${!rows.length ? ' is-empty' : ''}`} aria-label={`${project.name}里程碑`}>
    <header className="v2-ms-heading"><div className="v2-ms-project-label"><h3 className="v2-ms-project-title">{overview ? <Link to={`/work?${new URLSearchParams({ project: projectId, tab: 'milestones' })}`} onClick={() => modal.close()}>{project.name}<MilestoneIcon name="right" /></Link> : '阶段路线'}</h3>{!rows.length && <span className="v2-ms-count">暂无里程碑</span>}</div><div className="v2-actions">
      {!overview && <MilestoneModeControl />}
      {old.length > 0 && <button className="v2-ms-history-button" onClick={() => modal.push(<MilestoneHistory projectId={projectId} cutoff={cutoff} />)}><MilestoneIcon name="history" />历史 {old.length}{oldUnfinished > 0 && ` · ${oldUnfinished} 项未完成`}</button>}
      {project.canManage && <button onClick={() => modal.push(<MilestoneForm projectId={projectId} />)}><MilestoneIcon name="plus" />新增目标</button>}
    </div></header>
    {rows.length > 0 && <><p className="v2-ms-count"><strong>已规划</strong> {planned.length} 项目标</p>
    {dates.length ? <MilestoneRoadmap mode={data.personalPreferences.milestoneMode}>{dates.map((date) => {
      const targets = planned.filter((row) => row.expectedOn === date);
      return <section className={`v2-ms-stage${date === nearest?.expectedOn ? ' is-next' : ''}`} key={date} aria-label={`${date}截止`} data-milestone-stage>
        <div className="v2-ms-date"><Deadline date={date} today={data.today} completed={targets.every((row) => row.status === 'completed')} count={targets.length} /></div>
        <span className="v2-ms-node" data-milestone-node aria-hidden="true" />
        <div className="v2-ms-branch">{targets.map((row) => <MilestoneCard key={row.id} milestone={row} nearest={row.id === nearest?.id} />)}</div>
      </section>;
    })}</MilestoneRoadmap> : <p className="v2-ms-empty">暂无已规划目标</p>}
    {unplanned.length > 0 && <section className="v2-ms-unplanned" aria-label="未规划里程碑">
      <button className="v2-ms-toggle" aria-expanded={expanded} aria-controls={unplannedId} onClick={() => setExpanded(!expanded)}><span><MilestoneIcon name="calendar" />未规划 <span className="v2-ms-count">{unplanned.length}</span></span><span>{expanded ? '收起' : '展开'}<MilestoneIcon name={expanded ? 'up' : 'down'} /></span></button>
      <div id={unplannedId} hidden={!expanded}><ul className="v2-ms-rows">{unplanned.map((row) => <li key={row.id}><button className="v2-ms-link" onClick={() => modal.push(<MilestoneDetail milestoneId={row.id} />)}>{row.title}</button><MilestoneStatus milestone={row} />{project.canManage && <button className="v2-ms-set-date" onClick={() => modal.push(<MilestoneForm projectId={projectId} milestone={row} focusDate />)}><MilestoneIcon name="calendar-plus" />设置日期</button>}</li>)}</ul></div>
    </section>}
    </>}
  </section>;
}

/** 总览只展示判断所需信息，关联任务及完成操作集中到详情。 */
function MilestoneCard({ milestone, nearest }: { milestone: V2Milestone; nearest: boolean }) {
  const { data } = useWorkspace(), modal = useModal();
  const tasks = data.tasks.filter((row) => row.milestoneId === milestone.id);
  return <article className={`v2-ms-card${milestone.status === 'completed' ? ' is-complete' : ''}`}>
    <div className="v2-ms-card-meta"><MilestoneStatus milestone={milestone} />{nearest && <span className="v2-ms-nearest">最近截止</span>}</div>
    <h4><button className="v2-ms-link" onClick={() => modal.push(<MilestoneDetail milestoneId={milestone.id} />)}>{milestone.title}</button></h4>
    <footer><span>{tasks.length ? `关联任务 ${tasks.filter((row) => row.status === 'completed').length} / ${tasks.length} 已完成` : '未关联任务'}</span><button className="v2-ms-link" aria-label={`查看详情：${milestone.title}`} onClick={() => modal.push(<MilestoneDetail milestoneId={milestone.id} />)}>查看详情 →</button></footer>
    {milestone.needsReview && <p className="v2-ms-warning">关联任务有回退，待核验</p>}
  </article>;
}

/** 历史每页十条；详情返回后保留页码，数据变化时收敛到有效页。 */
function MilestoneHistory({ projectId, cutoff }: { projectId: string; cutoff: string }) {
  const { data } = useWorkspace(), modal = useModal(), [page, setPage] = useState(0);
  const rows = data.milestones.filter((row) => row.projectId === projectId && row.expectedOn !== null && row.expectedOn < cutoff).sort((a, b) => (b.expectedOn ?? '').localeCompare(a.expectedOn ?? '') || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(rows.length / 10)), current = Math.min(page, pages - 1);
  return <ModalPage title={`${data.projects.find((row) => row.id === projectId)?.name ?? ''} / 历史里程碑`} className="v2-ms-modal" closeLabel="关闭" hideCloseAction footerNote={<span className="v2-ms-footer-note">共 {rows.length} 项 · 每页 10 项</span>} actions={<><button disabled={current === 0} onClick={() => setPage(current - 1)}>上一页</button><span className="v2-ms-count">第 {current + 1} / {pages} 页</span><button disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>下一页</button></>}>
    <h3 className="v2-ms-title">历史里程碑</h3>
    <p className="v2-context">{data.projects.find((row) => row.id === projectId)?.name} · {cutoff} 之前 · {rows.length} 项 · {rows.filter((row) => row.status !== 'completed').length} 项未完成</p>
    <div className="v2-ms-history">{rows.slice(current * 10, current * 10 + 10).map((row) => {
      const tasks = data.tasks.filter((task) => task.milestoneId === row.id);
      return <button className="v2-ms-history-row" key={row.id} aria-label={row.title} onClick={() => modal.push(<MilestoneDetail milestoneId={row.id} />)}><span><strong>{row.title}</strong><small>截止 {row.expectedOn} · 关联任务 {tasks.filter((task) => task.status === 'completed').length} / {tasks.length}</small></span><MilestoneStatus milestone={row} /><MilestoneIcon name="right" /></button>;
    })}</div>
    {!rows.length && <p className="v2-ms-empty">暂无记录</p>}
  </ModalPage>;
}
