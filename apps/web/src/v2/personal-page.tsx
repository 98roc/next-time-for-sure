import { useEffect, useRef, useState } from 'react';
import type { V2Task } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { useModal, ModalPage } from './modal';
import { currentPeriod, Feedback, Field, PeriodSelect, priorityLabels, useAction } from './controls';
import { TaskCreate } from './task-create';
import { TaskEditor } from './task-editor';
import { CategoryForm, DeleteCategory } from './category-dialogs';
import { usePointerSort } from './drag';

const defaultDescription = '新分配任务和其他入口的状态变化，进入对应状态默认分类顶部。手动选择优先；更换默认分类不搬动已有任务。';

/** 私人和本人执行的项目任务共用看板，完成区间不影响未完成任务。 */
export function PersonalPageV2() {
  const { data, user, run, notify } = useWorkspace(), modal = useModal(), action = useAction();
  const [search, setSearch] = useState(''), [source, setSource] = useState('all'), [completedPeriod, setCompletedPeriod] = useState(() => currentPeriod(data.periods, data.today) || 'all');
  const [hour, setHour] = useState(shanghaiHour), board = useRef<HTMLDivElement>(null);
  useEffect(() => { const timer = setInterval(() => setHour(shanghaiHour()), 60000); return () => clearInterval(timer); }, []);
  const own = data.tasks.filter((task) => task.executorId === user.id);
  const period = data.periods.find((row) => row.id === completedPeriod);
  const visible = own.filter((task) => {
    if (!task.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) return false;
    if (source !== 'all' && (source === 'private' ? task.kind !== 'private' : task.projectId !== source)) return false;
    if (task.status !== 'completed' || completedPeriod === 'all') return true;
    if (completedPeriod === 'unknown') return task.completedAt === null;
    const date = task.completedAt ? new Date(new Date(task.completedAt).getTime() + 8 * 3600000).toISOString().slice(0, 10) : null;
    return Boolean(date && period && date >= period.startOn && date <= period.endOn);
  });
  function move(taskId: string, categoryId: string, beforeTaskId: string | null) {
    const task = own.find((row) => row.id === taskId); if (!task) return;
    void action.act(async () => { await run('personal', { action: 'move_task', operationId: createOperationId(), version: data.personalVersion, taskId, taskVersion: task.version, categoryId, beforeTaskId }); notify('任务已移动'); });
  }
  const drag = usePointerSort({ root: board, allowCrossScope: true, move: (id, _from, target) => move(id, target.scope, target.beforeId) });
  const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  return <>
    <div className="mw-context">我的工作</div><header className="mw-heading"><div><h1>{greeting}，{user.displayName}</h1>{data.teamMessage.trim() && <p id="mw-team-phrase">{data.teamMessage}</p>}</div><div className="mw-actions"><button className="mw-quiet" onClick={() => modal.open(<CategoryForm />)}>＋ 新增分类</button><button className="mw-primary" onClick={() => modal.open(<TaskCreate personal />)}>＋ 新建任务</button></div></header>
    <div className="mw-toolbar"><label className="mw-search">⌕<input aria-label="搜索任务" placeholder="搜索任务名称" value={search} onChange={(event) => setSearch(event.target.value)} /></label><select aria-label="筛选任务来源" value={source} onChange={(event) => setSource(event.target.value)}><option value="all">全部项目与个人任务</option><option value="private">仅个人任务</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><button disabled={action.busy} onClick={() => { void action.act(() => run('personal', { action: 'reorder_priority', operationId: createOperationId(), version: data.personalVersion })); }}>⇣ 按优先级重排</button></div>
    <Feedback error={action.error} /><div className="mw-board-meta"><span>{visible.length} 项任务</span></div>
    <div className="mw-board" ref={board} aria-label="任务分类看板">{data.categories.map((category) => {
      const ids = data.placements.filter((row) => row.categoryId === category.id).sort((a, b) => a.position - b.position).map((row) => row.taskId);
      const tasks = ids.flatMap((id) => { const task = visible.find((row) => row.id === id); return task ? [task] : []; });
      const last = data.categories.filter((row) => row.status === category.status).length === 1;
      return <section key={category.id} className={`mw-column ${drag.drag?.target?.scope === category.id ? 'over' : ''}`} data-status={category.status === 'in_progress' ? 'doing' : category.status === 'completed' ? 'done' : 'todo'}>
        <div className="mw-col-head"><span className="mw-dot" /><h2>{category.name}</h2><span className="mw-count">{tasks.length}</span><details className="mw-col-menu"><summary aria-label={`${category.name}分类操作`}>⋯</summary><div className="mw-col-menu-panel"><button onClick={() => modal.open(<CategoryForm category={category} />)}>修改名称</button><button disabled={category.isDefault || action.busy} onClick={() => { void action.act(() => run('personal', { action: 'default_category', operationId: createOperationId(), version: data.personalVersion, categoryId: category.id })); }}>设为默认</button><button disabled={last} onClick={() => modal.open(<DeleteCategory category={category} />)}>删除分类</button>{last && <small>每种状态至少保留一个分类</small>}</div></details></div>
        <div className="mw-col-sub">{category.isDefault && <button className="mw-default" title={defaultDescription} onClick={() => modal.open(<ModalPage title="默认分类"><p>{defaultDescription}</p></ModalPage>)}>默认</button>}</div>
        {category.status === 'completed' && <label className="mw-period">完成日期区间{own.some((row) => row.status === 'completed' && row.completedAt === null) ? <select aria-label="完成日期区间" value={completedPeriod} onChange={(event) => setCompletedPeriod(event.target.value)}><option value="all">全部完成记录</option><option value="unknown">完成日期不可还原</option>{data.periods.map((row) => <option key={row.id} value={row.id}>{row.startOn} — {row.endOn}</option>)}</select> : <PeriodSelect label="完成日期区间" periods={data.periods} value={completedPeriod} all onChange={setCompletedPeriod} />}</label>}
        <div className="mw-card-list" data-sort-scope={category.id}>{tasks.map((task) => <div key={task.id}>
          {drag.drag?.target?.scope === category.id && drag.drag.target.beforeId === task.id && <div className="mw-placeholder" style={{ height: drag.drag?.height }} />}
          <article className="mw-task" data-sort-id={task.id}>
            <div className="mw-task-top" onPointerDown={(event) => drag.start(event, task.id, category.id)}><span className="mw-drag-grip">⠿ <span className="mw-source">{task.kind === 'private' ? '个人 · 仅自己可见' : data.projects.find((row) => row.id === task.projectId)?.name}</span></span><span className={`mw-priority ${task.priority <= 2 ? 'high' : ''}`}>{task.priority} {priorityLabels[task.priority - 1]}</span></div>
            <button className="mw-title" onClick={() => modal.open(<TaskEditor task={task} />)}>{task.title}</button>
            {task.kind === 'project' && <div className="mw-task-date">{data.arrangements.filter((row) => row.taskId === task.id).map((row) => { const date = data.periods.find((item) => item.id === row.periodId); return date ? `${date.startOn} — ${date.endOn}` : ''; }).join('、')}</div>}
            <div className="mw-task-foot"><button onClick={() => modal.open(<MoveTask task={task} />)}>移动</button><button className="mw-advance" disabled={action.busy} onClick={() => { void action.act(() => run('tasks', { action: 'set_status', operationId: createOperationId(), taskId: task.id, version: task.version, status: task.status === 'not_started' ? 'in_progress' : task.status === 'in_progress' ? 'completed' : 'in_progress' })); }}>{task.status === 'not_started' ? '开始' : task.status === 'in_progress' ? '完成' : '重新打开'}</button></div>
          </article>
        </div>)}{drag.drag?.target?.scope === category.id && drag.drag.target.beforeId === null && <div className="mw-placeholder" style={{ height: drag.drag?.height }} />}{tasks.length === 0 && <div className="mw-empty">暂无任务</div>}</div>
      </section>;
    })}</div>
  </>;
}

