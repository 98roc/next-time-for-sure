import { createHash } from 'node:crypto';
import type { V2Period } from '@ntfs/contracts';

export type V2ReportGroup = { projectId: string; projectName: string; tasks: { taskId: string; title: string; executorName: string; workNote?: string }[] };
export type V2ReportSource = { teamId: string; summaryPeriod: V2Period; planPeriod: V2Period; summary: V2ReportGroup[]; plan: V2ReportGroup[]; revision: string };
export type V2ReportText = { body: string; manual: boolean; sourceHash: string; version: number };

/** 使用已按权限和共享顺序整理的来源生成文字；团队整稿查询必须在上层限制为团队负责人。 */
export function generateReportText(source: V2ReportSource): string {
  if (source.summaryPeriod.teamId !== source.teamId || source.planPeriod.teamId !== source.teamId) throw new Error('文字版区间必须属于当前团队');
  const block = (period: V2Period, groups: V2ReportGroup[]) => [
    `${period.startOn}—${period.endOn}`,
    ...groups.filter((group) => group.tasks.length).flatMap((group) => [group.projectName, ...group.tasks.map((task, index) => {
      // 按本侧周期取工作内容，空值不显示括号，跨入口提交的换行收为同一任务行。
      const note = task.workNote?.trim().replace(/\s+/gu, ' ');
      return `${index + 1}.${task.title}${note ? `（${note}）` : ''} ${task.executorName}`;
    })]),
  ].join('\n');
  return `${block(source.summaryPeriod, source.summary)}\n\n${block(source.planPeriod, source.plan)}`;
}

/** 来源摘要包含版本和区间组合，不能用内容相同掩盖期间发生的安排或状态变化。 */
export function reportSourceHash(source: V2ReportSource): string {
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}

/** 自动稿即时跟随来源；手工稿保留原文并报告来源是否变化。 */
export function presentReport(saved: V2ReportText | null, source: V2ReportSource): V2ReportText & { stale: boolean } {
  const sourceHash = reportSourceHash(source);
  if (!saved || !saved.manual) return { body: generateReportText(source), manual: false, sourceHash, version: saved?.version ?? 0, stale: false };
  return { ...saved, stale: saved.sourceHash !== sourceHash };
}

/** 保存手工文字保留编辑开始时的来源，期间来源更新不会被错误标为已同步。 */
export function editReport(saved: V2ReportText | null, expectedVersion: number, body: string, editingSourceHash: string): V2ReportText {
  if ((saved?.version ?? 0) !== expectedVersion) throw new Error('文字稿已被其他人修改，请保留草稿并刷新核对');
  if (!/^[a-f0-9]{64}$/u.test(editingSourceHash) || body.length > 200_000) throw new Error('文字或来源摘要无效');
  return { body, manual: true, sourceHash: editingSourceHash, version: expectedVersion + 1 };
}

/** 手工核对或重新生成均绑定当前来源及文字版本，过期预览不得覆盖新稿。 */
export function confirmReport(saved: V2ReportText, expectedVersion: number, previewHash: string, source: V2ReportSource, replace: boolean): V2ReportText {
  if (saved.version !== expectedVersion) throw new Error('文字稿已被其他人修改，请重新核对');
  if (reportSourceHash(source) !== previewHash) throw new Error('来源已变化，请重新生成预览');
  return { body: replace ? generateReportText(source) : saved.body, manual: replace ? false : saved.manual, sourceHash: previewHash, version: saved.version + 1 };
}

/** 重排必须覆盖已授权作用域的全部对象，未授权对象保持原位置与相对顺序。 */
export function reorderScoped(current: string[], scope: string[], requested: string[], currentVersion: number, expectedVersion: number): string[] {
  if (currentVersion !== expectedVersion) throw new Error('排序已被其他人修改，请刷新后重试');
  const allowed = new Set(scope);
  if (new Set(current).size !== current.length || allowed.size !== scope.length || new Set(requested).size !== requested.length || requested.length !== scope.length || scope.some((id) => !current.includes(id)) || requested.some((id) => !allowed.has(id))) throw new Error('排序必须完整包含当前作用域，不能覆盖隐藏或无权对象');
  let index = 0;
  return current.map((id) => {
    if (!allowed.has(id)) return id;
    const replacement = requested[index++];
    if (!replacement) throw new Error('排序缺少对象');
    return replacement;
  });
}
