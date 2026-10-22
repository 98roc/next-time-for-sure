import { PersonalWelcome } from './personal-welcome';
import { useState } from 'react';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { useModal, ModalPage } from './modal';
import { Feedback, PeriodSelect, priorityLabels, useAction } from './controls';
import { TaskCreate } from './task-create';
import { TaskEditor } from './task-editor';
import { TaskCompletion, taskCompletion } from './task-results';
import { CategoryForm, DeleteCategory } from './category-dialogs';
import { usePersonalBoard } from './personal-board';
import { SubtasksDialog } from './subtasks-dialog';
import { DailyReport } from './daily-report';
import { DateNavigator, useCompletedFilter } from './personal-completed';
import './personal-work.css';
import './board-drag.css';

const defaultDescription = '新分配任务和其他入口的状态变化，进入对应状态的默认分类，按默认排序排列；已手动排序的分类中新任务置顶。手动选择优先；更换默认分类不搬动已有任务。';

/** 私人和本人执行的项目任务共用看板，完成区间不影响未完成任务。 */
export function PersonalPageV2() {
  const { data, user, run } = useWorkspace(), modal = useModal(), action = useAction();
  const board = usePersonalBoard(), completed = useCompletedFilter(), busy = action.busy || completed.busy || Boolean(board.pending) || board.drag.active;
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
  return <>
    <header className="mw-heading"><PersonalWelcome name={user.displayName} messages={data.teamMessages} /><div className="mw-actions"><button className="mw-quiet" onClick={() => modal.open(<DailyReport />)}><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M4 2h6l3 3v9H3V2Z" /><path d="M9 2v4h4M5 9h6M5 12h4" /></svg>我的日报</button><button className="mw-quiet" onClick={() => modal.open(<CategoryForm />)}>＋ 新增分类</button><button className="mw-primary" onClick={() => modal.open(<TaskCreate personal />)}>＋ 新建任务</button></div></header>
    <div className="mw-toolbar"><label className="mw-search">⌕<input aria-label="搜索任务" placeholder="搜索任务名称" value={search} onChange={(event) => setSearch(event.target.value)} /></label><select aria-label="筛选任务来源" value={source} onChange={(event) => setSource(event.target.value)}><option value="all">全部项目与个人任务</option><option value="private">仅个人任务</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><button disabled={busy} onClick={() => { void action.act(() => run('personal', { action: 'reset_order', operationId: createOperationId(), version: data.personalVersion })); }}>恢复默认排序</button></div>
    <Feedback error={action.error || completed.error || board.error} /><div className="mw-board-meta"><span>{visible.length} 项任务</span><span role="status">{board.pending ? '正在保存…' : ''}</span></div>
    <div className="mw-board" ref={board.root} aria-label="任务分类看板" aria-busy={Boolean(board.pending)}>{board.categories.map((category, categoryIndex) => {
      const ids = board.placements.filter((row) => row.categoryId === category.id).sort((a, b) => a.position - b.position).map((row) => row.taskId);
      const tasks = ids.flatMap((id) => { const task = visible.find((row) => row.id === id); return task ? [task] : []; });
      const last = data.categories.filter((row) => row.status === category.status).length === 1;
      return <section key={category.id} className="mw-column" data-category-id={category.id} data-task-scope={category.id} data-status={category.status === 'in_progress' ? 'doing' : category.status === 'completed' ? 'done' : 'todo'}>
        <div className="mw-col-head">
          <h2 className="mw-category-title"><button className="mw-category-handle" aria-disabled={busy} aria-label={`拖动分类：${category.name}；方向键调整顺序`} title="拖动分类标题排序，也可用方向键" onPointerDown={(event) => { if (!action.busy) board.drag.start(event, 'category', category.id); }} onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault(); if (busy) return;
            const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
            if ((backwards && categoryIndex === 0) || (!backwards && categoryIndex === board.categories.length - 1)) return;
            board.move({ kind: 'category', id: category.id, scope: 'categories', beforeId: board.categories[categoryIndex + (backwards ? -1 : 2)]?.id ?? null });
          }}><span className="mw-category-grip" aria-hidden="true">⠿</span><span className="mw-dot" />{category.name}</button>{category.isDefault && <button className="mw-default" title={defaultDescription} onClick={() => modal.open(<ModalPage title="默认分类"><p>{defaultDescription}</p></ModalPage>)}>默认</button>}</h2>
          <span className="mw-count">{tasks.length}</span><details className="mw-col-menu"><summary aria-label={`${category.name}分类操作`}>⋯</summary><div className="mw-col-menu-panel">{category.status === 'completed' && <><small>完成记录查看方式</small><button disabled={busy} className={completed.mode === 'day' ? 'is-selected' : undefined} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); completed.changeMode('day'); }}>按日期{completed.mode === 'day' ? ' ✓' : ''}</button><button disabled={busy} className={completed.mode === 'period' ? 'is-selected' : undefined} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); completed.changeMode('period'); }}>按日期区间{completed.mode === 'period' ? ' ✓' : ''}</button><hr /></>}<button disabled={busy} onClick={() => modal.open(<CategoryForm category={category} />)}>修改名称</button><button disabled={category.isDefault || busy} onClick={() => { void action.act(() => run('personal', { action: 'default_category', operationId: createOperationId(), version: data.personalVersion, categoryId: category.id })); }}>设为默认</button><button disabled={last || busy} onClick={() => modal.open(<DeleteCategory category={category} />)}>删除分类</button>{last && <small>每种状态至少保留一个分类</small>}</div></details>
        </div>
        {category.status === 'completed' && <div className="mw-period"><span>{completed.mode === 'day' ? '完成日期' : '完成日期区间'}</span>{completed.mode === 'day' ? <DateNavigator value={completed.date} today={data.today} onChange={completed.setDay} label="完成日期" disabled={busy} /> : own.some((row) => row.status === 'completed' && row.completedAt === null) ? <select aria-label="完成日期区间" value={completed.selectedPeriod} onChange={(event) => completed.setPeriodId(event.target.value)}><option value="all">全部完成记录</option><option value="unknown">完成日期不可还原</option>{data.periods.map((row) => <option key={row.id} value={row.id}>{row.startOn} — {row.endOn}</option>)}</select> : <PeriodSelect label="完成日期区间" periods={data.periods} value={completed.selectedPeriod} all onChange={completed.setPeriodId} />}</div>}
        <div className="mw-card-list">{tasks.map((task) =>
          <article key={task.id} className="mw-task" data-task-id={task.id} onPointerDown={(event) => { if (!action.busy) board.drag.start(event, 'task', task.id); }}>
            <div className="mw-task-top" title="按住拖动任务"><span className="mw-drag-grip">⠿ <span className="mw-source">{task.kind === 'private' ? '个人 · 仅自己可见' : data.projects.find((row) => row.id === task.projectId)?.name}</span></span><span className={`mw-priority ${task.priority <= 2 ? 'high' : ''}`}>{task.priority} {priorityLabels[task.priority - 1]}</span></div>
            <button className="mw-title" disabled={Boolean(board.pending)} onClick={() => modal.open(<TaskEditor task={task} />)}>{task.title}</button>
            <div className="mw-task-foot">
              {task.kind === 'project' && <div className="mw-task-date">{data.arrangements.filter((row) => row.taskId === task.id).map((row) => { const date = data.periods.find((item) => item.id === row.periodId); return date ? `${date.startOn} — ${date.endOn}` : ''; }).join('、')}</div>}
              <span className="mw-task-actions"><button className="mw-subtasks" disabled={busy} onClick={() => modal.open(<SubtasksDialog task={task} />)}>子任务</button><button className="mw-advance" disabled={busy} onClick={() => {
                const command = { action: 'set_status' as const, operationId: createOperationId(), taskId: task.id, version: task.version, status: task.status === 'not_started' ? 'in_progress' as const : task.status === 'in_progress' ? 'completed' as const : 'in_progress' as const };
                if (task.kind === 'project' && command.status === 'completed') modal.open(<TaskCompletion title={task.title} initial={taskCompletion(task)} arrangements={data.arrangements.filter((row) => row.taskId === task.id)} onConfirm={(completion) => run('tasks', { ...command, completion })} />);
                else void action.act(() => run('tasks', command));
              }}>{task.status === 'not_started' && <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="m5 3 7 5-7 5Z" /></svg>}{task.status === 'not_started' ? '开始' : task.status === 'in_progress' ? '完成' : '重新打开'}</button></span>
            </div>
          </article>
        )}{tasks.length === 0 && <div className="mw-empty">暂无任务</div>}</div>
      </section>;
    })}</div>
  </>;
}
