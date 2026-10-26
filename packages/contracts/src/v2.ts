import { z } from 'zod';

/** V2 独立契约；旧模型在正式切换前保留，不把分工或个人副本当成新任务。 */
export const v2IdSchema = z.string().uuid();
export const v2VersionSchema = z.number().int().nonnegative();
export const v2StatusSchema = z.enum(['not_started', 'in_progress', 'completed']);
export type V2Status = z.infer<typeof v2StatusSchema>;
export const v2StatusLabels: Record<V2Status, string> = { not_started: '未开始', in_progress: '进行中', completed: '已完成' };
export const v2PrioritySchema = z.number().int().min(1).max(5);
export const v2DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, '请输入有效日期');
export const v2InstantSchema = z.iso.datetime({ precision: 3 });
const title = z.string().trim().min(1).max(200);

/** 区间投入最多两位小数，空代表未估算，零代表明确估算为零。 */
export const v2PlannedDaysSchema = z.number().finite().min(0).max(9999.99).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, '预计天数最多两位小数').nullable();

/** 写入必须明确填写预计投入；保留可空读模型以读取历史未估算记录。 */
export const v2RequiredPlannedDaysSchema = v2PlannedDaysSchema.refine((value): boolean => value !== null, '请填写预计投入（人天）');

/** 投入以八小时为一人天，允许明确填零；贡献档位不参与人天折算。 */
export const v2ActualDaysSchema = z.number().finite().min(0).max(9999.99).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, '实际人天最多两位小数').nullable();
export const v2AiContributionSchema = z.enum(['none', 'low', 'medium', 'high']);
export const v2AiContributionLabels: Record<z.infer<typeof v2AiContributionSchema>, string> = { none: '无 · 0%', low: '低 · 小于30%', medium: '中 · 30%–60%', high: '高 · 大于60%' };
/** 实际起止时间可补录；开始时间省略表示保留，null 表示明确清空。 */
export const v2CompletionSchema = z.object({ actualDays: v2ActualDaysSchema, aiContribution: v2AiContributionSchema.nullable(), startedAt: v2InstantSchema.nullable().optional(), completedAt: v2InstantSchema.optional() }).strict();
export type V2Completion = z.infer<typeof v2CompletionSchema>;
/** 每个周期独立的工作内容；省略时兼容旧客户端，空串明确清空。 */
export const v2WorkNoteSchema = z.string().trim().max(500);
export const v2ArrangementInputSchema = z.object({ periodId: v2IdSchema, plannedDays: v2RequiredPlannedDaysSchema, workNote: v2WorkNoteSchema.optional() }).strict();
export const v2ArrangementsInputSchema = z.array(v2ArrangementInputSchema).min(1).max(100).refine((rows) => new Set(rows.map((row) => row.periodId)).size === rows.length, '日期区间不能重复');
export type V2ArrangementInput = z.infer<typeof v2ArrangementInputSchema>;

export const v2PeriodSchema = z.object({
  id: v2IdSchema, teamId: v2IdSchema, startOn: v2DateSchema, endOn: v2DateSchema, version: v2VersionSchema,
}).strict().refine((value) => value.startOn <= value.endOn, '结束日期不能早于开始日期');
export type V2Period = z.infer<typeof v2PeriodSchema>;

/** 项目任务创建字段；首个安排与任务须在同一事务保存，创建人由服务端给定。 */
export const v2ProjectTaskInputSchema = z.object({
  projectId: v2IdSchema, title, executorId: v2IdSchema, periodId: v2IdSchema,
  priority: v2PrioritySchema.default(3), milestoneId: v2IdSchema.nullable().default(null),
  plannedDays: v2RequiredPlannedDaysSchema,
  workNote: v2WorkNoteSchema.optional(),
  additionalArrangements: z.array(v2ArrangementInputSchema).max(99).optional(),
  completion: v2CompletionSchema.optional(),
}).strict().refine((value) => {
  const ids = [value.periodId, ...(value.additionalArrangements ?? []).map((row) => row.periodId)];
  return new Set(ids).size === ids.length;
}, '日期区间不能重复');
export type V2ProjectTaskInput = z.infer<typeof v2ProjectTaskInputSchema>;

/** 私人任务不接受项目、里程碑或团队排期字段，不通过接口猜测其归属。 */
export const v2PrivateTaskInputSchema = z.object({ title, priority: v2PrioritySchema.default(3), categoryId: v2IdSchema.optional() }).strict();

const taskFields = {
  id: v2IdSchema, title, priority: v2PrioritySchema, status: v2StatusSchema,
  creatorId: v2IdSchema, executorId: v2IdSchema, version: v2VersionSchema,
  completedAt: v2InstantSchema.nullable(), createdAt: v2InstantSchema, updatedAt: v2InstantSchema,
  /** 本轮实际开始时间；null 为未知或清空，省略兼容旧历史快照。 */
  startedAt: v2InstantSchema.nullable().optional(),
  deletedAt: v2InstantSchema.nullable(),
  actualDays: v2ActualDaysSchema.optional(), aiContribution: v2AiContributionSchema.nullable().optional(),
};
export const v2TaskSchema = z.discriminatedUnion('kind', [
  z.object({ ...taskFields, kind: z.literal('project'), teamId: v2IdSchema, projectId: v2IdSchema, milestoneId: v2IdSchema.nullable() }).strict(),
  z.object({ ...taskFields, kind: z.literal('private'), teamId: z.null(), projectId: z.null(), milestoneId: z.null() }).strict(),
]).refine((task) => task.kind !== 'private' || task.creatorId === task.executorId, '私人任务创建人和执行人必须是本人')
  .refine((task) => task.kind !== 'private' || (task.actualDays == null && task.aiContribution == null), '私人任务不记录投入和AI贡献率')
  .refine((task) => task.status === 'completed' || task.completedAt === null, '未完成任务不能保留当前完成时间');
