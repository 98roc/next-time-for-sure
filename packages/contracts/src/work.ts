import { z } from 'zod';
import { milestoneSchema } from './milestones.js';

const id = z.string().uuid();
const version = z.number().int().nonnegative();
const title = z.string().trim().min(1).max(200);
const details = z.string().trim().max(20000);
export const requestStatusSchema = z.enum(['pending', 'supplement_required', 'deferred', 'rejected', 'withdrawn', 'accepted']);
export const taskStatusSchema = z.enum(['not_started', 'in_progress', 'completed', 'cancelled']);

/** 需求与团队任务共用输入边界；说明、完成标准允许空白归一为空串。 */
export const workCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('submit_request'), projectId: id, title, description: details, acceptance: details, operationId: id }).strict(),
  z.object({ action: z.literal('edit_request'), requestId: id, title, description: details, acceptance: details, version }).strict(),
  z.object({ action: z.literal('supplement_request'), requestId: id, content: details.min(1), version }).strict(),
  z.object({ action: z.literal('withdraw_request'), requestId: id, version }).strict(),
  z.object({ action: z.literal('resubmit_request'), requestId: id, version }).strict(),
  z.object({ action: z.literal('review_request'), requestId: id, decision: z.enum(['supplement_required', 'deferred', 'rejected', 'pending']), reason: details.min(1), version }).strict(),
  z.object({ action: z.literal('accept_request'), requestId: id, ownerId: id, version, operationId: id }).strict(),
  z.object({ action: z.literal('create_task'), projectId: id, milestoneId: id.nullable().optional(), title, description: details, acceptance: details, operationId: id }).strict(),
]);
export type WorkCommand = z.infer<typeof workCommandSchema>;
export const workRequestSchema = z.object({ id, projectId: id, submitterId: id, title, description: details, acceptance: details, status: requestStatusSchema, version });
export const teamTaskSchema = z.object({ id, projectId: id, requestId: id.nullable(), parentId: id.nullable(), ownerId: id, title, description: details, acceptance: details, status: taskStatusSchema, version, milestoneId: id.nullable(), inMilestone: z.union([z.boolean(), z.literal(0), z.literal(1)]).transform(Boolean), expectedOn: z.iso.date().nullable(), startedAt: z.string().nullable(), endedAt: z.string().nullable(), progress: z.number().int().min(0).max(100), position: z.number().int().nonnegative(), blockedReason: z.string(), waitingFor: z.string(), waitingTaskId: id.nullable() });
export const workEventSchema = z.object({ id, objectId: id, actorId: id, action: z.string(), payload: z.record(z.string(), z.unknown()), createdAt: z.string() });
export const workSnapshotSchema = z.object({ requests: z.array(workRequestSchema), milestones: z.array(milestoneSchema), tasks: z.array(teamTaskSchema), events: z.array(workEventSchema) });
export type WorkSnapshot = z.infer<typeof workSnapshotSchema>;
