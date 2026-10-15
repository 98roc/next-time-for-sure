import { z } from 'zod';
import { reportWeekSchema } from './assignments.js';
import { publicationRowSchema } from './reporting.js';

/** 周计划选择器只返回可执行分工，不代表已经生成周安排或投入承诺。 */
export const weeklyCandidatesQuerySchema = z.object({ teamId: z.string().uuid(), week: reportWeekSchema }).strict();
export const weeklyCandidatesSchema = z.object({
  teamId: z.string().uuid(), week: reportWeekSchema,
  assignments: z.array(z.object({
    assignmentId: z.string().uuid(), assignmentVersion: z.number().int().nonnegative(),
    taskId: z.string().uuid(), taskVersion: z.number().int().nonnegative(),
    projectId: z.string().uuid(), projectName: z.string(), taskTitle: z.string(),
    accountId: z.string().uuid(), displayName: z.string(), groupId: z.string().uuid().nullable(), groupName: z.string(),
    content: z.string(), status: z.enum(['not_started', 'in_progress']), blockedReason: z.string(),
  })),
});
export type WeeklyCandidates = z.infer<typeof weeklyCandidatesSchema>;

const id = z.string().uuid();
const version = z.number().int().nonnegative();
/** 投入以十进制字符串传输，避免金额式小数在浮点累计中丢失精度。 */
export const plannedDaysSchema = z.string().regex(/^(0|[1-9]\d{0,3})(\.\d{1,2})?$/).nullable();
const arrangementFields = { assignmentId: id, assignmentVersion: version, taskVersion: version, version: version.nullable(), goal: z.string().trim().max(2000), expectedProgress: z.number().int().min(0).max(100).nullable(), plannedDays: plannedDaysSchema };
export const weeklyPlanCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save_arrangements'), teamId: id, week: reportWeekSchema, arrangements: z.array(z.object(arrangementFields).strict()).min(1).max(100).refine((rows) => new Set(rows.map((row) => row.assignmentId)).size === rows.length, '分工不能重复') }).strict(),
  z.object({ action: z.literal('move_arrangement'), teamId: id, week: reportWeekSchema, arrangementId: id, version, targetWeek: reportWeekSchema, targetVersion: version.nullable() }).strict(),
  z.object({ action: z.literal('publish_plan'), teamId: id, week: reportWeekSchema, confirmation: z.string(), reason: z.string().trim().max(2000).default('') }).strict(),
  z.object({ action: z.literal('remove_arrangement'), teamId: id, week: reportWeekSchema, arrangementId: id, version }).strict(),
  z.object({ action: z.literal('add_pending'), teamId: id, week: reportWeekSchema, taskId: id, taskVersion: version }).strict(),
  z.object({ action: z.literal('remove_pending'), teamId: id, week: reportWeekSchema, pendingId: id, version }).strict(),
  z.object({ action: z.literal('ensure_draft'), teamId: id, week: reportWeekSchema }).strict(),
  z.object({ action: z.literal('save_arrangement'), teamId: id, week: reportWeekSchema, ...arrangementFields }).strict(),
  z.object({ action: z.literal('carry_forward'), teamId: id, week: reportWeekSchema }).strict(),
]);
export type WeeklyPlanCommand = z.infer<typeof weeklyPlanCommandSchema>;
export const weeklyArrangementSchema = z.object({ id, assignmentId: id, version, goal: z.string(), expectedProgress: z.number().nullable(), plannedDays: plannedDaysSchema, sourceWeek: reportWeekSchema.nullable() });
export const weeklyDraftSchema = z.object({ id, teamId: id, week: reportWeekSchema, version, hasUnpublishedChanges: z.boolean(), arrangements: z.array(weeklyArrangementSchema), rows: z.array(publicationRowSchema), pending: z.array(z.object({ id, taskId: id, version, sourceWeek: reportWeekSchema.nullable() })) }).nullable();
export type WeeklyArrangement = z.infer<typeof weeklyArrangementSchema>;
export const weeklyDraftResponseSchema = z.object({ draft: weeklyDraftSchema });
