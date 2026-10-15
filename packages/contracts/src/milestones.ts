import { z } from 'zod';

const id = z.string().uuid();
const version = z.number().int().nonnegative();
const title = z.string().trim().min(1).max(200);
const details = z.string().trim().max(20000);
const expectedOn = z.iso.date().nullable();
/** 里程碑是独立目标，其完成状态由负责人确认。 */
export const milestoneSchema = z.object({ id, projectId: id, ownerId: id, title, expectedOn, status: z.enum(['open', 'completed', 'removed']), version });
export const milestoneCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_node'), projectId: id, ownerId: id, title, expectedOn, operationId: id }).strict(),
  z.object({ action: z.literal('link_task'), taskId: id, milestoneId: id.nullable(), version }).strict(),
  z.object({ action: z.literal('edit_node'), milestoneId: id, title, ownerId: id, version }).strict(),
  z.object({ action: z.literal('reschedule_node'), milestoneId: id, expectedOn, reason: details.min(1), version }).strict(),
  z.object({ action: z.literal('remove_node'), milestoneId: id, reason: details.min(1), version }).strict(),
  z.object({ action: z.literal('complete_node'), milestoneId: id, version }).strict(),
  z.object({ action: z.literal('reopen_node'), milestoneId: id, reason: details.min(1), version }).strict(),
  z.object({ action: z.literal('edit_task'), taskId: id, title, description: details, acceptance: details, version }).strict(),
]);
export type MilestoneCommand = z.infer<typeof milestoneCommandSchema>;
