import { z } from 'zod';
import { v2PersonalPreferencesSchema } from './v2-personal-work.js';
import { v2WorkNoteSchema, v2CompletionSchema, v2ArrangementsInputSchema } from './v2.js';
import { v2IdSchema as id, v2VersionSchema as version, v2InstantSchema, v2RequiredPlannedDaysSchema, v2StatusSchema, v2PrioritySchema, v2DateSchema, v2PeriodSchema, v2CategorySchema, v2MilestoneSchema, v2TaskSchema, v2TaskEventSchema, v2ProjectTaskInputSchema } from './v2.js';
import { directoryAccountSchema, projectRoleSchema, teamSchema } from './organization.js';

const operation = { operationId: id };
const confirmation = z.string().regex(/^[a-f0-9]{64}$/u);
const name = z.string().trim().min(1).max(100);
/** 首页标语按团队维护；限制列表大小，去除空白项，空列表表示隐藏。 */
export const v2TeamMessageLimits = { count: 50, length: 500 };
export const v2TeamMessagesSchema = z.array(z.string().trim().max(v2TeamMessageLimits.length)).max(v2TeamMessageLimits.count).transform((messages) => messages.filter(Boolean));
export const v2ProjectSchema = z.object({ id, teamId: id, name, version, members: z.array(z.object({ accountId: id, roles: z.array(projectRoleSchema) })), canManage: z.boolean(), canCreate: z.boolean(), canConfirmMilestone: z.boolean() });
export const v2BacklogSchema = z.object({ id, createdAt: v2InstantSchema, projectId: id, creatorId: id, title: z.string(), priority: v2PrioritySchema, version, convertedTaskId: id.nullable(), deletedAt: v2InstantSchema.nullable() });
export type V2Backlog = z.infer<typeof v2BacklogSchema>;
export const v2ArrangementSchema = z.object({ taskId: id, periodId: id, plannedDays: z.number().nullable(), position: z.number().int(), version, workNote: v2WorkNoteSchema.optional(), carriedFromPeriodId: id.nullable().optional() });
export type V2Arrangement = z.infer<typeof v2ArrangementSchema>;
export const v2PlacementSchema = z.object({ taskId: id, categoryId: id, position: z.number().int() });
export const v2OrderSchema = z.object({ ids: z.array(id), version, manual: z.boolean().default(false) });
export const v2WorkspaceSchema = z.object({
  personalPreferences: v2PersonalPreferencesSchema,
  team: teamSchema.nullable(), teamMessages: v2TeamMessagesSchema, teamVersion: version, teamLeader: z.boolean(), today: v2DateSchema, naturalWeekStart: v2DateSchema,
  accounts: z.array(directoryAccountSchema), projects: z.array(v2ProjectSchema), periods: z.array(v2PeriodSchema),
  tasks: z.array(v2TaskSchema), arrangements: z.array(v2ArrangementSchema), milestones: z.array(v2MilestoneSchema), backlog: z.array(v2BacklogSchema),
  categories: z.array(v2CategorySchema), placements: z.array(v2PlacementSchema), personalVersion: version, orders: z.array(v2OrderSchema.extend({ scope: z.string() })),
});
export type V2Workspace = z.infer<typeof v2WorkspaceSchema>;

/** 个人视图修改整体版本化；服务读取全量位置，筛选不影响隐藏任务。 */
export const v2PersonalCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...operation, action: z.literal('create_category'), version, name, status: v2StatusSchema, isDefault: z.boolean() }).strict(),
  z.object({ ...operation, action: z.literal('rename_category'), version, categoryId: id, name }).strict(),
  z.object({ ...operation, action: z.literal('default_category'), version, categoryId: id }).strict(),
  z.object({ ...operation, action: z.literal('delete_category'), version, categoryId: id, receiverId: id, confirmation }).strict(),
  z.object({ ...operation, action: z.literal('move_task'), version, taskId: id, taskVersion: version, categoryId: id, beforeTaskId: id.nullable(), completion: v2CompletionSchema.optional() }).strict(),
  z.object({ ...operation, action: z.literal('move_category'), version, categoryId: id, beforeCategoryId: id.nullable() }).strict(),
  z.object({ ...operation, action: z.literal('reorder_priority'), version }).strict(),
  z.object({ ...operation, action: z.literal('reset_order'), version }).strict(),
]);
export type V2PersonalCommand = z.infer<typeof v2PersonalCommandSchema>;

/** 编辑目标与解除关联作为一次保存；任务版本绑定打开编辑器时的快照。 */
const milestoneEdit = {
  milestoneId: id, version, title: z.string().trim().min(1).max(200), expectedOn: v2DateSchema.nullable(),
  unlinkTasks: z.array(z.object({ taskId: id, version }).strict()).max(500).refine((rows) => new Set(rows.map((row) => row.taskId)).size === rows.length, '关联任务不可重复').optional(),
};

