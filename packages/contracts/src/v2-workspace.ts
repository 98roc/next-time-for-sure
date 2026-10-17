import { z } from 'zod';
import { v2IdSchema as id, v2VersionSchema as version, v2InstantSchema, v2PlannedDaysSchema, v2StatusSchema, v2PrioritySchema, v2DateSchema, v2PeriodSchema, v2CategorySchema, v2MilestoneSchema, v2TaskSchema, v2TaskEventSchema, v2ProjectTaskInputSchema } from './v2.js';
import { directoryAccountSchema, projectRoleSchema, teamSchema } from './organization.js';

const operation = { operationId: id };
const confirmation = z.string().regex(/^[a-f0-9]{64}$/u);
const name = z.string().trim().min(1).max(100);
export const v2ProjectSchema = z.object({ id, teamId: id, name, version, members: z.array(z.object({ accountId: id, roles: z.array(projectRoleSchema) })), canManage: z.boolean(), canCreate: z.boolean(), canConfirmMilestone: z.boolean() });
export const v2BacklogSchema = z.object({ id, projectId: id, creatorId: id, title: z.string(), priority: v2PrioritySchema, version, convertedTaskId: id.nullable(), deletedAt: v2InstantSchema.nullable() });
export type V2Backlog = z.infer<typeof v2BacklogSchema>;
export const v2ArrangementSchema = z.object({ taskId: id, periodId: id, plannedDays: z.number().nullable(), position: z.number().int(), version });
export type V2Arrangement = z.infer<typeof v2ArrangementSchema>;
export const v2PlacementSchema = z.object({ taskId: id, categoryId: id, position: z.number().int() });
export const v2WorkspaceSchema = z.object({
  team: teamSchema.nullable(), teamMessage: z.string(), teamVersion: version, teamLeader: z.boolean(), today: v2DateSchema, naturalWeekStart: v2DateSchema,
  accounts: z.array(directoryAccountSchema), projects: z.array(v2ProjectSchema), periods: z.array(v2PeriodSchema),
  tasks: z.array(v2TaskSchema), arrangements: z.array(v2ArrangementSchema), milestones: z.array(v2MilestoneSchema), backlog: z.array(v2BacklogSchema),
  categories: z.array(v2CategorySchema), placements: z.array(v2PlacementSchema), personalVersion: version,
});
export type V2Workspace = z.infer<typeof v2WorkspaceSchema>;

/** 个人视图修改整体版本化；服务读取全量位置，筛选不影响隐藏任务。 */
export const v2PersonalCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...operation, action: z.literal('create_category'), version, name, status: v2StatusSchema, isDefault: z.boolean() }).strict(),
  z.object({ ...operation, action: z.literal('rename_category'), version, categoryId: id, name }).strict(),
  z.object({ ...operation, action: z.literal('default_category'), version, categoryId: id }).strict(),
  z.object({ ...operation, action: z.literal('delete_category'), version, categoryId: id, receiverId: id, confirmation }).strict(),
  z.object({ ...operation, action: z.literal('move_task'), version, taskId: id, taskVersion: version, categoryId: id, beforeTaskId: id.nullable() }).strict(),
  z.object({ ...operation, action: z.literal('reorder_priority'), version }).strict(),
]);
export type V2PersonalCommand = z.infer<typeof v2PersonalCommandSchema>;

export const v2ProjectCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...operation, action: z.literal('create_backlog'), projectId: id, title: z.string().trim().min(1).max(200), priority: v2PrioritySchema }).strict(),
  z.object({ ...operation, action: z.literal('edit_backlog'), backlogId: id, version, title: z.string().trim().min(1).max(200), priority: v2PrioritySchema }).strict(),
  z.object({ ...operation, action: z.literal('delete_backlog'), backlogId: id, version, confirmation }).strict(),
  z.object({ ...operation, action: z.literal('convert_backlog'), backlogId: id, version, task: v2ProjectTaskInputSchema }).strict(),
  z.object({ ...operation, action: z.literal('create_milestone'), projectId: id, title: z.string().trim().min(1).max(200), expectedOn: v2DateSchema.nullable(), ownerId: id }).strict(),
  z.object({ ...operation, action: z.literal('edit_milestone'), milestoneId: id, version, title: z.string().trim().min(1).max(200), expectedOn: v2DateSchema.nullable(), ownerId: id }).strict(),
  z.object({ ...operation, action: z.literal('complete_milestone'), milestoneId: id, version, confirmation }).strict(),
  z.object({ ...operation, action: z.literal('reopen_milestone'), milestoneId: id, version, confirmation }).strict(),
  z.object({ ...operation, action: z.literal('unlink_milestone'), taskId: id, version, confirmation }).strict(),
]);
export type V2ProjectCommand = z.infer<typeof v2ProjectCommandSchema>;

