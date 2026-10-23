import type { V2Milestone } from '@ntfs/contracts';

/** 关联选项只展示本项目未完成目标及原关联；不修改工作区顺序或里程碑看板。 */
export function milestoneOptions(milestones: readonly V2Milestone[], projectId: string, originalMilestoneId: string | null = null): V2Milestone[] {
  return milestones.filter((row) => row.projectId === projectId && (row.status === 'open' || row.id === originalMilestoneId)).sort((left, right) => {
    // 有日期的优先，日期从早到晚；没有日期的集中在最后。
    if (left.expectedOn !== right.expectedOn) {
      if (left.expectedOn === null) return 1;
      if (right.expectedOn === null) return -1;
      return left.expectedOn.localeCompare(right.expectedOn);
    }

    // 同日及未规划目标按创建先后排列；旧快照缺时间时置后，以标识稳定兜底。
    if (left.createdAt !== right.createdAt) {
      if (!left.createdAt) return 1;
      if (!right.createdAt) return -1;
      return left.createdAt.localeCompare(right.createdAt);
    }
    return left.id.localeCompare(right.id);
  });
}
