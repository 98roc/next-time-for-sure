import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { v2DateSchema, v2IdSchema, v2StatusSchema, v2PlannedDaysSchema } from '@ntfs/contracts';

const id = v2IdSchema;
const instant = z.union([z.date(), z.string()]).transform((value) => value instanceof Date ? value.toISOString() : new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).toISOString());
const date = z.union([z.date(), v2DateSchema]).transform((value) => value instanceof Date ? value.toISOString().slice(0, 10) : value);
const json = z.unknown().transform((value): unknown => typeof value === 'string' ? JSON.parse(value) : value);
const event = z.object({ id, object_id: id, actor_id: id, action: z.string(), payload_json: json.pipe(z.record(z.string(), z.unknown())), created_at: instant });

/** 只读取迁移所需业务字段；认证表在备份及原库中原样保留，不进入业务计划。 */
export async function readSource(db: EntityManager) {
  const accounts = z.array(z.object({ id, team_id: id.nullable(), display_name: z.string(), is_super_admin: z.coerce.boolean(), disabled: z.coerce.boolean() })).parse(await db.query('SELECT id,team_id,display_name,is_super_admin,disabled FROM accounts'));
  const teams = z.array(z.object({ id, leader_id: id })).parse(await db.query('SELECT id,leader_id FROM teams'));
  const projects = z.array(z.object({ id, team_id: id, name: z.string(), archived: z.coerce.boolean() })).parse(await db.query('SELECT id,team_id,name,archived FROM projects'));
  const members = z.array(z.object({ project_id: id, account_id: id, roles_json: json.pipe(z.array(z.enum(['project_manager', 'project_lead', 'developer']))) })).parse(await db.query('SELECT project_id,account_id,roles_json FROM project_members'));
  const tasks = z.array(z.object({ id, project_id: id, request_id: id.nullable(), parent_id: id.nullable(), milestone_id: id.nullable(), title: z.string(), status: z.string(), created_at: instant, updated_at: instant })).parse(await db.query('SELECT id,project_id,request_id,parent_id,milestone_id,title,status,created_at,updated_at FROM team_tasks'));
  const assignments = z.array(z.object({ id, task_id: id, account_id: id, status: z.enum(['not_started', 'in_progress', 'completed', 'exited', 'transferred']), started_at: instant.nullable(), ended_at: instant.nullable(), created_at: instant, updated_at: instant })).parse(await db.query('SELECT id,task_id,account_id,status,started_at,ended_at,created_at,updated_at FROM task_assignments'));
  const personal = z.array(z.object({ id, owner_id: id, kind: z.enum(['work', 'private']), project_id: id.nullable(), assignment_id: id.nullable(), category_id: id.nullable(), title: z.string(), status: v2StatusSchema, position: z.number().int(), ended_at: instant.nullable(), created_at: instant, updated_at: instant })).parse(await db.query('SELECT id,owner_id,kind,project_id,assignment_id,category_id,title,status,position,ended_at,created_at,updated_at FROM personal_items'));
  const categories = z.array(z.object({ id, owner_id: id, name: z.string(), status: v2StatusSchema })).parse(await db.query('SELECT id,owner_id,name,status FROM personal_categories ORDER BY id'));
  const milestones = z.array(z.object({ id, project_id: id, owner_id: id, title: z.string(), status: z.enum(['open', 'completed', 'removed']), expected_on: date.nullable(), created_at: instant, updated_at: instant })).parse(await db.query('SELECT id,project_id,owner_id,title,status,expected_on,created_at,updated_at FROM project_milestones'));
  const requests = z.array(z.object({ id, project_id: id, submitter_id: id, title: z.string(), status: z.string(), created_at: instant })).parse(await db.query('SELECT id,project_id,submitter_id,title,status,created_at FROM work_requests'));
  const drafts = z.array(z.object({ id, team_id: id, week: date })).parse(await db.query('SELECT id,team_id,week FROM weekly_drafts'));
  const arrangements = z.array(z.object({ id, draft_id: id, assignment_id: id, planned_days: z.coerce.number().nullable().pipe(v2PlannedDaysSchema), goal: z.string() })).parse(await db.query('SELECT id,draft_id,assignment_id,planned_days,goal FROM weekly_arrangements ORDER BY id'));
  const workEvents = z.array(event).parse(await db.query('SELECT id,object_id,actor_id,action,payload_json,created_at FROM work_events ORDER BY created_at,id'));
  const personalEvents = z.array(event).parse(await db.query('SELECT id,object_id,owner_id AS actor_id,action,payload_json,created_at FROM personal_events ORDER BY created_at,id'));
  const weeklyEvents = z.array(event.omit({ object_id: true }).extend({ team_id: id })).parse(await db.query('SELECT id,team_id,actor_id,action,payload_json,created_at FROM weekly_events ORDER BY created_at,id'));
  const reports = z.array(z.object({ id, team_id: id, week: date, entries_json: json.pipe(z.array(z.object({ title: z.string(), text: z.string(), projectName: z.string(), edited: z.boolean(), excluded: z.boolean() }).passthrough())) })).parse(await db.query('SELECT id,team_id,week,entries_json FROM report_drafts'));
  const publications = z.array(z.object({ id, team_id: id, week: date, kind: z.enum(['plan', 'report']), revision: z.number(), created_at: instant, payload_json: json.pipe(z.object({ rows: z.array(z.object({ title: z.string(), text: z.string(), person: z.string(), projectName: z.string(), sourceIds: z.array(id) }).passthrough()), next: z.array(z.unknown()).optional() }).passthrough()) })).parse(await db.query('SELECT id,team_id,week,kind,revision,created_at,payload_json FROM weekly_publications ORDER BY week,revision'));
  return { accounts, teams, projects, members, tasks, assignments, personal, categories, milestones, requests, drafts, arrangements, workEvents, personalEvents, weeklyEvents, reports, publications };
}

export type LegacySource = Awaited<ReturnType<typeof readSource>>;
export type LegacyEvent = LegacySource['workEvents'][number];

/** 例外逐条绑定旧标识与原创建日；不因后来出现同类问题扩大已有授权。 */
export const migrationDecisionsSchema = z.object({ actorId: id, supplements: z.array(z.object({ sourceTable: z.enum(['task_assignments', 'personal_items']), sourceId: id, createdOn: v2DateSchema, startOn: v2DateSchema }).strict()) }).strict();
export type MigrationDecisions = z.infer<typeof migrationDecisionsSchema>;
