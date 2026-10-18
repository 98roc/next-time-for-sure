import { shiftDate } from '../../v2/calendar.js';
import type { LegacySource, MigrationDecisions } from './source.js';
import { dbTime, requireValue, targetId, type MigrationPlan, type SqlRow } from './plan.js';

/** 共享文字保留人工条目与发布内容，自动生成的旧草稿不再重复加入；来源另存映射。 */
export function addReportText(plan: MigrationPlan, source: LegacySource, decisions: MigrationDecisions, now: string): void {
  const groups = new Map<string, { teamId: string; summaryWeek: string; planWeek: string; summary: string[]; plan: string[]; sources: { table: string; id: string; description: string }[] }>();
  const group = (teamId: string, week: string, kind: 'summary' | 'plan') => {
    const summaryWeek = kind === 'plan' ? shiftDate(week, -7) : week, planWeek = shiftDate(summaryWeek, 7), key = `${teamId}:${summaryWeek}`;
    let value = groups.get(key);
    if (!value) { value = { teamId, summaryWeek, planWeek, summary: [], plan: [], sources: [] }; groups.set(key, value); }
    return value;
  };
  for (const report of source.reports) {
    const edited = report.entries_json.filter((entry) => entry.edited && !entry.excluded);
    if (!edited.length) continue;
    const target = group(report.team_id, report.week, 'summary');
    target.summary.push(...edited.map((entry) => `${entry.projectName} · ${entry.title}${entry.text ? `：${entry.text}` : ''}`));
    target.sources.push({ table: 'report_drafts', id: report.id, description: '保留人工改写的未排除条目；自动来源不重复导入' });
  }
  for (const publication of source.publications) {
    if (publication.payload_json.next?.length) throw new Error('REVIEW_PUBLICATION_NEXT_MAPPING');
    const kind = publication.kind === 'plan' ? 'plan' : 'summary', target = group(publication.team_id, publication.week, kind);
    const siblings = source.publications.filter((row) => row.team_id === publication.team_id && row.week === publication.week && row.kind === publication.kind);
    if (siblings.length > 1) throw new Error('REVIEW_MULTIPLE_PUBLICATION_TEXTS');
    target[kind].push(...publication.payload_json.rows.map((row) => `${row.projectName} · ${row.title}（${row.person}）${row.text ? `：${row.text}` : ''}`));
    target.sources.push({ table: 'weekly_publications', id: publication.id, description: `保留${publication.week} ${publication.kind} 第${publication.revision}版文字与顺序；发布机制取消` });
  }
  for (const arrangement of source.arrangements.filter((row) => row.goal.trim())) {
    const draft = requireValue(source.drafts.find((row) => row.id === arrangement.draft_id), 'MISSING_TEXT_DRAFT');
    const target = group(draft.team_id, draft.week, 'plan');
    const publication = source.publications.find((row) => row.team_id === draft.team_id && row.week === draft.week && row.kind === 'plan');
    if (publication?.payload_json.rows.some((row) => row.sourceIds.includes(arrangement.assignment_id) && row.text.includes(arrangement.goal))) continue;
    const assignment = requireValue(source.assignments.find((row) => row.id === arrangement.assignment_id), 'MISSING_TEXT_ASSIGNMENT');
    const task = requireValue(source.tasks.find((row) => row.id === assignment.task_id), 'MISSING_TEXT_TASK');
    const project = requireValue(source.projects.find((row) => row.id === task.project_id), 'MISSING_TEXT_PROJECT');
    const account = requireValue(source.accounts.find((row) => row.id === assignment.account_id), 'MISSING_TEXT_EXECUTOR');
    target.plan.push(`${project.name} · ${task.title}（${account.display_name}）：${arrangement.goal}`);
  }
  const texts: SqlRow[] = [], mappings = plan.rows.get('v2_migration_map') ?? [];
  for (const [key, value] of groups) {
    const periods = plan.rows.get('v2_periods') ?? [];
    const summaryId = requireValue(periods.find((row) => row.team_id === value.teamId && row.start_on === value.summaryWeek)?.id, 'MISSING_SUMMARY_PERIOD');
    const planId = requireValue(periods.find((row) => row.team_id === value.teamId && row.start_on === value.planWeek)?.id, 'MISSING_PLAN_PERIOD');
    const body = `区间总结（${value.summaryWeek}—${shiftDate(value.summaryWeek, 6)}）\n${[...new Set(value.summary)].join('\n')}\n\n区间计划（${value.planWeek}—${shiftDate(value.planWeek, 6)}）\n${[...new Set(value.plan)].join('\n')}`;
    texts.push({ team_id: value.teamId, summary_period_id: summaryId, plan_period_id: planId, body, manual: 1, source_hash: '0'.repeat(64), version: 0, updated_by: decisions.actorId, updated_at: dbTime(now) });
    for (const origin of value.sources) mappings.push({ source_table: origin.table, source_id: origin.id, target_kind: 'report_text', target_id: targetId('report', key), decision: origin.description, migrated_at: dbTime(now) });
  }
  plan.rows.set('v2_report_texts', texts); plan.rows.set('v2_migration_map', mappings);
}
