import { useRef } from 'react';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { Feedback } from './controls';
import { usePointerSort } from './drag';
import { OrderMenu } from './order-menu';
import { useSortFeedback } from './sort-feedback';

/** 项目页共用排序交互；只提交可见子集，服务端保留筛选外位置。恢复操作作用于完整列表。 */
export function useProjectSort(defaultIds: string[], target: 'projects' | 'tasks' | 'backlog', projectId?: string) {
  const { data, run, notify } = useWorkspace(), action = useSortFeedback(), root = useRef<HTMLDivElement>(null);
  const scope = target === 'projects' ? 'project-page:projects' : `project-page:${target}:${projectId}`;
  const order = data.orders.find((row) => row.scope === scope);
  const allowed = target === 'projects' ? data.teamLeader : Boolean(data.projects.find((row) => row.id === projectId)?.canManage);
  const visible = new Set(defaultIds);
  const storedIds = order?.manual ? [...order.ids.filter((id) => visible.has(id)), ...defaultIds.filter((id) => !order.ids.includes(id))] : defaultIds;
  const ids = action.ordered(scope, storedIds, (id) => id);
  function save(next: string[], reset = false) {
    if (!allowed || action.busy || !order) return;
    action.save(scope, reset ? null : next, async () => {
      const common = { operationId: createOperationId(), version: order.version, reset };
      if (target === 'projects') await run('planning', { ...common, action: 'reorder_projects', page: 'projects', projectIds: next });
      else if (projectId) await run('planning', { ...common, action: 'reorder_project_items', target, projectId, ids: next });
      notify(reset ? '已恢复默认排序' : '顺序已保存');
    });
  }
  function move(id: string, beforeId: string | null) {
    const next = ids.filter((value) => value !== id), index = beforeId === null ? next.length : next.indexOf(beforeId);
    if (index < 0 || !ids.includes(id)) return;
    next.splice(index, 0, id);
    if (next.join() !== ids.join()) save(next);
  }
  const drag = usePointerSort({ root, move: (id, _scope, destination) => move(id, destination.beforeId) });
  function handle(id: string, title: string, compact = false) {
    return <button className={compact ? 'v2-project-sort-handle' : 'v2-sort-handle'} disabled={!allowed} aria-disabled={!allowed || action.busy} aria-label={`拖动排序：${title}；也可用上下方向键`} title={allowed ? '拖动或使用上下方向键排序' : target === 'projects' ? '仅团队负责人可调整项目顺序' : '仅团队负责人或本项目研发负责人可排序'} onPointerDown={(event) => { if (!action.busy) drag.start(event, id, scope); }} onKeyDown={(event) => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); if (action.busy) return;
      const index = ids.indexOf(id);
      if (event.key === 'ArrowUp' && index > 0) move(id, ids[index - 1] ?? null);
      if (event.key === 'ArrowDown' && index < ids.length - 1) move(id, ids[index + 2] ?? null);
    }}>⠿{compact && <span>{title}</span>}</button>;
  }
  function rowProps(id: string) {
    return { 'data-sort-id': id };
  }
  return {
    root, ids, handle, rowProps, listProps: { 'data-sort-scope': scope },
    reset: allowed && (ids.length > 1 || order?.manual) && <OrderMenu label={target === 'projects' ? '项目排序选项' : target === 'tasks' ? '任务排序选项' : '待建任务排序选项'} scope="整个列表，包含筛选外内容" disabled={action.busy || !order?.manual} onReset={() => save([], true)} />,
    feedback: <Feedback error={action.error} />,
  };
}
