import { z } from 'zod';
import { assignmentSchema, reportWeekSchema } from './assignments.js';
import { teamTaskSchema, workEventSchema, workCreationTagsSchema } from './work.js';

const id = z.string().uuid();
const version = z.number().int().nonnegative();
const title = z.string().trim().min(1).max(200);
const content = z.string().trim().max(20000);
const checklist = z.array(z.object({ id, title, checked: z.boolean() }).strict()).max(100).refine((items) => new Set(items.map((item) => item.id)).size === items.length, '检查项标识不能重复');
export const personalStatusSchema = z.enum(['not_started', 'in_progress', 'completed']);
export type PersonalStatus = z.infer<typeof personalStatusSchema>;
export const personalStatusLabels = { not_started: '未开始', in_progress: '进行中', completed: '已完成' };
export const personalCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('import_assignment'), assignmentId: id, categoryId: id.nullable(), split: z.boolean(), title: title.optional(), operationId: id }).strict(),
  z.object({ action: z.literal('manage_link'), itemId: id, assignmentId: id.nullable(), version }).strict(),
  z.object({ action: z.literal('create_personal'), kind: z.enum(['work', 'private']), projectId: id.nullable(), assignmentId: id.nullable(), title, description: content, acceptance: content, categoryId: id.nullable(), operationId: id, tags: workCreationTagsSchema.optional() }).strict(),
  z.object({ action: z.literal('edit_personal'), itemId: id, title, description: content, acceptance: content, checklist, plannedOn: z.iso.date().nullable(), blockedReason: content, version }).strict(),
  z.object({ action: z.literal('link_personal'), itemId: id, assignmentId: id.nullable(), version }).strict(),
  z.object({ action: z.literal('start_personal'), itemId: id, categoryId: id.optional(), version }).strict(),
  z.object({ action: z.literal('complete_personal'), itemId: id, categoryId: id.optional(), version }).strict(),
  z.object({ action: z.literal('personal_progress'), itemId: id, occurredOn: z.iso.date(), reportWeek: reportWeekSchema, content: content.min(1), version, operationId: id }).strict(),
  z.object({ action: z.literal('personal_times'), itemId: id, startedAt: z.iso.datetime().nullable(), endedAt: z.iso.datetime().nullable(), version }).strict(),
  z.object({ action: z.literal('move_personal'), itemId: id, categoryId: id.nullable(), position: z.number().int().nonnegative().max(1000000), version }).strict(),
  z.object({ action: z.literal('insert_personal'), itemId: id, categoryId: id.nullable(), beforeId: id.nullable(), version, order: z.array(z.object({ id, version }).strict()).max(5000) }).strict(),
  z.object({ action: z.literal('create_category'), name: title, status: personalStatusSchema.optional(), operationId: id }).strict(),
  z.object({ action: z.literal('rename_category'), categoryId: id, name: title, version }).strict(),
  z.object({ action: z.literal('delete_category'), categoryId: id, targetCategoryId: id.optional(), version }).strict(),
]);
export type PersonalCommand = z.infer<typeof personalCommandSchema>;
export const personalCategorySchema = z.object({ id, ownerId: id, name: title, status: personalStatusSchema, version });
export const personalItemSchema = z.object({ id, ownerId: id, kind: z.enum(['work', 'private']), projectId: id.nullable(), assignmentId: id.nullable(), title, description: content, acceptance: content, status: personalStatusSchema, checklist, categoryId: id.nullable(), position: z.number().int(), plannedOn: z.iso.date().nullable(), blockedReason: content, version, startedAt: z.string().nullable(), endedAt: z.string().nullable(), stopReason: z.string().nullable().default(null) });
export type PersonalItem = z.infer<typeof personalItemSchema>;
export const personalProgressSchema = z.object({ id, itemId: id, occurredOn: z.iso.date(), reportWeek: reportWeekSchema, content, createdAt: z.string() });
export const personalSnapshotSchema = z.object({ items: z.array(personalItemSchema), categories: z.array(personalCategorySchema), progress: z.array(personalProgressSchema) });
export type PersonalSnapshot = z.infer<typeof personalSnapshotSchema>;
/** 团队工作目录只含当前可访问项目的团队事实，不含其他人的个人事项。 */
export const personalTeamWorkSchema = z.object({ projects: z.array(z.object({ id, name: z.string(), archived: z.boolean() })), tasks: z.array(teamTaskSchema), assignments: z.array(assignmentSchema) });
export type PersonalTeamWork = z.infer<typeof personalTeamWorkSchema>;
const historyTimes = z.object({ startedAt: z.string().nullable(), endedAt: z.string().nullable() }).nullable().optional();
/** 历史保留完整载荷，同时校验页面展示的前后时间，管理关联事件可没有时间快照。 */
export const personalHistorySchema = z.array(workEventSchema.extend({ payload: z.object({ before: historyTimes, after: historyTimes }).passthrough() }));
