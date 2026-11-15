import { PersonalWelcome } from './personal-welcome';
import { useState } from 'react';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { useModal, ModalPage } from './modal';
import { Feedback, PeriodSelect, priorityLabels, useAction } from './controls';
import { TaskCreate } from './task-create';
import { TaskEditor } from './task-editor';
import { TaskCompletion, taskCompletion } from './task-results';
import { CategoryForm } from './category-dialogs';
import { usePersonalBoard } from './personal-board';
import { PersonalCategoryMenu } from './personal-category-menu';
import { usePersonalPeriodFilter } from './personal-period-filter';
import { SubtasksDialog } from './subtasks-dialog';
import { DailyReport } from './daily-report';
import { DateNavigator, useCompletedFilter } from './personal-completed';
import './personal-work.css';
import './board-drag.css';

const defaultDescription = '新分配任务和其他入口的状态变化，进入对应状态的默认分类，按默认排序排列；已手动排序的分类中新任务置顶。手动选择优先；更换默认分类不搬动已有任务。';

/** 本人项目与个人任务共用看板，按分类适用周期安排或实际完成日期筛选。 */
export function PersonalPageV2() {
  const { data, user, run } = useWorkspace(), modal = useModal(), action = useAction();
  const board = usePersonalBoard(), completed = useCompletedFilter(), busy = action.busy || completed.busy || Boolean(board.pending) || board.drag.active;
  const periodFilter = usePersonalPeriodFilter();
  const [search, setSearch] = useState(''), [source, setSource] = useState('all');
  const own = data.tasks.filter((task) => task.executorId === user.id).map((task) => {
    if (board.pending?.kind !== 'task' || board.pending.id !== task.id) return task;
    const category = board.categories.find((row) => row.id === board.pending?.scope);
    return category ? { ...task, status: category.status, completedAt: category.status === 'completed' && task.status !== 'completed' ? new Date().toISOString() : task.completedAt } : task;
  });
  const visible = own.filter((task) => {
    if (!task.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) return false;
    if (source !== 'all' && (source === 'private' ? task.kind !== 'private' : task.projectId !== source)) return false;
    return completed.includes(task);
  });
  const visibleById = new Map(visible.map((task) => [task.id, task]));

  // 计数和卡片共用同一份列级结果；排序和移动仍使用看板的全量位置。
  const columns = board.categories.map((category) => {
    const periodId = periodFilter.periodFor(category);
    const placements = board.placements.filter((row) => row.categoryId === category.id).sort((a, b) => a.position - b.position);
    const tasks = placements.flatMap(({ taskId }) => {
      const task = visibleById.get(taskId);
      return task && periodFilter.includes(task, periodId) ? [task] : [];
    });
    return { category, periodId, tasks };
  });
  const visibleCount = columns.reduce((total, column) => total + column.tasks.length, 0);
  return <>
    <header className="mw-heading"><PersonalWelcome name={user.displayName} messages={data.teamMessages} /><div className="mw-actions"><button className="mw-quiet" onClick={() => modal.open(<DailyReport />)}><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M4 2h6l3 3v9H3V2Z" /><path d="M9 2v4h4M5 9h6M5 12h4" /></svg>我的日报</button><button className="mw-quiet" onClick={() => modal.open(<CategoryForm />)}>＋ 新增分类</button><button className="mw-primary" onClick={() => modal.open(<TaskCreate personal />)}>＋ 新建任务</button></div></header>
    <div className="mw-toolbar"><label className="mw-search">⌕<input aria-label="搜索任务" placeholder="搜索任务名称" value={search} onChange={(event) => setSearch(event.target.value)} /></label><select aria-label="筛选任务来源" value={source} onChange={(event) => setSource(event.target.value)}><option value="all">全部项目与个人任务</option><option value="private">仅个人任务</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><button disabled={busy} onClick={() => { void action.act(() => run('personal', { action: 'reset_order', operationId: createOperationId(), version: data.personalVersion })); }}>恢复默认排序</button></div>
    <Feedback error={action.error || completed.error || board.error} /><div className="mw-board-meta"><span>{visibleCount} 项任务</span><span role="status">{board.pending ? '正在保存…' : ''}</span></div>
    <div className="mw-board" ref={board.root} aria-label="任务分类看板" aria-busy={Boolean(board.pending)}>{columns.map(({ category, periodId, tasks }, categoryIndex) => {
      return <section key={category.id} className="mw-column" data-category-id={category.id} data-task-scope={category.id} data-status={category.status === 'in_progress' ? 'doing' : category.status === 'completed' ? 'done' : 'todo'}>
        <div className="mw-col-head">
          <h2 className="mw-category-title"><button className="mw-category-handle" aria-disabled={busy} aria-label={`拖动分类：${category.name}；方向键调整顺序`} title="拖动分类标题排序，也可用方向键" onPointerDown={(event) => { if (!action.busy) board.drag.start(event, 'category', category.id); }} onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault(); if (busy) return;
            const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
            if ((backwards && categoryIndex === 0) || (!backwards && categoryIndex === board.categories.length - 1)) return;
            board.move({ kind: 'category', id: category.id, scope: 'categories', beforeId: board.categories[categoryIndex + (backwards ? -1 : 2)]?.id ?? null });
          }}><span className="mw-category-grip" aria-hidden="true">⠿</span><span className="mw-dot" />{category.name}</button>{category.isDefault && <button className="mw-default" title={defaultDescription} onClick={() => modal.open(<ModalPage title="默认分类"><p>{defaultDescription}</p></ModalPage>)}>默认</button>}</h2>
          <span className="mw-count">{tasks.length}</span><PersonalCategoryMenu category={category} busy={busy} action={action} completed={completed} periodFilterEnabled={periodId !== null} onTogglePeriod={() => periodFilter.toggle(category)} />
        </div>
        {category.status === 'completed' && <div className="mw-period"><span>{completed.mode === 'day' ? '完成日期' : '完成日期区间'}</span>{completed.mode === 'day' ? <DateNavigator value={completed.date} today={data.today} onChange={completed.setDay} label="完成日期" disabled={busy} /> : own.some((row) => row.status === 'completed' && row.completedAt === null) ? <select aria-label="完成日期区间" value={completed.selectedPeriod} onChange={(event) => completed.setPeriodId(event.target.value)}><option value="all">全部完成记录</option><option value="unknown">完成日期不可还原</option>{data.periods.map((row) => <option key={row.id} value={row.id}>{row.startOn} — {row.endOn}</option>)}</select> : <PeriodSelect label="完成日期区间" periods={data.periods} value={completed.selectedPeriod} all onChange={completed.setPeriodId} />}</div>}
        {periodId !== null && <div className="mw-period">
          <span>项目周期</span>
          <PeriodSelect label={`${category.name}项目周期`} periods={data.periods} value={periodId} disabled={busy || !data.periods.length} all onChange={(id) => periodFilter.select(category.id, id)} />
        </div>}
        <div className="mw-card-list">{tasks.map((task) =>
          <article key={task.id} className="mw-task" data-task-id={task.id} onPointerDown={(event) => { if (!action.busy) board.drag.start(event, 'task', task.id); }}>
            <div className="mw-task-top" title="按住拖动任务"><span className="mw-drag-grip">⠿ <span className="mw-source">{task.kind === 'private' ? '个人 · 仅自己可见' : data.projects.find((row) => row.id === task.projectId)?.name}</span></span><span className={`mw-priority ${task.priority <= 2 ? 'high' : ''}`}>{task.priority} {priorityLabels[task.priority - 1]}</span></div>
            <button className="mw-title" disabled={Boolean(board.pending)} onClick={() => modal.open(<TaskEditor task={task} />)}>{task.title}</button>
            <div className="mw-task-foot">
              {task.kind === 'project' && <div className="mw-task-date">{data.arrangements.filter((row) => row.taskId === task.id).map((row) => { const date = data.periods.find((item) => item.id === row.periodId); return date ? `${date.startOn} — ${date.endOn}` : ''; }).join('、')}</div>}
              <span className="mw-task-actions"><button className="mw-subtasks" disabled={busy} onClick={() => modal.open(<SubtasksDialog task={task} />)}>子任务</button><button className="mw-advance" disabled={busy} onClick={() => {
                const command = { action: 'set_status' as const, operationId: createOperationId(), taskId: task.id, version: task.version, status: task.status === 'not_started' ? 'in_progress' as const : task.status === 'in_progress' ? 'completed' as const : 'in_progress' as const };
                if (command.status === 'completed') modal.open(<TaskCompletion privateTask={task.kind === 'private'} title={task.title} initial={taskCompletion(task)} arrangements={data.arrangements.filter((row) => row.taskId === task.id)} onConfirm={(completion) => run('tasks', { ...command, completion })} />);
                else void action.act(() => run('tasks', command));
              }}>{task.status === 'not_started' && <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="m5 3 7 5-7 5Z" /></svg>}{task.status === 'not_started' ? '开始' : task.status === 'in_progress' ? '完成' : '重新打开'}</button></span>
            </div>
          </article>
        )}{tasks.length === 0 && <div className="mw-empty">{periodId && periodId !== 'all' ? '当前周期暂无匹配任务' : '暂无任务'}</div>}</div>
      </section>;
    })}</div>
  </>;
}
