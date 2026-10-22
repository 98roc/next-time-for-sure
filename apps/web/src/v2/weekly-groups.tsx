import { useRef, useState } from 'react';
import { v2StatusLabels, type V2WeeklyState } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { useModal } from './modal';
import { Feedback, periodLabel, priorityLabels, PlanningBadge, StatusBadge } from './controls';
import { TaskCreate } from './task-create';
import { TaskEditor, TaskHistory } from './task-editor';
import { ExistingTasks } from './planning-dialogs';
import { usePointerSort } from './drag';
import { OrderMenu } from './order-menu';
import { useSortFeedback } from './sort-feedback';
import { buildWeeklyRows, estimates } from './weekly-rows';

/** 项目和人员视角共享排序，人员筛选重排只替换该人的可见位置。 */
export function WeeklyGroups({ state, filter, view, sorting }: { state: V2WeeklyState; filter: string; view: 'project' | 'people'; sorting: boolean }) {
  const { data, run } = useWorkspace(), modal = useModal(), action = useSortFeedback(), root = useRef<HTMLDivElement>(null);
  const [expandedEmpty, setExpandedEmpty] = useState<Set<string>>(() => new Set());
  const rows = buildWeeklyRows(data, state), projectIds = action.ordered('projects', state.projectOrder.ids, (id) => id).filter((id) => filter === 'all' || id === filter);
  function scope(side: 'summary' | 'plan', projectId: string, person?: string) { return `${side}|${projectId}|${person ?? ''}`; }
  function ordered(side: 'summary' | 'plan', projectId: string, person?: string) { return action.ordered(scope(side, projectId, person), rows.ordered(side, projectId, person), (row) => row.id); }
  function orderIds(key: string): string[] { if (key === 'projects') return projectIds; const [side, projectId, person] = key.split('|'); return (side === 'summary' || side === 'plan') && projectId ? ordered(side, projectId, person || undefined).map((row) => row.id) : []; }
  function move(id: string, key: string, beforeId: string | null) {
    const original = orderIds(key), ids = original.filter((value) => value !== id), index = beforeId === null ? ids.length : ids.indexOf(beforeId); if (index < 0 || !original.includes(id)) return;
    ids.splice(index, 0, id); if (ids.join() === original.join()) return;
    action.save(key, ids, async () => {
      if (key === 'projects') await run('planning', { action: 'reorder_projects', periodId: state.summaryPeriod.id, operationId: createOperationId(), version: state.projectOrder.version, projectIds: ids });
      else {
        const [side, projectId, executorId] = key.split('|'); if ((side !== 'summary' && side !== 'plan') || !projectId || executorId === 'unknown') return;
        const periodId = side === 'summary' ? state.summaryPeriod.id : state.planPeriod.id;
        const order = state.taskOrders.find((row) => row.projectId === projectId && row.periodId === periodId); if (!order) return;
        await run('planning', { action: 'reorder_tasks', operationId: createOperationId(), view: side, projectId, periodId, version: order.version, taskIds: ids, ...(executorId ? { executorId } : {}) });
      }
    });
  }
  function reset(side: 'summary' | 'plan', projectId: string) {
    const periodId = side === 'summary' ? state.summaryPeriod.id : state.planPeriod.id;
    const order = state.taskOrders.find((row) => row.projectId === projectId && row.periodId === periodId);
    if (!order) return;
    action.save('reset', null, () => run('planning', {
      action: 'reorder_tasks', reset: true, view: side, projectId, periodId,
      operationId: createOperationId(), version: order.version, taskIds: [],
    }));
  }
  const drag = usePointerSort({ root, move: (id, key, target) => move(id, key, target.beforeId) });
  // 保存期间拦截重复操作，但不禁用正在聚焦的按钮，便于保存后继续键盘排序。
  function handle(id: string, key: string, title: string, allowed: boolean, compact = false) {
    return <button className={compact ? 'w-project-sort-handle' : 'w-drag'} aria-label={`拖动排序：${title}；也可用上下方向键`} disabled={!allowed} aria-disabled={!allowed || action.busy} onPointerDown={(event) => { if (allowed && !action.busy) drag.start(event, id, key); }} onKeyDown={(event) => { if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); if (!allowed || action.busy) return; const ids = orderIds(key), index = ids.indexOf(id); if (event.key === 'ArrowUp' && index > 0) move(id, key, ids[index - 1] ?? null); else if (event.key === 'ArrowDown' && index < ids.length - 1) move(id, key, ids[index + 2] ?? null); }}>⠿{compact && <><span>{title}</span></>}</button>;
  }
  function resetMenu(side: 'summary' | 'plan', projectId: string, person?: string) {
    const allowed = data.projects.find((row) => row.id === projectId)?.canManage && person !== 'unknown';
    const periodId = side === 'summary' ? state.summaryPeriod.id : state.planPeriod.id;
    const order = state.taskOrders.find((row) => row.projectId === projectId && row.periodId === periodId);
    return allowed && (ordered(side, projectId, person).length > 1 || order?.manual) && <OrderMenu label={`${side === 'summary' ? '总结' : '计划'}任务排序选项`} scope="本项目整个日期区间，包含其他人员" disabled={action.busy || !order?.manual} onReset={() => reset(side, projectId)} />;
  }
  function taskList(side: 'summary' | 'plan', projectId: string, person?: string) {
    const selected = ordered(side, projectId, person), key = scope(side, projectId, person), allowed = Boolean(data.projects.find((row) => row.id === projectId)?.canManage) && person !== 'unknown';
    return <><div className="w-task-list" data-sort-scope={key}>{selected.map((row) => <div key={row.id}><div className="w-task-row" data-sort-id={row.id}>{handle(row.id, key, row.title, allowed)}<div className="w-task-info"><button className="w-task-title" onClick={() => { const task = data.tasks.find((item) => item.id === row.id); modal.open(task ? <TaskEditor task={task} {...(side === 'summary' ? { historicalStatus: row.status ? v2StatusLabels[row.status] : '不可还原' } : {})} /> : <TaskHistory taskId={row.id} />); }}>{row.title}</button><div className="w-task-meta"><StatusBadge status={row.status} />{side === 'summary' ? <>{row.planning === 'unplanned' && <PlanningBadge>计划外</PlanningBadge>}{row.planning === 'unknown' && <PlanningBadge>计划性不可还原</PlanningBadge>}{row.incomplete && <span>早期历史不完整</span>}</> : <span title={`优先级 ${row.priority ?? 3}`}>{priorityLabels[(row.priority ?? 3) - 1]}</span>}</div></div>{person === undefined && <span className="w-task-person">{row.executorName}</span>}{side === 'plan' && <span className="w-task-days">{row.days === null ? '未估算' : `${row.days} 天`}</span>}</div></div>)}{!selected.length && <div className="w-empty">{side === 'summary' ? '该区间暂无任务记录' : '暂无安排，可选择已有任务或批量新增'}</div>}</div></>;
  }
  /** 空项目行和展开后的计划栏共用入口，权限提示保持一致。 */
  function planActions(projectId: string) {
    const project = data.projects.find((row) => row.id === projectId);
    return <div className="w-plan-actions"><button className="w-button" disabled={!project?.canManage} title={!project?.canManage ? '仅团队负责人或本项目研发负责人可调整已有任务安排' : undefined} onClick={() => modal.open(<ExistingTasks projectId={projectId} periodId={state.planPeriod.id} />)}>选择已有任务</button><button className="w-button primary" disabled={!project?.canCreate} title={!project?.canCreate ? '仅项目经理角色请在待建任务中提出事项' : undefined} onClick={() => modal.open(<TaskCreate projectId={projectId} periodId={state.planPeriod.id} batch />)}>＋ 批量新增</button></div>;
  }
  function column(side: 'summary' | 'plan', projectId: string) {
    const selected = ordered(side, projectId);
    return <div className="w-column"><span className="w-column-date">{side === 'summary' ? '总结' : '安排'} · {periodLabel(side === 'summary' ? state.summaryPeriod : state.planPeriod)}</span><div className="w-column-head"><div className="w-column-heading"><h3>{side === 'summary' ? '任务完成情况' : '任务安排'}</h3>{side === 'plan' && planActions(projectId)}</div><div className="w-row"><span className="w-small w-muted">{side === 'summary' ? `${selected.length} 项 · 已完成 ${selected.filter((row) => row.status === 'completed').length}` : estimates(selected)}</span>{resetMenu(side, projectId)}</div></div>{taskList(side, projectId)}</div>;
  }
  /** 无任务项目保留安排入口；新增后自动展开，不让旧折叠状态隐藏任务。 */
  function projectGroup(id: string) {
    const project = data.projects.find((row) => row.id === id);
    if (!project) return null;
    const empty = !ordered('summary', id).length && !ordered('plan', id).length;
    const expanded = !empty || expandedEmpty.has(id);
    function toggle() {
      setExpandedEmpty((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    }
    return <div key={id}>
      <section className={`w-project ${sorting ? 'is-sorting' : empty ? 'is-empty' : ''}`} data-sort-id={id}>
        {sorting ? handle(id, 'projects', project.name, data.teamLeader, true) : <>
          <header className="w-project-head">
            <div className="w-row">
              {handle(id, 'projects', project.name, data.teamLeader)}<h2>{project.name}</h2>
              {empty && <button className="w-empty-project-toggle" aria-expanded={expanded} aria-label={`${expanded ? '收起' : '展开'}${project.name}的任务区域`} onClick={toggle}>
                <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>两个区间暂无任务
              </button>}
            </div>
            {empty && !expanded && planActions(id)}
          </header>
          {expanded && <div className="w-columns">{column('summary', id)}{column('plan', id)}</div>}
        </>}
      </section>
    </div>;
  }
  const people = [...new Set([...rows.summary, ...rows.plan].filter((row) => projectIds.includes(row.projectId)).map((row) => row.executorId ?? 'unknown'))];
  return <div ref={root}><Feedback error={action.error} />{view === 'project' ? <div data-sort-scope="projects">{projectIds.map(projectGroup)}</div> : people.map((person) => <section className="w-project" key={person}><header className="w-person-head"><div className="w-row"><span className="w-avatar">{(data.accounts.find((row) => row.id === person)?.displayName ?? '历').slice(0, 1)}</span><h2>{data.accounts.find((row) => row.id === person)?.displayName ?? rows.summary.find((row) => row.executorId === person)?.executorName ?? '历史成员'}</h2></div></header><div className="w-columns">{(['summary', 'plan'] satisfies Array<'summary' | 'plan'>).map((side) => { const selected = projectIds.flatMap((id) => ordered(side, id, person)); return <div className="w-column" key={side}><span className="w-column-date">{periodLabel(side === 'summary' ? state.summaryPeriod : state.planPeriod)}</span><h3>{side === 'summary' ? '任务完成情况' : '任务安排'}</h3><p className="w-person-totals">{side === 'plan' ? estimates(selected) : `已完成 ${selected.filter((row) => row.status === 'completed').length} 项 · 进行中 ${selected.filter((row) => row.status === 'in_progress').length} 项`}</p>{projectIds.filter((id) => selected.some((row) => row.projectId === id)).map((id) => <div key={id}><div className="v2-section-heading"><h3 className="w-person-project">{data.projects.find((row) => row.id === id)?.name}</h3>{resetMenu(side, id, person)}</div>{taskList(side, id, person)}</div>)}{!selected.length && <div className="w-empty">该区间暂无任务</div>}</div>; })}</div></section>)}{(view === 'project' ? projectIds.length : people.length) === 0 && <div className="w-empty">所选区间暂无可见安排</div>}</div>;
}
