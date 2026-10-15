import { shiftWeek, weekLabel } from '../layout/week-picker';
import { groupPlanEntries, planStatus } from './plan-view';
import type { PlanEntry, PlanGrouping } from './plan-view';

type Props = {
  entries: PlanEntry[]; grouping: PlanGrouping; week: string; busy?: boolean; editable?: boolean;
  onOpenTask?: (projectId: string, taskId: string) => void;
  onEdit?: (entry: PlanEntry, week: string) => void;
  onMove?: (entry: PlanEntry) => void;
  onRemove?: (entry: PlanEntry) => void;
};

/** 单周紧凑任务列表；项目视图合并标题，小组和个人视图只重组当前可见的分工。 */
export function PlanList(props: Props) {
  const { entries, grouping, onOpenTask } = props;
  return <div className="plan-groups">{groupPlanEntries(entries, grouping).map((group) => <section className="plan-group" key={group.id}>
    <header className="section-heading"><h2>{group.title}</h2><span className="detail-meta">{group.tasks.length} 项任务</span></header>
    <div className="plan-task-list">{group.tasks.map((task) => {
      const active = task.entries.filter((entry) => !entry.stopped);
      const stopped = task.entries.filter((entry) => entry.stopped);
      return <article className="plan-task" key={task.id}>
        <header className="plan-task-heading"><div>{grouping !== 'project' && <p className="detail-meta">{task.projectName}</p>}<h3>{task.taskId && props.editable ? <button className="text-button" title="查看任务与分工" onClick={() => { if (task.taskId) onOpenTask?.(task.projectId, task.taskId); }}>{task.title}</button> : task.title}</h3></div></header>
        <div className="plan-task-people">
        {active.map((entry) => <PlanPersonRow key={entry.key} {...props} entry={entry} />)}
        {stopped.length > 0 && <details className="plan-stopped"><summary>已完成／停止 · {stopped.length} 项记录</summary>{stopped.map((entry) => <PlanPersonRow key={entry.key} {...props} entry={entry} />)}</details>}
        </div>
      </article>;
    })}</div>
  </section>)}</div>;
}

/** 每人一行，周目标与任务分工分开标注；跨周操作明确区分继续与移走。 */
function PlanPersonRow({ entry, week, busy, editable, onEdit, onMove, onRemove }: Props & { entry: PlanEntry }) {
  const next = shiftWeek(week, 1);
  const arrangement = entry.arrangement;
  const details = [entry.plannedDays === null ? '' : `投入 ${entry.plannedDays} 天`, arrangement?.expectedProgress == null ? '' : `预计新增 ${arrangement.expectedProgress}%`].filter(Boolean);
  return <div className={`plan-person-row ${entry.stopped ? 'is-stopped' : ''}`}>
    <div className="plan-person-name"><strong>{entry.person}</strong><span className="detail-meta">{entry.groupName}</span></div>
    <div className="plan-person-content">
      {entry.candidate?.content && <p>{entry.candidate.content}</p>}
      {arrangement?.goal ? <p><span className="detail-meta">周目标 · </span>{arrangement.goal}</p> : !arrangement && entry.text ? <p>{entry.text}</p> : null}
      {details.length > 0 && <p className="detail-meta">{details.join(' · ')}</p>}
      {arrangement?.sourceWeek && <p className="detail-meta">上周延续 · {arrangement.sourceWeek}</p>}
      <p className="detail-meta">{planStatus(entry.status)}</p>
      {entry.candidate?.blockedReason && <p className="form-error">阻塞：{entry.candidate.blockedReason}</p>}
    </div>
    {editable && <div className="plan-person-actions">
      {entry.candidate && !entry.stopped && <button disabled={busy} onClick={() => onEdit?.(entry, week)}>{arrangement ? '编辑' : `安排到${weekLabel(week)}`}</button>}
      {(arrangement || entry.pending) && <details className="plan-more" name="weekly-row-actions" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }} onKeyDown={(event) => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
        <summary aria-label={`更多安排操作：${entry.title} · ${entry.person}`}>更多</summary>
        <div onClick={(event) => { if (event.target instanceof HTMLButtonElement) event.currentTarget.closest('details')?.removeAttribute('open'); }}>
          {entry.candidate && !entry.stopped && <><button disabled={busy} onClick={() => onEdit?.(entry, next)}>{weekLabel(next)}继续做</button><button disabled={busy} onClick={() => onMove?.(entry)}>移至{weekLabel(next)}</button></>}
          <button disabled={busy} onClick={() => onRemove?.(entry)}>移出{weekLabel(week)}</button>
        </div>
      </details>}
    </div>}
  </div>;
}