/** 键盘和触屏可用的移动替代入口，明确分类与落点，不改变任务归属。 */
function MoveTask({ task }: { task: V2Task }) {
  const { data, run } = useWorkspace(), modal = useModal(), action = useAction();
  const [categoryId, setCategory] = useState(data.placements.find((row) => row.taskId === task.id)?.categoryId ?? ''), [beforeId, setBefore] = useState('top');
  const targets = data.placements.filter((row) => row.categoryId === categoryId && row.taskId !== task.id).sort((a, b) => a.position - b.position);
  return <ModalPage title="移动任务" busy={action.busy} actions={<button className="nt-primary" disabled={action.busy} onClick={() => { void action.act(async () => { await run('personal', { action: 'move_task', operationId: createOperationId(), version: data.personalVersion, taskId: task.id, taskVersion: task.version, categoryId, beforeTaskId: beforeId === 'bottom' ? null : beforeId === 'top' ? targets[0]?.taskId ?? null : beforeId }); modal.finish(); }); }}>移动</button>}><h3>{task.title}</h3><div className="v2-fields"><Field label="目标分类"><select value={categoryId} onChange={(event) => { setCategory(event.target.value); setBefore('top'); }}>{data.categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field><Field label="落点"><select value={beforeId} onChange={(event) => setBefore(event.target.value)}><option value="top">分类顶部</option>{targets.map((row) => <option key={row.taskId} value={row.taskId}>{data.tasks.find((item) => item.id === row.taskId)?.title} 之前</option>)}<option value="bottom">分类底部</option></select></Field></div><Feedback error={action.error} /></ModalPage>;
}

/** 问候以团队上海时间实时更新，不改变服务器业务日期。 */
function shanghaiHour(): number { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(new Date())); }
