import { v2StatusSchema, v2TaskEventSchema, v2TaskSchema, type V2Task, type V2TaskEvent } from '@ntfs/contracts';
import { z } from 'zod';
import type { LegacySource, MigrationDecisions } from './source.js';
import { dbTime, legacySnapshotSchema, plannedTask, requireValue, targetId, type MigrationPlan, type SqlRow } from './plan.js';

/** 原有事件只能证明其保存的字段；缺失姓名保留空值，不拿当前姓名改写历史。 */
export function addTaskHistory(plan: MigrationPlan, source: LegacySource, decisions: MigrationDecisions, now: string): void {
  const events: SqlRow[] = [];
  for (const row of plan.rows.get('v2_tasks') ?? []) {
    const current = plannedTask(row);
    const assignment = source.assignments.find((entry) => plan.taskSources.get(entry.id) === current.id);
    const personal = source.personal.find((entry) => plan.taskSources.get(entry.id) === current.id);
    const base = assignment ? source.tasks.find((entry) => entry.id === assignment.task_id) : undefined;
    const candidates = [...source.workEvents.filter((entry) => entry.object_id === assignment?.id || entry.object_id === base?.id), ...source.personalEvents.filter((entry) => entry.object_id === personal?.id)].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    let snapshot: V2Task | undefined, title = base?.title ?? current.title, milestoneId: string | null = null, imported = false, sequence = 0;
    const append = (task: V2Task, actorId: string, action: V2TaskEvent['action'], occurredAt: string, evidence: string, currentNames = false) => {
      const next = { ...task, version: sequence++, updatedAt: occurredAt };
      const event = v2TaskEventSchema.parse({ id: targetId('event', `${current.id}:${evidence}`), taskId: current.id, sequence: next.version, actorId, action, beforeStatus: snapshot?.status ?? null, occurredAt, snapshot: next, actorName: currentNames ? source.accounts.find((account) => account.id === actorId)?.display_name ?? null : null, executorName: currentNames ? source.accounts.find((account) => account.id === next.executorId)?.display_name ?? null : null });
      events.push({ id: event.id, task_id: event.taskId, sequence: event.sequence, actor_id: actorId, action, before_status: event.beforeStatus, snapshot_json: JSON.stringify({ task: next, actorName: event.actorName, executorName: event.executorName }), occurred_at: dbTime(occurredAt) });
      snapshot = next;
    };
    for (const event of candidates) {
      if (event.created_at > now) throw new Error('SOURCE_EVENT_IN_FUTURE');
      const decoded = legacySnapshotSchema.safeParse(event.payload_json.after);
      if (event.object_id === base?.id) {
        if (event.action === 'create_task') {
          title = z.string().parse(event.payload_json.title);
          const oldMilestone = z.string().nullable().optional().parse(event.payload_json.milestoneId);
          milestoneId = oldMilestone ? targetId('milestone', oldMilestone) : null;
        }
        if (decoded.success && decoded.data.id === base.id) {
          if (!imported && decoded.data.title !== undefined) title = decoded.data.title;
          if (decoded.data.milestoneId !== undefined) milestoneId = decoded.data.milestoneId ? targetId('milestone', decoded.data.milestoneId) : null;
          if (snapshot && (snapshot.title !== title || snapshot.milestoneId !== milestoneId)) append(v2TaskSchema.parse({ ...snapshot, title, milestoneId }), event.actor_id, 'updated', event.created_at, event.id);
        }
        continue;
      }
      if (!decoded.success) continue;
      const after = decoded.data;
      if (after.id !== assignment?.id && after.id !== personal?.id) continue;
      const status = v2StatusSchema.safeParse(after.status); if (!status.success) throw new Error('REVIEW_UNSUPPORTED_EXECUTION_EVENT');
      if (after.id === personal?.id) { imported = true; title = requireValue(after.title, 'MISSING_PERSONAL_EVENT_TITLE'); }
      const completedAt = status.data === 'completed' && after.endedAt ? new Date(after.endedAt).toISOString() : null;
      const next = v2TaskSchema.parse({ ...current, title, milestoneId, status: status.data, completedAt });
      if (snapshot && snapshot.status === next.status && snapshot.title === next.title && snapshot.milestoneId === next.milestoneId && snapshot.completedAt === next.completedAt) continue;
      const created = event.action === 'assignment.assign' || event.action === 'assignment.claim' || event.action === 'create_personal';
      append(next, event.actor_id, snapshot ? snapshot.status !== next.status ? 'status_changed' : 'updated' : created ? 'created' : 'migrated', event.created_at, event.id);
    }
    // 迁移基线按实际迁移时刻落账；不能将今天观察到的状态提前写到旧区间。
    append(current, decisions.actorId, 'migrated', now, 'migration', true);
    row.version = requireValue(snapshot, 'NO_MIGRATION_EVENT').version;
    row.history_known_from = requireValue(events.find((event) => event.task_id === current.id)?.occurred_at, 'NO_HISTORY_TIME');
  }
  plan.rows.set('v2_task_events', events);
}

