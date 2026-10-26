import type { V2Milestone, V2Task, V2Status } from '@ntfs/contracts';

/** 开始及重开记录本轮开始；退回未开始清空起止，历史由不可变事件保留。 */
export function transitionTask(task: V2Task, status: V2Status, now: string): V2Task {
  if (task.deletedAt) throw new Error('任务已删除');
  if (task.status === status) return task;
  return { ...task, status, startedAt: status === 'not_started' ? null : status === 'in_progress' ? now : task.startedAt ?? null, completedAt: status === 'completed' ? now : null, updatedAt: now, version: task.version + 1 };
}

/** 改排先校验整套最终关系，避免先删后加留下无区间或覆盖目标已有投入。 */
export function rearrangeTask(periodIds: string[], source: string, target: string | null): string[] {
  if (new Set(periodIds).size !== periodIds.length) throw new Error('任务安排重复');
  if (!periodIds.includes(source)) throw new Error('原区间安排已变化');
  if (target === source) return [...periodIds];
  if (target !== null && periodIds.includes(target)) throw new Error('目标区间已有安排，请直接编辑已有安排');
  const result = periodIds.filter((id) => id !== source);
  if (target !== null) result.push(target);
  if (!result.length) throw new Error('不能取消最后一个安排，请改排到其他区间');
  return result;
}

/** 关联必须在同项目内，已完成目标禁止新增未完成任务。 */
export function validateMilestoneLink(task: Pick<V2Task, 'projectId' | 'status'>, milestone: V2Milestone): void {
  if (task.projectId !== milestone.projectId) throw new Error('只能关联本项目里程碑');
  if (milestone.status === 'completed' && task.status !== 'completed') throw new Error('请先重开里程碑，再关联未完成任务');
}

/** 空目标可以确认，非空目标须全部完成；权限由服务独立检查。 */
export function validateMilestoneCompletion(milestone: V2Milestone, tasks: V2Task[]): void {
  const unfinished = tasks.filter((task) => task.kind === 'project' && task.milestoneId === milestone.id && !task.deletedAt && task.status !== 'completed');
  if (unfinished.length) throw new Error(`还有 ${unfinished.length} 条关联任务未完成`);
}

/** 回退仅增加核验提示，不自动推翻已经确认的阶段目标。 */
export function milestoneAfterTaskChange(milestone: V2Milestone, previous: V2Task, current: V2Task): V2Milestone {
  const requiresReview = milestone.status === 'completed' && previous.status === 'completed' && current.status !== 'completed' && current.kind === 'project' && current.milestoneId === milestone.id;
  return requiresReview && !milestone.needsReview ? { ...milestone, needsReview: true, version: milestone.version + 1 } : milestone;
}
