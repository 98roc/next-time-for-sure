import { z } from 'zod';

const id = z.string().uuid();
const version = z.number().int().nonnegative();
const title = z.string().trim().min(1).max(200);
const details = z.string().trim().max(20000);
const expectedOn = z.iso.date().nullable();
/** 节点引用原团队任务；移出规划与删除执行任务明确分离。 */
export const milestoneCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_node'), projectId: id, ownerId: id, title, description: details, acceptance: details, expectedOn, operationId: id }).strict(),
  z.object({ action: z.literal('add_node'), taskId: id, expectedOn, version }).strict(),
  z.object({ action: z.literal('reschedule_node'), taskId: id, expectedOn, reason: details.min(1), version }).strict(),
  z.object({ action: z.literal('remove_node'), taskId: id, reason: details.min(1), version }).strict(),
  z.object({ action: z.literal('edit_task'), taskId: id, title, description: details, acceptance: details, version }).strict(),
]);
export type MilestoneCommand = z.infer<typeof milestoneCommandSchema>;
