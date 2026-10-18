import { createHash } from 'node:crypto';
import { v2TaskSchema, v2StatusLabels, v2StatusSchema, v2CategorySchema, type V2Task } from '@ntfs/contracts';
import { z } from 'zod';
import { naturalWeek, shanghaiDate, shiftDate } from '../../v2/calendar.js';
import type { LegacySource, MigrationDecisions } from './source.js';

export type SqlRow = Record<string, string | number | null>;
export type MigrationPlan = { rows: Map<string, SqlRow[]>; warnings: string[]; taskSources: Map<string, string> };

/** 固定命名空间产生稳定 UUID，失败重跑和一对多映射不依赖随机数。 */
export function targetId(kind: string, source: string): string {
  const hex = createHash('sha256').update(`ntfs-v2:${kind}:${source}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** 业务日期和 UTC 时间不得混用，数据库 DATETIME 统一存协调世界时。 */
export function dbTime(value: string | null): string | null { return value === null ? null : value.replace('T', ' ').replace('Z', ''); }
export function requireValue<T>(value: T | undefined | null, reason: string): T { if (value === undefined || value === null) throw new Error(reason); return value; }

/** 构建完整可审查计划，所有异常在写事务前拒绝；不修改传入来源。 */
export function buildPlan(source: LegacySource, decisions: MigrationDecisions, now: string): MigrationPlan {
  const rows = new Map<string, SqlRow[]>(), warnings: string[] = [], taskSources = new Map<string, string>();
  const put = (table: string, row: SqlRow) => { const list = rows.get(table) ?? []; list.push(row); rows.set(table, list); };
  const map = (table: string, oldId: string, kind: string, newId: string, decision: string) => put('v2_migration_map', { source_table: table, source_id: oldId, target_kind: kind, target_id: newId, decision, migrated_at: dbTime(now) });
  const project = (id: string) => requireValue(source.projects.find((row) => row.id === id), 'MISSING_PROJECT');
  const actor = (id: string) => requireValue(source.accounts.find((row) => row.id === id), 'MISSING_ACCOUNT');
  actor(decisions.actorId);
  if (source.projects.some((row) => row.archived) || source.tasks.some((row) => row.parent_id || row.status === 'cancelled')) throw new Error('REVIEW_ARCHIVE_PARENT_OR_CANCELLED');
  for (const p of source.projects) for (const role of ['project_manager', 'project_lead']) if (!source.members.some((member) => member.project_id === p.id && member.roles_json.includes(role === 'project_manager' ? 'project_manager' : 'project_lead') && !actor(member.account_id).disabled)) throw new Error('REVIEW_PROJECT_ROLE_VACANCY');
  const inactive = source.assignments.filter((row) => row.status === 'exited' || row.status === 'transferred');
  if (inactive.some((row) => row.started_at || row.ended_at)) throw new Error('REVIEW_INACTIVE_EXECUTION_HISTORY');
  if (source.personal.some((item) => item.assignment_id && inactive.some((row) => row.id === item.assignment_id))) throw new Error('REVIEW_INACTIVE_PERSONAL_ITEM');
  for (const assignment of source.assignments) if (source.personal.filter((row) => row.assignment_id === assignment.id).length > 1) throw new Error('REVIEW_MULTIPLE_PERSONAL_ALIASES');
  const supplemented = new Set<string>();
  const supplement = (table: 'task_assignments' | 'personal_items', id: string, createdAt: string) => {
    const decision = decisions.supplements.find((entry) => entry.sourceTable === table && entry.sourceId === id);
    if (!decision || decision.createdOn !== shanghaiDate(createdAt) || naturalWeek(decision.startOn).startOn !== decision.startOn) throw new Error(`REVIEW_MISSING_PERIOD_${id}`);
    supplemented.add(`${table}:${id}`); return decision.startOn;
  };

  // 连续日期目录覆盖来源所有周及当前周前后二周；绝不根据旧标签自动排期。
  const periods = new Map<string, string>();
  for (const team of source.teams) {
    put('v2_team_settings', { team_id: team.id, message: '', timezone: 'Asia/Shanghai', version: 0 });
    const current = naturalWeek(shanghaiDate(now)).startOn;
    const weeks = [shiftDate(current, -14), shiftDate(current, 28), ...source.drafts.filter((row) => row.team_id === team.id).map((row) => row.week), ...source.reports.filter((row) => row.team_id === team.id).map((row) => shiftDate(row.week, -7)), ...source.publications.filter((row) => row.team_id === team.id).flatMap((row) => [shiftDate(row.week, -7), shiftDate(row.week, 7)]), ...decisions.supplements.map((row) => row.startOn)].sort();
    for (let day = requireValue(weeks[0], 'NO_PERIOD'); day <= requireValue(weeks.at(-1), 'NO_PERIOD'); day = shiftDate(day, 7)) {
      const id = targetId('period', `${team.id}:${day}`); periods.set(`${team.id}:${day}`, id);
      put('v2_periods', { id, team_id: team.id, start_on: day, end_on: shiftDate(day, 6), version: 0 });
    }
  }
  const period = (teamId: string, week: string) => requireValue(periods.get(`${teamId}:${week}`), 'MISSING_PERIOD');

  // 保留每个旧分类和顺序，无旧默认标记时优先采用标准状态名称，否则稳定取首项。
  const defaults = new Map<string, string>();
  for (const account of source.accounts.filter((row) => !row.is_super_admin)) {
    put('v2_personal_views', { owner_id: account.id, version: 0 });
    let position = 0;
    for (const status of v2StatusSchema.options) {
      const old = source.categories.filter((row) => row.owner_id === account.id && row.status === status);
      const selected = old.find((row) => row.name === v2StatusLabels[status]) ?? old[0];
      const list = old.length ? old : [{ id: targetId('default', `${account.id}:${status}`), owner_id: account.id, name: v2StatusLabels[status], status }];
      const defaultId = selected ? targetId('category', selected.id) : requireValue(list[0], 'NO_CATEGORY').id;
      defaults.set(`${account.id}:${status}`, defaultId);
      for (const row of list) {
        const id = old.length ? targetId('category', row.id) : row.id;
        v2CategorySchema.parse({ id, ownerId: account.id, name: row.name, status, isDefault: id === defaultId, position, version: 0 });
        put('v2_categories', { id, owner_id: account.id, name: row.name, status, is_default: Number(id === defaultId), position: position++, version: 0 });
        if (old.length) map('personal_categories', row.id, 'category', id, '保留状态分类；同状态标准名称或稳定首项承担默认职责');
      }
    }
  }
  for (const row of source.milestones) {
    const id = targetId('milestone', row.id);
    put('v2_milestones', { id, project_id: row.project_id, owner_id: row.owner_id, title: row.title, expected_on: row.expected_on, status: row.status === 'completed' ? 'completed' : 'open', needs_review: 0, version: 0, deleted_at: row.status === 'removed' ? dbTime(row.updated_at) : null, created_at: dbTime(row.created_at), updated_at: dbTime(row.updated_at) });
    map('project_milestones', row.id, 'milestone', id, row.status === 'removed' ? '保留已移出历史，不恢复当前节点' : '保留日期、责任和状态');
  }
  const creator = (task: LegacySource['tasks'][number]) => {
    if (task.request_id) return requireValue(source.requests.find((row) => row.id === task.request_id), 'MISSING_REQUEST_CREATOR').submitter_id;
    return requireValue(source.workEvents.find((row) => row.object_id === task.id && row.action === 'create_task'), 'MISSING_TASK_CREATOR').actor_id;
  };
  const backlog = (table: string, id: string, projectId: string, creatorId: string, title: string, createdAt: string) => {
    const newId = targetId('backlog', `${table}:${id}`);
    put('v2_backlog', { id: newId, project_id: projectId, creator_id: creatorId, title, priority: 3, created_at: dbTime(createdAt) });
    map(table, id, 'backlog', newId, '未落实执行人，保留标题与原创建人；不迁入审批流程');
  };

  // 多执行人逐条转为独立任务；个人副本只提供该执行人的名称、状态和位置。
  const createTask = (base: LegacySource['tasks'][number] | undefined, assignment: LegacySource['assignments'][number] | undefined, item: LegacySource['personal'][number] | undefined) => {
    const old = requireValue(assignment ?? item, 'MISSING_TASK_SOURCE');
    const kind = item?.kind === 'private' ? 'private' : 'project';
    const projectId = kind === 'private' ? null : requireValue(base?.project_id ?? item?.project_id, 'MISSING_PROJECT');
    const teamId = projectId ? project(projectId).team_id : null;
    const executorId = requireValue(assignment?.account_id ?? item?.owner_id, 'MISSING_EXECUTOR'); actor(executorId);
    if (item && (item.owner_id !== executorId || item.project_id !== projectId)) throw new Error('PERSONAL_SOURCE_MISMATCH');
    const status = v2StatusSchema.parse(item?.status ?? assignment?.status);
    if (projectId && !source.members.some((row) => row.project_id === projectId && row.account_id === executorId) && status !== 'completed') throw new Error('REVIEW_FORMER_EXECUTOR');
    const id = targetId('task', old.id), creatorId = base ? creator(base) : executorId;
    const createdAt = base?.created_at ?? requireValue(item, 'MISSING_PERSONAL').created_at;
    const task = v2TaskSchema.parse({ id, kind, teamId, projectId, creatorId, executorId, milestoneId: base?.milestone_id ? targetId('milestone', base.milestone_id) : null, title: item?.title ?? base?.title, priority: 3, status, completedAt: status === 'completed' ? item?.ended_at ?? assignment?.ended_at ?? null : null, createdAt, updatedAt: now, deletedAt: null, version: 0 });
    put('v2_tasks', { id, kind, team_id: teamId, project_id: projectId, creator_id: creatorId, executor_id: executorId, milestone_id: task.milestoneId, title: task.title, priority: 3, status, completed_at: dbTime(task.completedAt), history_known_from: dbTime(now), version: 0, created_at: dbTime(createdAt), updated_at: dbTime(now) });
    const category = item?.category_id ? source.categories.find((row) => row.id === item.category_id && row.owner_id === executorId && row.status === status) : undefined;
    if (item?.category_id && !category) throw new Error('REVIEW_PERSONAL_CATEGORY_MISMATCH');
    const categoryId = category ? targetId('category', category.id) : requireValue(defaults.get(`${executorId}:${status}`), 'MISSING_DEFAULT_CATEGORY');
    put('v2_placements', { task_id: id, owner_id: executorId, category_id: categoryId, position: item?.position ?? 100000 + taskSources.size });
    if (base) map('team_tasks', base.id, 'task', id, '按有效执行人拆分；不复制跨区间任务');
    if (assignment) { taskSources.set(assignment.id, id); map('task_assignments', assignment.id, 'task', id, '保留执行人及有效状态'); }
    if (item) { taskSources.set(item.id, id); map('personal_items', item.id, 'task', id, kind === 'private' ? '私人任务仅所有人可见' : '个人名称、状态和位置合入同一项目任务'); }
    const current = assignment ? source.arrangements.filter((row) => row.assignment_id === assignment.id) : [];
    if (kind === 'project' && teamId) {
      if (!current.length) {
        const table = assignment ? 'task_assignments' : 'personal_items';
        const week = supplement(table, old.id, old.created_at), periodId = period(teamId, week);
        put('v2_arrangements', { task_id: id, period_id: periodId, team_id: teamId, planned_days: null, position: taskSources.size });
        put('v2_arrangement_history', { id: targetId('supplement', id), task_id: id, period_id: periodId, actor_id: decisions.actorId, planned_days: null, provenance: 'migration_supplement', valid_from: dbTime(now), valid_until: null });
        warnings.push(`SUPPLEMENT:${table}:${old.id}:${week}`);
      }
      for (const arrangement of current) {
        const draft = requireValue(source.drafts.find((row) => row.id === arrangement.draft_id), 'MISSING_DRAFT');
        if (draft.team_id !== teamId) throw new Error('ARRANGEMENT_TEAM_MISMATCH');
        const periodId = period(teamId, draft.week);
        put('v2_arrangements', { task_id: id, period_id: periodId, team_id: teamId, planned_days: arrangement.planned_days, position: source.arrangements.indexOf(arrangement) });
        map('weekly_arrangements', arrangement.id, 'arrangement', id, `目标为任务 ${id} 与区间 ${periodId} 的组合；保留本区间预计天数，不重复分摊`);
      }
    }
    return task;
  };
  for (const task of source.tasks) {
    const assignments = source.assignments.filter((row) => row.task_id === task.id && v2StatusSchema.safeParse(row.status).success);
    if (!assignments.length) backlog('team_tasks', task.id, task.project_id, creator(task), task.title, task.created_at);
    for (const assignment of assignments) createTask(task, assignment, source.personal.find((row) => row.assignment_id === assignment.id));
  }
  for (const item of source.personal.filter((row) => !row.assignment_id)) createTask(undefined, undefined, item);
  for (const request of source.requests) if (!source.tasks.some((row) => row.request_id === request.id)) {
    if (request.status === 'accepted') throw new Error('REVIEW_ACCEPTED_REQUEST_WITHOUT_TASK');
    backlog('work_requests', request.id, request.project_id, request.submitter_id, request.title, request.created_at);
  }
  for (const decision of decisions.supplements) if (!supplemented.has(`${decision.sourceTable}:${decision.sourceId}`)) throw new Error('SUPPLEMENT_APPROVAL_NO_LONGER_MATCHES');
  return { rows, warnings, taskSources };
}

/** 迁移事件解析时只承接已定义字段，旧说明、清单、进度与权限不能混入新版快照。 */
export const legacySnapshotSchema = z.object({ id: z.string(), title: z.string().optional(), status: z.string().optional(), accountId: z.string().optional(), ownerId: z.string().optional(), milestoneId: z.string().nullable().optional(), endedAt: z.string().nullable().optional() }).passthrough();

/** 将当前计划中的 SQL 行恢复为严格业务快照，用于事件与后续回读校验。 */
export function plannedTask(row: SqlRow): V2Task {
  const instant = (value: string | number | null | undefined) => typeof value === 'string' ? new Date(`${value.replace(' ', 'T')}Z`).toISOString() : null;
  return v2TaskSchema.parse({ id: row.id, kind: row.kind, teamId: row.team_id, projectId: row.project_id, creatorId: row.creator_id, executorId: row.executor_id, milestoneId: row.milestone_id, title: row.title, priority: row.priority, status: row.status, completedAt: instant(row.completed_at), version: row.version, deletedAt: null, createdAt: instant(row.created_at), updatedAt: instant(row.updated_at) });
}