export const v2PeriodChangeSchema = z.object({ periodId: id, version, startOn: v2DateSchema, endOn: v2DateSchema }).strict();
export const v2PlanningCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...operation, action: z.literal('extend_periods'), direction: z.enum(['before', 'after']), version }).strict(),
  z.object({ ...operation, action: z.literal('change_periods'), version, periods: z.array(v2PeriodChangeSchema).min(1).max(500), confirmation }).strict(),
  z.object({ ...operation, action: z.literal('reorder_projects'), version, projectIds: z.array(id).max(500) }).strict(),
  z.object({ ...operation, action: z.literal('reorder_tasks'), projectId: id, periodId: id, view: z.enum(['summary', 'plan']), executorId: id.optional(), version, taskIds: z.array(id).max(500) }).strict(),
]);
export type V2PlanningCommand = z.infer<typeof v2PlanningCommandSchema>;
export const v2ReportCommandSchema = z.object({ ...operation, action: z.enum(['save', 'verify', 'regenerate']), summaryPeriodId: id, planPeriodId: id, version, sourceHash: confirmation, body: z.string().max(200_000) }).strict();
export type V2ReportCommand = z.infer<typeof v2ReportCommandSchema>;

/** 同一个影响预览服务供页面和 Agent 使用；客户端不能自行构造确认摘要。 */
export const v2ImpactIntentSchema = z.discriminatedUnion('action', [
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

export const v2SummaryRowSchema = z.object({ taskId: id, title: z.string().nullable(), executorId: id.nullable(), executorName: z.string().nullable(), projectId: id.nullable(), status: v2StatusSchema.nullable(), priority: v2PrioritySchema.nullable(), arranged: z.boolean(), executed: z.boolean(), planning: z.enum(['planned', 'unplanned', 'unknown']), historyIncomplete: z.boolean() });
export type V2SummaryRow = z.infer<typeof v2SummaryRowSchema>;
export const v2WeeklyStateSchema = z.object({
  summaryPeriod: v2PeriodSchema, planPeriod: v2PeriodSchema, summary: z.array(v2SummaryRowSchema),
  projectOrder: z.object({ ids: z.array(id), version }), taskOrders: z.array(z.object({ projectId: id, periodId: id, ids: z.array(id), version })),
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
  z.object({ ...operation, action: z.literal('set_message'), version, message: z.string().trim().max(500) }).strict(),
]);
export type V2TeamCommand = z.infer<typeof v2TeamCommandSchema>;
export const v2MemberImpactInputSchema = z.object({ projectId: id, version, members: v2ProjectMembersSchema }).strict();
export type V2MemberImpactInput = z.infer<typeof v2MemberImpactInputSchema>;
export const v2MemberImpactSchema = z.object({ removedIds: z.array(id), blockers: z.array(z.object({ kind: z.enum(['task', 'milestone', 'role']), id: z.string(), title: z.string(), accountId: id.nullable() })) });

/** 共用编辑弹窗一次保存任务与当前安排，不能出现一半成功一半失败。 */
export const v2TaskEditSchema = z.object({
  ...operation, action: z.literal('save_task'), taskId: id, version,
  details: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('project'), title: z.string().trim().min(1).max(200), priority: v2PrioritySchema, executorId: id, milestoneId: id.nullable() }).strict(),
    z.object({ kind: z.literal('private'), title: z.string().trim().min(1).max(200), priority: v2PrioritySchema }).strict(),
  ]).optional(),
  status: v2StatusSchema.optional(), categoryId: id.optional(), milestoneConfirmation: confirmation.optional(),
  arrangement: z.object({ periodId: id, targetPeriodId: id, plannedDays: v2PlannedDaysSchema, confirmation }).strict().optional(),
}).strict();
export type V2TaskEdit = z.infer<typeof v2TaskEditSchema>;
export const v2AddExistingSchema = z.object({ ...operation, action: z.literal('add_existing'), periodId: id, tasks: z.array(z.object({ taskId: id, version }).strict()).min(1).max(100) }).strict();
export type V2AddExisting = z.infer<typeof v2AddExistingSchema>;