const arrangement = z.object({ id: z.string(), assignmentId: z.string(), plannedDays: z.number().nullable() });
const draftSnapshot = z.object({ arrangements: z.array(arrangement) });

/** 通过每次安排的前后快照重建有效片段，取消和再加入不会覆盖旧计划事实。 */
export function addArrangementHistory(plan: MigrationPlan, source: LegacySource, decisions: MigrationDecisions, now: string): void {
  const history = plan.rows.get('v2_arrangement_history') ?? [];
  const open = new Map<string, SqlRow>();
  const periodId = (team: string, week: string) => requireValue((plan.rows.get('v2_periods') ?? []).find((row) => row.team_id === team && row.start_on === week)?.id, 'MISSING_HISTORY_PERIOD');
  for (const event of source.weeklyEvents) {
    const before = draftSnapshot.safeParse(event.payload_json.before), after = draftSnapshot.safeParse(event.payload_json.after);
    const command = z.object({ week: z.string() }).safeParse(event.payload_json.command);
    if (!before.success || !after.success || !command.success) continue;
    const week = command.data.week, period = periodId(event.team_id, week);
    const old = new Map(before.data.arrangements.map((row) => [row.id, row])), next = new Map(after.data.arrangements.map((row) => [row.id, row]));
    for (const value of before.data.arrangements) {
      const task = plan.taskSources.get(value.assignmentId); if (!task) continue;
      const key = `${task}:${period}`, later = next.get(value.id);
      if (!later || later.plannedDays !== value.plannedDays) {
        const previous = open.get(key);
        if (previous) previous.valid_until = dbTime(event.created_at);
        else plan.warnings.push(`UNKNOWN_OLD_ARRANGEMENT:${value.id}`);
        open.delete(key);
      }
    }
    for (const value of after.data.arrangements) {
      const task = plan.taskSources.get(value.assignmentId); if (!task) continue;
      const earlier = old.get(value.id), key = `${task}:${period}`;
      if (earlier && earlier.plannedDays === value.plannedDays) continue;
      const row = { id: targetId('arrangement-event', `${event.id}:${value.id}`), task_id: task, period_id: period, actor_id: event.actor_id, planned_days: value.plannedDays, provenance: 'scheduled', valid_from: dbTime(event.created_at), valid_until: null };
      if (open.has(key)) throw new Error('OVERLAPPING_ARRANGEMENT_HISTORY');
      history.push(row); open.set(key, row);
    }
  }
  for (const row of plan.rows.get('v2_arrangements') ?? []) {
    const key = `${row.task_id}:${row.period_id}`;
    const previous = open.get(key);
    const supplemented = history.some((entry) => entry.task_id === row.task_id && entry.period_id === row.period_id && entry.provenance === 'migration_supplement');
    if (supplemented) continue;
    if (previous && previous.planned_days !== row.planned_days) throw new Error('ARRANGEMENT_HISTORY_VALUE_MISMATCH');
    if (!previous) {
      history.push({ id: targetId('unknown-arrangement', key), task_id: row.task_id ?? null, period_id: row.period_id ?? null, actor_id: decisions.actorId, planned_days: row.planned_days ?? null, provenance: 'migration_unknown', valid_from: dbTime(now), valid_until: null });
      plan.warnings.push(`UNKNOWN_CURRENT_ARRANGEMENT:${key}`);
    }
  }
  for (const [key, row] of open) if (!(plan.rows.get('v2_arrangements') ?? []).some((entry) => entry.task_id === row.task_id && entry.period_id === row.period_id)) throw new Error(`REVIEW_UNCLOSED_ARRANGEMENT_${key}`);
  plan.rows.set('v2_arrangement_history', history);
}