export const v2ProjectCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...operation, action: z.literal('create_backlog'), projectId: id, title: z.string().trim().min(1).max(200), priority: v2PrioritySchema }).strict(),
  z.object({ ...operation, action: z.literal('edit_backlog'), backlogId: id, version, title: z.string().trim().min(1).max(200), priority: v2PrioritySchema }).strict(),
  z.object({ ...operation, action: z.literal('delete_backlog'), backlogId: id, version, confirmation }).strict(),
  z.object({ ...operation, action: z.literal('convert_backlog'), backlogId: id, version, task: v2ProjectTaskInputSchema }).strict(),
  z.object({ ...operation, action: z.literal('create_milestone'), projectId: id, title: z.string().trim().min(1).max(200), expectedOn: v2DateSchema.nullable() }).strict(),
  z.object({ ...operation, action: z.literal('edit_milestone'), ...milestoneEdit, confirmation: confirmation.optional() }).strict(),
  z.object({ ...operation, action: z.literal('complete_milestone'), milestoneId: id, version, confirmation }).strict(),
  z.object({ ...operation, action: z.literal('reopen_milestone'), milestoneId: id, version, confirmation }).strict(),
  z.object({ ...operation, action: z.literal('unlink_milestone'), taskId: id, version, confirmation }).strict(),
]);
export type V2ProjectCommand = z.infer<typeof v2ProjectCommandSchema>;

export const v2PeriodChangeSchema = z.object({ periodId: id, version, startOn: v2DateSchema, endOn: v2DateSchema }).strict();
export const v2PlanningCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...operation, action: z.literal('extend_periods'), direction: z.enum(['before', 'after']), version }).strict(),
  z.object({ ...operation, action: z.literal('change_periods'), version, periods: z.array(v2PeriodChangeSchema).min(1).max(500), confirmation }).strict(),
  z.object({ ...operation, action: z.literal('reorder_projects'), periodId: id.optional(), page: z.enum(['projects', 'weekly']).default('weekly'), reset: z.boolean().default(false), version, projectIds: z.array(id).max(500) }).strict(),
  z.object({ ...operation, action: z.literal('reorder_project_items'), projectId: id, target: z.enum(['tasks', 'backlog']), reset: z.boolean().default(false), version, ids: z.array(id).max(500) }).strict(),
  z.object({ ...operation, action: z.literal('reorder_tasks'), projectId: id, periodId: id, view: z.enum(['summary', 'plan']), executorId: id.optional(), reset: z.boolean().default(false), version, taskIds: z.array(id).max(500) }).strict(),
]);
export type V2PlanningCommand = z.input<typeof v2PlanningCommandSchema>;
export const v2ReportCommandSchema = z.object({ ...operation, action: z.enum(['save', 'verify', 'regenerate']), summaryPeriodId: id, planPeriodId: id, version, sourceHash: confirmation, body: z.string().max(200_000) }).strict();
export type V2ReportCommand = z.infer<typeof v2ReportCommandSchema>;

/** 同一个影响预览服务供页面和 Agent 使用；客户端不能自行构造确认摘要。 */
export const v2ImpactIntentSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('edit_milestone'), ...milestoneEdit }).strict(),
  z.object({ action: z.literal('save_arrangements'), taskId: id, version, arrangements: v2ArrangementsInputSchema }).strict(),
  z.object({ action: z.literal('delete_task'), taskId: id, version }).strict(),
  z.object({ action: z.literal('remove_arrangement'), taskId: id, version, periodId: id }).strict(),
  z.object({ action: z.literal('change_arrangement'), taskId: id, version, periodId: id, targetPeriodId: id }).strict(),
  z.object({ action: z.literal('delete_backlog'), backlogId: id, version }).strict(),
  z.object({ action: z.literal('complete_milestone'), milestoneId: id, version }).strict(),
  z.object({ action: z.literal('reopen_milestone'), milestoneId: id, version }).strict(),
  z.object({ action: z.literal('unlink_milestone'), taskId: id, version }).strict(),
  z.object({ action: z.literal('delete_category'), version, categoryId: id, receiverId: id }).strict(),
  z.object({ action: z.literal('change_periods'), version, periods: z.array(v2PeriodChangeSchema).min(1).max(500) }).strict(),
]);
export type V2ImpactIntent = z.infer<typeof v2ImpactIntentSchema>;
export const v2ImpactSchema = z.object({ confirmation, title: z.string(), details: z.array(z.string()), blockers: z.array(z.string()) });
export type V2Impact = z.infer<typeof v2ImpactSchema>;
export const v2TaskHistorySchema = z.array(v2TaskEventSchema);

