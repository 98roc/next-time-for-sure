import { useState } from 'react';
import type { OrganizationSnapshot, PublicationRow } from '@ntfs/contracts';
import { PlanList } from './plan-list';
import { planCounts, publicationPlanEntries } from './plan-view';
import type { PlanGrouping } from './plan-view';

/** 三种维度共用显式切换，不将显示分组解释为另一份任务。 */
export function PlanGroupingControl({ value, onChange }: { value: PlanGrouping; onChange: (value: PlanGrouping) => void }) {
  return <div className="plan-grouping" role="group" aria-label="查看维度"><button aria-pressed={value === 'project'} onClick={() => onChange('project')}>按项目</button><button aria-pressed={value === 'group'} onClick={() => onChange('group')}>按小组</button><button aria-pressed={value === 'person'} onClick={() => onChange('person')}>按个人</button></div>;
}

/** 草稿汇总、历史副本和发布确认复用同一紧凑只读视图，初始按项目聚合。 */
export function PlanSummary({ rows, organization, week }: { rows: PublicationRow[]; organization: Pick<OrganizationSnapshot, 'groups'>; week: string }) {
  const [grouping, setGrouping] = useState<PlanGrouping>('project');
  const [query, setQuery] = useState('');
  const entries = publicationPlanEntries(rows, organization);
  const term = query.trim().toLocaleLowerCase();
  const filtered = entries.filter((entry) => `${entry.title} ${entry.projectName} ${entry.person} ${entry.groupName} ${entry.text}`.toLocaleLowerCase().includes(term));
  const counts = planCounts(filtered);
  return <div className="plan-summary">
    <div className="plan-display-toolbar">
      <PlanGroupingControl value={grouping} onChange={setGrouping} />
      <p className="plan-counts detail-meta">{term && '筛选 · '}{counts.tasks} 项任务 · {counts.people} 项人员安排{counts.pending > 0 && ` · ${counts.pending} 项待分配`}</p>
      <label className="plan-summary-search"><span className="sr-only">搜索汇总</span><input type="search" placeholder="搜索任务、人员或项目" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    </div>
    <PlanList entries={filtered} grouping={grouping} week={week} />
    {!filtered.length && <p className="empty-state">{term ? '没有匹配的安排，请调整搜索。' : '这一周暂无安排。'}</p>}
  </div>;
}
