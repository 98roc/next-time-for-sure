import { createElement, useRef, useState } from 'react';
import type { V2Completion } from '@ntfs/contracts';
import { TaskCompletion, taskCompletion } from './task-results';
import { useModal } from './modal';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { useBoardDrag, type BoardDrop } from './board-drag';
import { projectPersonalOrder } from './personal-order';

/** 个人看板乐观落位与单次保存；成功采用服务器快照，失败撤销投影并保留明确错误。 */
export function usePersonalBoard() {
  const { data, run, notify } = useWorkspace();
  const modal = useModal();
  const root = useRef<HTMLDivElement>(null), saving = useRef(false);
  const [pending, setPending] = useState<BoardDrop | null>(null), [error, setError] = useState('');
  function move(drop: BoardDrop) {
    if (saving.current) return;
    const projected = projectPersonalOrder(data, drop);
    if (projected === data) return;
    const task = data.tasks.find((row) => row.id === drop.id);
    if (drop.kind === 'task' && !task) return;
    if (drop.kind === 'category' && projected.categories.every((row, index) => row.id === data.categories[index]?.id)) return;
    const current = data.placements.find((row) => row.taskId === drop.id);
    const siblings = data.placements.filter((row) => row.categoryId === current?.categoryId).sort((a, b) => a.position - b.position);
    if (drop.kind === 'task' && current?.categoryId === drop.scope && (siblings[siblings.findIndex((row) => row.taskId === drop.id) + 1]?.taskId ?? null) === drop.beforeId) return;
    const completing = drop.kind === 'task' && task?.kind === 'project' && task.status !== 'completed' && data.categories.find((row) => row.id === drop.scope)?.status === 'completed';
    if (completing && task) {
      modal.open(createElement(TaskCompletion, { title: task.title, initial: taskCompletion(task), arrangements: data.arrangements.filter((row) => row.taskId === task.id), onConfirm: (completion: V2Completion) => persistDrop(drop, completion) }));
    } else void persistDrop(drop).catch(() => undefined);
  }
  async function persistDrop(drop: BoardDrop, completion?: V2Completion) {
    if (saving.current) return;
    const task = data.tasks.find((row) => row.id === drop.id);
    saving.current = true; setPending(drop); setError('');
    const common = { version: data.personalVersion, operationId: createOperationId() };
    const command = drop.kind === 'category'
      ? { ...common, action: 'move_category' as const, categoryId: drop.id, beforeCategoryId: drop.beforeId }
      : { ...common, action: 'move_task' as const, taskId: drop.id, taskVersion: task?.version ?? 0, categoryId: drop.scope, beforeTaskId: drop.beforeId, ...(completion ? { completion } : {}) };
    try { await run('personal', command); notify(drop.kind === 'category' ? '分类顺序已保存' : '任务已移动'); } catch (failure: unknown) {
      setError(`未能确认保存，已恢复当前服务器视图，请刷新核对：${failure instanceof Error ? failure.message : '请重试。'}`);
      throw failure;
    } finally { saving.current = false; setPending(null); }
  }
  const drag = useBoardDrag(root, move, Boolean(pending), data.personalVersion);
  const view = pending ? projectPersonalOrder(data, pending) : data;
  return { root, drag, move, pending, error, categories: view.categories, placements: view.placements };
}