export type V2Task = z.infer<typeof v2TaskSchema>;

/** 每次变更保存业务快照和实际操作者；migration 事件仅说明已知基线，不补造过去。 */
export const v2TaskEventSchema = z.object({
  id: v2IdSchema, taskId: v2IdSchema, sequence: v2VersionSchema, actorId: v2IdSchema.nullable(),
  occurredAt: v2InstantSchema, action: z.enum(['created', 'updated', 'status_changed', 'deleted', 'migrated', 'completion_corrected', 'arrangement_carried']),
  beforeStatus: v2StatusSchema.nullable(), snapshot: v2TaskSchema,
  fromBacklog: z.boolean().optional(),
  projectName: z.string().nullable().optional(),
  executorName: z.string().nullable().default(null), actorName: z.string().nullable().default(null),
}).strict().refine((event) => event.taskId === event.snapshot.id && event.sequence === event.snapshot.version, '事件必须对应任务及版本');
export type V2TaskEvent = z.infer<typeof v2TaskEventSchema>;

/** 同一安排可撤销后重新加入；每个有效片段保留其真实起止和是否为迁移补录。 */
export const v2ArrangementHistorySchema = z.object({
  id: v2IdSchema, taskId: v2IdSchema, periodId: v2IdSchema,
  validFrom: v2InstantSchema, validUntil: v2InstantSchema.nullable(),
  provenance: z.enum(['scheduled', 'carried', 'migration_supplement', 'migration_unknown']), plannedDays: v2PlannedDaysSchema,
  workNote: v2WorkNoteSchema.optional(), carriedFromPeriodId: v2IdSchema.nullable().optional(), voided: z.boolean().optional(),
}).strict().refine((row) => row.validUntil === null || row.validFrom <= row.validUntil, '安排撤销时间不能早于加入时间');
export type V2ArrangementHistory = z.infer<typeof v2ArrangementHistorySchema>;

export const v2CategorySchema = z.object({ id: v2IdSchema, ownerId: v2IdSchema, name: z.string().trim().min(1).max(100), status: v2StatusSchema, isDefault: z.boolean(), position: z.number().int().nonnegative(), version: v2VersionSchema }).strict();
export type V2Category = z.infer<typeof v2CategorySchema>;

export const v2MilestoneSchema = z.object({
  id: v2IdSchema, projectId: v2IdSchema, title, expectedOn: v2DateSchema.nullable(),
  status: z.enum(['open', 'completed']), needsReview: z.boolean(), version: v2VersionSchema,
  /** 服务端返回的真实创建时间，用于关联选项同日排序；旧快照可暂缺。 */
  createdAt: v2InstantSchema.optional(),
}).strict();
export type V2Milestone = z.infer<typeof v2MilestoneSchema>;

/** 所有确认携带影响摘要，服务端重算；版本和幂等键均不能代替当前权限检查。 */
const command = { operationId: v2IdSchema };
const existing = { taskId: v2IdSchema, version: v2VersionSchema };
export const v2TaskCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...command, action: z.literal('create_project'), task: v2ProjectTaskInputSchema, categoryId: v2IdSchema.optional() }).strict(),
  z.object({ ...command, action: z.literal('create_private'), task: v2PrivateTaskInputSchema }).strict(),
  z.object({ ...command, action: z.literal('create_batch'), tasks: z.array(v2ProjectTaskInputSchema).min(1).max(100) }).strict(),
  z.object({ ...command, ...existing, action: z.literal('set_status'), status: v2StatusSchema, categoryId: v2IdSchema.optional(), completion: v2CompletionSchema.optional() }).strict(),
  z.object({ ...command, ...existing, action: z.literal('update_project'), title, executorId: v2IdSchema, priority: v2PrioritySchema, milestoneId: v2IdSchema.nullable(), milestoneConfirmation: z.string().regex(/^[a-f0-9]{64}$/u).optional() }).strict(),
  z.object({ ...command, ...existing, action: z.literal('update_private'), title, priority: v2PrioritySchema }).strict(),
  z.object({ ...command, ...existing, action: z.literal('delete'), confirmation: z.string().length(64) }).strict(),
  z.object({ ...command, ...existing, action: z.literal('add_arrangement'), periodId: v2IdSchema, plannedDays: v2RequiredPlannedDaysSchema, workNote: v2WorkNoteSchema.optional() }).strict(),
  z.object({ ...command, ...existing, action: z.literal('change_arrangement'), periodId: v2IdSchema, targetPeriodId: v2IdSchema, plannedDays: v2RequiredPlannedDaysSchema, workNote: v2WorkNoteSchema.optional(), confirmation: z.string().length(64) }).strict(),
  z.object({ ...command, ...existing, action: z.literal('remove_arrangement'), periodId: v2IdSchema, confirmation: z.string().length(64) }).strict(),
]);
export type V2TaskCommand = z.infer<typeof v2TaskCommandSchema>;
