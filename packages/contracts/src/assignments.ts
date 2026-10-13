import { z } from 'zod';

const id = z.string().uuid();
const version = z.number().int().nonnegative();
const content = z.string().trim().max(20000);
const date = z.iso.date();
export const reportWeekSchema = date.refine((value) => new Date(`${value}T00:00:00Z`).getUTCDay() === 1, '归属周须填写周一日期');
export const assignmentStatusSchema = z.enum(['not_started', 'in_progress', 'completed', 'exited', 'transferred']);

/** 分配与本人执行分离；管理命令不能携带他人的状态或实际时间。 */
export const assignmentCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assignment_blocker'), assignmentId: id, version, blockedReason: z.string().trim().max(2000), waitingFor: z.string().trim().max(200), waitingTaskId: id.nullable() }).strict(),
  z.object({ action: z.literal('assign'), taskId: id, accountId: id, groupId: id, content, operationId: id }).strict(),
  z.object({ action: z.literal('claim'), taskId: id, groupId: id, content, operationId: id }).strict(),
  z.object({ action: z.literal('adjust'), assignmentId: id, groupId: id, content, version }).strict(),
  z.object({ action: z.literal('transfer'), assignmentId: id, accountId: id, groupId: id, content, reason: content.min(1), version, operationId: id }).strict(),
  z.object({ action: z.literal('exit'), assignmentId: id, reason: content.min(1), version }).strict(),
  z.object({ action: z.literal('start'), assignmentId: id, version }).strict(),
  z.object({ action: z.literal('complete'), assignmentId: id, version, confirmation: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
  z.object({ action: z.literal('record_progress'), assignmentId: id, occurredOn: date, reportWeek: reportWeekSchema, content: content.min(1), version, operationId: id }).strict(),
  z.object({ action: z.literal('correct_times'), assignmentId: id, startedAt: z.iso.datetime().nullable(), endedAt: z.iso.datetime().nullable(), version }).strict(),
]);
export type AssignmentCommand = z.infer<typeof assignmentCommandSchema>;
export const assignmentSchema = z.object({ id, taskId: id, originTaskId: id.nullable(), accountId: id, groupId: id, content, source: z.enum(['assigned', 'claimed']), status: assignmentStatusSchema, version, startedAt: z.string().nullable(), endedAt: z.string().nullable(), transferredAt: z.string().nullable(), blockedReason: z.string(), waitingFor: z.string(), waitingTaskId: id.nullable() });
export type Assignment = z.infer<typeof assignmentSchema>;
export const assignmentProgressSchema = z.object({ id, assignmentId: id, occurredOn: date, reportWeek: reportWeekSchema, content, createdAt: z.string() });
export const assignmentSnapshotSchema = z.object({ assignments: z.array(assignmentSchema), progress: z.array(assignmentProgressSchema) });
export type AssignmentSnapshot = z.infer<typeof assignmentSnapshotSchema>;
export const assignmentCompletionSchema = z.object({ confirmation: z.string(), assignmentVersion: version, unfinished: z.array(z.object({ id, title: z.string(), version })) });
export type AssignmentCompletion = z.infer<typeof assignmentCompletionSchema>;
