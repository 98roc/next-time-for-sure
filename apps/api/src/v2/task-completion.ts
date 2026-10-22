import type { V2Completion, V2Task } from '@ntfs/contracts';

/** 完成结果属于整条项目任务；老已完成记录修改无关字段时不强制补录。 */
export function applyCompletion(task: V2Task, previousStatus: V2Task['status'] | null, completion?: V2Completion): V2Task {
  if (task.kind === 'private') {
    if (completion) throw new Error('私人任务不记录实际人天和AI贡献率。');
    return task;
  }
  const next = completion ? { ...task, ...completion } : task;
  const completing = next.status === 'completed' && previousStatus !== 'completed';
  if (next.status === 'completed' && (completing || completion)) {
    if (next.actualDays == null) throw new Error('完成项目任务时必须填写累计实际投入。');
    // 默认仅在真正完成时应用，不把旧任务或普通字段编辑补造为高贡献。
    return { ...next, aiContribution: next.aiContribution ?? 'high' };
  }
  return next;
}
