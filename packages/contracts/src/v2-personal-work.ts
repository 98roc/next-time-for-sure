import { z } from 'zod';
import { v2DateSchema, v2IdSchema as id, v2InstantSchema, v2VersionSchema as version } from './v2.js';

/** 私人子任务只属于当前执行人的个人清单，不接受人员、项目和主任务状态字段。 */
export const v2SubtaskInputSchema = z.object({ id, title: z.string().trim().min(1).max(200), completed: z.boolean() }).strict();
export type V2SubtaskInput = z.infer<typeof v2SubtaskInputSchema>;
export const v2SubtaskSchema = v2SubtaskInputSchema.extend({ completedAt: v2InstantSchema.nullable() });
export type V2Subtask = z.infer<typeof v2SubtaskSchema>;
export const v2SubtasksSchema = z.object({ taskId: id, version, items: z.array(v2SubtaskSchema) });
export type V2Subtasks = z.infer<typeof v2SubtasksSchema>;
export const v2SubtasksCommandSchema = z.object({
  operationId: id, action: z.literal('save_subtasks'), taskId: id, version,
  items: z.array(v2SubtaskInputSchema).max(200).refine((items) => new Set(items.map((item) => item.id)).size === items.length, '子任务不能重复'),
  removedIds: z.array(id).max(200).refine((ids) => new Set(ids).size === ids.length, '删除项不能重复'),
}).strict();
export type V2SubtasksCommand = z.infer<typeof v2SubtasksCommandSchema>;

/** 只记住查看模式；具体日期进入页面时重新取当天或当前区间。 */
export const v2CompletedModeSchema = z.enum(['day', 'period']);
export const v2PersonalPreferencesSchema = z.object({ completedMode: v2CompletedModeSchema, projectOrder: z.array(id).nullable(), version });
export type V2PersonalPreferences = z.infer<typeof v2PersonalPreferencesSchema>;
export const v2PersonalSettingsCommandSchema = z.discriminatedUnion('action', [
  z.object({ operationId: id, action: z.literal('set_completed_mode'), version, mode: v2CompletedModeSchema }).strict(),
  z.object({ operationId: id, action: z.literal('set_daily_project_order'), version, projectIds: z.array(id).max(500).nullable() }).strict(),
]);
export type V2PersonalSettingsCommand = z.infer<typeof v2PersonalSettingsCommandSchema>;
export const v2DailyQuerySchema = z.object({ on: v2DateSchema }).strict();
export const v2DailyReportSchema = z.object({
  on: v2DateSchema, preferences: v2PersonalPreferencesSchema,
  projects: z.array(z.object({ id, name: z.string() })),
  text: z.object({ body: z.string(), manual: z.boolean(), sourceHash: z.string(), version, stale: z.boolean() }),
  generatedText: z.string(), currentSourceHash: z.string(),
});
export type V2DailyReport = z.infer<typeof v2DailyReportSchema>;
export const v2DailyCommandSchema = z.object({
  operationId: id, action: z.enum(['save_daily', 'regenerate_daily', 'verify_daily']), on: v2DateSchema,
  version, sourceHash: z.string().regex(/^[a-f0-9]{64}$/u), body: z.string().max(200_000),
}).strict();
export type V2DailyCommand = z.infer<typeof v2DailyCommandSchema>;
