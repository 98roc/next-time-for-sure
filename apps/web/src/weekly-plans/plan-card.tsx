import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { WeeklyArrangement, WeeklyCandidates } from '@ntfs/contracts';
import { shiftWeek, weekLabel } from '../layout/week-picker';

type Props = {
  entry: WeeklyCandidates['assignments'][number];
  arrangement: WeeklyArrangement | undefined;
  week: string;
  busy: boolean;
  onEdit: () => void;
  onMove: () => void;
  onRemove: () => void;
  children: ReactNode;
};

/** 周安排卡片按任务、执行人、可选内容和固定底部动作排列；次要调整收进更多。 */
export function PlanCard({ entry, arrangement, week, busy, onEdit, onMove, onRemove, children }: Props) {
  const details = [arrangement?.plannedDays == null ? '' : `投入 ${arrangement.plannedDays} 天`, arrangement?.expectedProgress == null ? '' : `预计新增 ${arrangement.expectedProgress}%`].filter(Boolean);
  return <article className="panel plan-card">
    <div className="plan-card-body">
      <p className="plan-card-project">{entry.projectName}</p>
      <h2><Link to={`/work?projectId=${entry.projectId}&week=${week}#task-${entry.taskId}`}>{entry.taskTitle}</Link></h2>
      <p className="plan-card-person"><strong>{entry.displayName}</strong><span>{entry.groupName}</span></p>
      {entry.content && <p>{entry.content}</p>}
      {arrangement?.goal && <p><span className="detail-meta">周目标 · </span>{arrangement.goal}</p>}
      {details.length > 0 && <p className="detail-meta">{details.join(' · ')}</p>}
      {arrangement?.sourceWeek && <p className="detail-meta">上周延续 · {arrangement.sourceWeek}</p>}
      {entry.blockedReason && <p className="form-error">阻塞：{entry.blockedReason}</p>}
    </div>
    <footer className="plan-card-actions">
      <span className="detail-meta">{arrangement ? '已安排' : '待安排'}</span>
      <button disabled={busy} className={arrangement ? 'plan-edit-button' : 'primary-button'} onClick={onEdit}>{arrangement ? '编辑安排' : `安排到${weekLabel(week)}`}</button>
      {arrangement && <details className="plan-more" name="weekly-card-actions" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }} onKeyDown={(event) => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
        <summary aria-label={`更多安排操作：${entry.taskTitle} · ${entry.displayName}`}>更多</summary>
        <div onClick={(event) => { if (event.target instanceof HTMLButtonElement) { event.currentTarget.parentElement?.removeAttribute('open'); event.currentTarget.parentElement?.querySelector('summary')?.focus(); } }}>
          <button disabled={busy} onClick={onMove}>移至{weekLabel(shiftWeek(week, 1))}</button>
          <button disabled={busy} onClick={onRemove}>移回待安排</button>
        </div>
      </details>}
    </footer>
    {children}
  </article>;
}
