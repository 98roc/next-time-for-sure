import { z } from 'zod';
import type { LegacySource } from './source.js';
import { dbTime, requireValue, targetId, type MigrationPlan, type SqlRow } from './plan.js';

const milestone = z.object({ id: z.string(), projectId: z.string(), ownerId: z.string(), title: z.string(), expectedOn: z.string().nullable(), status: z.enum(['open', 'completed', 'removed']) });

/** 里程碑仍然有效，保留其原事件时间与操作者；不将已移出节点重新开放。 */
export function addMilestoneHistory(plan: MigrationPlan, source: LegacySource): void {
  const rows: SqlRow[] = [];
  for (const event of source.workEvents) {
    if (!event.action.startsWith('milestone.')) continue;
    const before = milestone.safeParse(event.payload_json.before), after = milestone.safeParse(event.payload_json.after);
    const object = after.success ? after.data : before.success ? before.data : undefined;
    if (!object || !source.milestones.some((row) => row.id === object.id)) continue;
    const project = requireValue(source.projects.find((row) => row.id === object.projectId), 'MISSING_MILESTONE_PROJECT');
    const snapshot = (value: z.infer<typeof milestone>) => ({ ...value, id: targetId('milestone', value.id) });
    rows.push({ id: targetId('object-event', event.id), team_id: project.team_id, project_id: object.projectId, object_id: targetId('milestone', object.id), actor_id: event.actor_id, action: event.action, payload_json: JSON.stringify({ before: before.success ? snapshot(before.data) : null, after: after.success ? snapshot(after.data) : null, sourceEventId: event.id }), occurred_at: dbTime(event.created_at) });
  }
  plan.rows.set('v2_object_events', rows);
}

/** 发布计划的已知顺序映射到相应区间；新增任务稳定附后，不重用私人排序。 */
export function addSharedOrder(plan: MigrationPlan, source: LegacySource): void {
  const rows: SqlRow[] = [];
  for (const team of source.teams) {
    const publications = source.publications.filter((entry) => entry.team_id === team.id && entry.kind === 'plan');
    const projectIds = source.projects.filter((entry) => entry.team_id === team.id).map((entry) => entry.id);
    const published = publications.flatMap((publication) => publication.payload_json.rows.flatMap((entry) => entry.sourceIds.flatMap((id) => { const assignment = source.assignments.find((row) => row.id === id); const task = source.tasks.find((row) => row.id === assignment?.task_id); return task ? [task.project_id] : []; })));
    rows.push({ team_id: team.id, scope_key: 'projects', ordered_ids: JSON.stringify([...new Set([...published, ...projectIds])]), version: 0 });
    for (const period of (plan.rows.get('v2_periods') ?? []).filter((entry) => entry.team_id === team.id)) {
      const publication = publications.find((entry) => entry.week === period.start_on);
      const preferred = publication?.payload_json.rows.flatMap((entry) => entry.sourceIds.flatMap((id) => { const task = plan.taskSources.get(id); return task ? [task] : []; })) ?? [];
      for (const projectId of projectIds) {
        const all = (plan.rows.get('v2_tasks') ?? []).filter((task) => task.project_id === projectId && (plan.rows.get('v2_arrangements') ?? []).some((entry) => entry.task_id === task.id && entry.period_id === period.id)).map((row) => requireValue(row.id, 'NO_TASK_ID'));
        if (!all.length) continue;
        rows.push({ team_id: team.id, scope_key: `tasks:${projectId}:${period.id}`, ordered_ids: JSON.stringify([...new Set([...preferred.filter((id) => all.includes(id)), ...all])]), version: 0 });
      }
    }
  }
  plan.rows.set('v2_shared_orders', rows);
}