export const v2SummaryRowSchema = z.object({ taskId: id, createdAt: v2InstantSchema.nullable().default(null), title: z.string().nullable(), executorId: id.nullable(), executorName: z.string().nullable(), projectId: id.nullable(), status: v2StatusSchema.nullable(), priority: v2PrioritySchema.nullable(), workNote: v2WorkNoteSchema.optional(), carriedFromPeriodId: id.nullable().optional(), arranged: z.boolean(), executed: z.boolean(), planning: z.enum(['planned', 'unplanned', 'unknown']), historyIncomplete: z.boolean() });
export type V2SummaryRow = z.infer<typeof v2SummaryRowSchema>;
export const v2WeeklyStateSchema = z.object({
  summaryPeriod: v2PeriodSchema, planPeriod: v2PeriodSchema, summary: z.array(v2SummaryRowSchema),
  projectOrder: v2OrderSchema, taskOrders: z.array(v2OrderSchema.extend({ projectId: id, periodId: id })),
  text: z.object({ body: z.string(), manual: z.boolean(), sourceHash: z.string(), version, stale: z.boolean() }),
  generatedText: z.string(), currentSourceHash: z.string(), canEditText: z.boolean(),
});
export type V2WeeklyState = z.infer<typeof v2WeeklyStateSchema>;
export const v2PeriodPairSchema = z.object({ summaryPeriodId: id, planPeriodId: id }).strict();

/** 保存完整项目成员集合，两种负责人均可多人；角色至少一种，成员不可重复。 */
export const v2ProjectMembersSchema = z.array(z.object({ accountId: id, roles: z.array(projectRoleSchema).min(1).max(3).refine((roles) => new Set(roles).size === roles.length, '角色不可重复') }).strict()).min(1).max(500).refine((members) => new Set(members.map((member) => member.accountId)).size === members.length, '成员不可重复');
export const v2TeamCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...operation, action: z.literal('create_project'), name, members: v2ProjectMembersSchema }).strict(),
  z.object({ ...operation, action: z.literal('update_project'), projectId: id, version, name, members: v2ProjectMembersSchema }).strict(),
  z.object({ ...operation, action: z.literal('set_messages'), version, messages: v2TeamMessagesSchema }).strict(),
]);
export type V2TeamCommand = z.infer<typeof v2TeamCommandSchema>;
export const v2MemberImpactInputSchema = z.object({ projectId: id, version, members: v2ProjectMembersSchema }).strict();
export type V2MemberImpactInput = z.infer<typeof v2MemberImpactInputSchema>;
export const v2MemberImpactSchema = z.object({ removedIds: z.array(id), blockers: z.array(z.object({ kind: z.enum(['task', 'role']), id: z.string(), title: z.string(), accountId: id.nullable() })) });

/** 共用编辑弹窗一次保存任务与当前安排，不能出现一半成功一半失败。 */
export const v2TaskEditSchema = z.object({
  ...operation, action: z.literal('save_task'), taskId: id, version,
  details: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('project'), title: z.string().trim().min(1).max(200), priority: v2PrioritySchema, executorId: id, milestoneId: id.nullable() }).strict(),
    z.object({ kind: z.literal('private'), title: z.string().trim().min(1).max(200), priority: v2PrioritySchema }).strict(),
  ]).optional(),
  status: v2StatusSchema.optional(), categoryId: id.optional(), milestoneConfirmation: confirmation.optional(),
  arrangement: z.object({ periodId: id, targetPeriodId: id, plannedDays: v2RequiredPlannedDaysSchema, workNote: v2WorkNoteSchema.optional(), confirmation }).strict().optional(),
  arrangements: v2ArrangementsInputSchema.optional(), arrangementConfirmation: confirmation.optional(), completion: v2CompletionSchema.optional(),
}).strict();
export type V2TaskEdit = z.infer<typeof v2TaskEditSchema>;

/** 消息内容按任务合并，不设已读状态；游标字符串避免数据库大整数精度丢失。 */
export const v2MessageItemSchema = z.object({ taskId: id, projectId: id, projectName: z.string(), title: z.string(), reasons: z.array(z.string()) });
export type V2MessageItem = z.infer<typeof v2MessageItemSchema>;
export const v2MessagesSchema = z.object({ accountId: id, cursor: z.string().regex(/^\d+$/u), page: z.number().int().positive(), total: z.number().int().nonnegative(), messages: z.array(z.object({ id: z.string(), createdAt: v2InstantSchema, items: z.array(v2MessageItemSchema) })) });
export type V2Messages = z.infer<typeof v2MessagesSchema>;
