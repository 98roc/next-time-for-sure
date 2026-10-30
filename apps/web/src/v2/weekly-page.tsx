import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { useModal } from './modal';
import { readWeekly } from './api';
import { currentPeriod, Feedback, PeriodSelect, useAction } from './controls';
import { PeriodEditor } from './planning-dialogs';
import { WeeklyReport } from './weekly-report';
import { WeeklyGroups } from './weekly-groups';
import { OrderMenu } from './order-menu';
import { useMilestoneNavigation } from './milestone-navigation';
import { TeamFilter } from './team-filter';

/** 两侧日期按维护后的顺序联动；边界扩展只补目录，不结转或复制任务。 */
export function WeeklyPageV2() {
  const { data, user, run } = useWorkspace(), modal = useModal(), action = useAction(), openMilestones = useMilestoneNavigation();
  const [pair, setPair] = useState(() => { const id = currentPeriod(data.periods, data.today), index = data.periods.findIndex((row) => row.id === id); return { summary: id, plan: data.periods[index + 1]?.id ?? '' }; });
  const [view, setView] = useState<'project' | 'people'>('project'), [filter, setFilter] = useState('all'), [sorting, setSorting] = useState(false);
  const query = useQuery({ queryKey: ['v2', 'weekly', user.id, user.isSuperAdmin, data.team?.id, pair.summary, pair.plan], queryFn: () => readWeekly(pair.summary, pair.plan, data.team?.id), enabled: Boolean(pair.summary && pair.plan), refetchInterval: 10000 });
  const order = view === 'project' ? query.data?.projectOrder : query.data?.peopleOrder;
  /** 恢复当前视角的团队顺序，作用于所有周期，保留另一个视角的顺序。 */
  function resetOrder() {
    if (!order) return;
    void action.act(() => run('planning', view === 'project'
      ? { action: 'reorder_projects', page: 'weekly', reset: true, operationId: createOperationId(), version: order.version, projectIds: [] }
      : { action: 'reorder_people', reset: true, operationId: createOperationId(), version: order.version, executorIds: [] }));
  }
  async function select(side: 'summary' | 'plan', id: string) {
    const index = data.periods.findIndex((row) => row.id === id); if (index < 0) return;
    let adjacent = data.periods[index + (side === 'summary' ? 1 : -1)]?.id;
    if (!adjacent) {
      const result = await run('planning', { action: 'extend_periods', operationId: createOperationId(), direction: side === 'summary' ? 'after' : 'before', version: data.teamVersion }); adjacent = result.objectIds[0];
    }
    if (adjacent) setPair(side === 'summary' ? { summary: id, plan: adjacent } : { summary: adjacent, plan: id });
  }
  return <><header className="w-heading"><div><h1>周报与周计划</h1><p className="w-subtitle">按项目回顾工作，协调每个人的安排。</p></div><div className="w-row"><TeamFilter /><button className="w-button" onClick={() => modal.open(<PeriodEditor />)}>日期区间</button><button className="w-button primary" disabled={!query.data} onClick={() => modal.open(<WeeklyReport summaryId={pair.summary} planId={pair.plan} />)}>文字版{query.data?.text.stale ? ' · 待同步' : ''}</button><button className="w-button" onClick={() => openMilestones()}>里程碑</button></div></header>
    <div className="w-toolbar"><div className="w-row"><div className="w-segment" role="group" aria-label="查看视角"><button aria-pressed={view === 'project'} onClick={() => { setView('project'); setSorting(false); }}>按项目</button><button aria-pressed={view === 'people'} onClick={() => { setView('people'); setSorting(false); }}>按人员</button></div>
      {data.teamLeader && <button className={`w-button ${sorting ? 'primary' : ''}`} aria-pressed={sorting} onClick={() => setSorting(!sorting)}>{sorting ? '完成排序' : view === 'project' ? '项目排序' : '人员排序'}</button>}
      {sorting && data.teamLeader && order && <OrderMenu label={view === 'project' ? '项目排序选项' : '人员排序选项'} scope={`周报与周计划所有周期的全部${view === 'project' ? '项目' : '人员'}`} disabled={action.busy || !order.manual} onReset={resetOrder} />}
    </div><label className="w-filter"><select aria-label="筛选项目" disabled={sorting} value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">全部项目</option>{data.projects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label></div>
    <Feedback error={action.error} /><div className="w-periods"><label className="w-field">工作总结 · 总结区间<PeriodSelect label="总结区间" periods={data.periods} value={pair.summary} disabled={action.busy} onChange={(id) => { void action.act(() => select('summary', id)); }} /></label><label className="w-field">工作安排 · 计划区间<PeriodSelect label="计划区间" periods={data.periods} value={pair.plan} disabled={action.busy} onChange={(id) => { void action.act(() => select('plan', id)); }} /></label></div>
    {query.error && <Feedback error={query.error.message} />}{query.isPending && pair.plan && <p role="status">正在读取执行事实和任务安排…</p>}{!data.team && <div className="w-empty">加入团队后可查看周报与周计划。</div>}
    {query.data && <WeeklyGroups key={`${pair.summary}:${pair.plan}`} state={query.data} filter={sorting ? 'all' : filter} view={view} sorting={sorting} />}
  </>;
}
