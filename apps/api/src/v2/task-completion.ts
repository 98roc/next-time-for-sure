import type { V2Completion, V2Task } from '@ntfs/contracts';

/** 完成结果属于整条项目任务；老已完成记录修改无关字段时不强制补录。 */
export function applyCompletion(task: V2Task, previousStatus: V2Task['status'] | null, completion?: V2Completion): V2Task {
  if ((completion?.completedAt !== undefined || completion?.startedAt !== undefined) && task.status !== 'completed') throw new Error('只有已完成任务可以填写开始完成时间。');
  if (task.kind === 'private') {
    if (completion && (completion.actualDays !== null || completion.aiContribution !== null)) throw new Error('私人任务不记录实际人天和AI贡献率。');
    return completion ? { ...task, startedAt: completion.startedAt === undefined ? task.startedAt : completion.startedAt, completedAt: completion.completedAt ?? task.completedAt } : task;
  }
  const next = completion ? { ...task, ...completion, completedAt: completion.completedAt ?? task.completedAt } : task;
  const completing = next.status === 'completed' && previousStatus !== 'completed';
  if (next.status === 'completed' && (completing || completion)) {
    if (next.actualDays == null) throw new Error('完成项目任务时必须填写累计实际投入。');
    // 默认仅在真正完成时应用，不把旧任务或普通字段编辑补造为高贡献。
    return { ...next, aiContribution: next.aiContribution ?? 'high' };
  }
  return next;
}
