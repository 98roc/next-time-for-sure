import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { V2WeeklyState } from '@ntfs/contracts';
import type { V2Context } from './context.js';
import { V2TaskRepository } from './task.repository.js';
import { V2PlanningRepository } from './planning.repository.js';
import { summarizePeriod } from './history.js';
import { generateReportText, presentReport, reportSourceHash, type V2ReportGroup, type V2ReportSource } from './shared-report.js';
import { hashValue } from './repository-utils.js';

/** 按当前项目权限读取历史与计划，团队整稿不会用于受限成员的自由文本输出。 */
export async function buildWeeklyState(manager: EntityManager, context: V2Context, summaryPeriodId: string, planPeriodId: string): Promise<{ state: V2WeeklyState; source: V2ReportSource }> {
  if (!context.teamId) throw new ConflictException('请先加入团队。');
  const planning = new V2PlanningRepository(manager), tasks = new V2TaskRepository(manager);
  const periods = await planning.periods(context.teamId);
  const summaryPeriod = periods.find((row) => row.id === summaryPeriodId), planPeriod = periods.find((row) => row.id === planPeriodId);
  if (!summaryPeriod || !planPeriod || periods.indexOf(planPeriod) !== periods.indexOf(summaryPeriod) + 1) throw new ConflictException('请选择相邻的总结和计划区间。');
  const ids = await tasks.projectTaskIds(context.projects.map((project) => project.id));
  const histories = await tasks.history(ids), arrangementHistory = await planning.arrangementHistory(ids);
  const summary = summarizePeriod(summaryPeriod, histories, arrangementHistory, new Date().toISOString());
  const current = (await tasks.visible(context.actor.id, context.projects.map((project) => project.id))).filter((task) => task.kind === 'project');
  const arrangements = await tasks.arrangements(current.map((task) => task.id));

  // 读取全团队项目顺序后仅投影有权项目；受限查询不回写或删除隐藏项目。
  const allProjectIds = context.organization.projects.filter((project) => project.teamId === context.teamId).map((project) => project.id);
  const fullOrder = await planning.order(context.teamId, 'projects', allProjectIds);
  const projectOrder = { ids: fullOrder.ids.filter((id) => context.projects.some((project) => project.id === id)), version: fullOrder.version };
  const taskOrders: V2WeeklyState['taskOrders'] = [];
  for (const project of context.projects) for (const period of [summaryPeriod, planPeriod]) {
    const taskIds = period.id === summaryPeriod.id ? summary.filter((row) => row.projectId === project.id).map((row) => row.taskId) : current.filter((task) => task.projectId === project.id && arrangements.some((row) => row.taskId === task.id && row.periodId === period.id)).map((task) => task.id);
    taskOrders.push({ projectId: project.id, periodId: period.id, ...await planning.order(context.teamId, `tasks:${project.id}:${period.id}`, taskIds) });
  }
  const person = (id: string | null) => context.organization.accounts.find((account) => account.id === id)?.displayName ?? '历史成员';
  const groups = (side: 'summary' | 'plan'): V2ReportGroup[] => projectOrder.ids.map((projectId) => {
    const order = taskOrders.find((row) => row.projectId === projectId && row.periodId === (side === 'summary' ? summaryPeriod.id : planPeriod.id));
    return { projectId, projectName: context.organization.projects.find((project) => project.id === projectId)?.name ?? '项目', tasks: (order?.ids ?? []).flatMap((taskId) => {
      if (side === 'summary') { const row = summary.find((entry) => entry.taskId === taskId); return row ? [{ taskId, title: row.title ?? '历史内容不可还原', executorName: row.executorName ?? '历史姓名不可还原' }] : []; }
      const row = current.find((entry) => entry.id === taskId); return row ? [{ taskId, title: row.title, executorName: person(row.executorId) }] : [];
    }) };
  });
  const source: V2ReportSource = { teamId: context.teamId, summaryPeriod, planPeriod, summary: groups('summary'), plan: groups('plan'), revision: hashValue({ tasks: current.map((task) => [task.id, task.version]), summary, arrangements, taskOrders, projectOrder }) };
  const saved = context.teamLeader ? await planning.report(context.teamId, summaryPeriod.id, planPeriod.id) : null;
  return { source, state: { summaryPeriod, planPeriod, summary, projectOrder, taskOrders, text: presentReport(saved, source), generatedText: generateReportText(source), currentSourceHash: reportSourceHash(source), canEditText: context.teamLeader } };
}
