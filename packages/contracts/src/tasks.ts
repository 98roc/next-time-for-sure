import { z } from 'zod';

const id = z.string().uuid();
const version = z.number().int().nonnegative();
const reason = z.string().trim().min(1).max(20000);
export const taskEndIntentSchema = z.enum(['complete_task', 'cancel_task']);
/** 团队整体状态独立于成员事实；结束必须提交最新范围的确认摘要。 */
export const taskCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start_task'), taskId: id, version }).strict(),
  z.object({ action: z.literal('complete_task'), taskId: id, version, confirmation: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal('cancel_task'), taskId: id, version, confirmation: z.string().regex(/^[a-f0-9]{64}$/), reason }).strict(),
  z.object({ action: z.literal('reopen_task'), taskId: id, version, reason }).strict(),
  z.object({ action: z.literal('change_owner'), taskId: id, version, ownerId: id }).strict(),
  z.object({ action: z.literal('task_progress'), taskId: id, version, progress: z.number().int().min(0).max(100) }).strict(),
]);
export const taskImpactSchema = z.object({
  taskId: id, version, intent: taskEndIntentSchema, confirmation: z.string(),
  children: z.array(z.object({ id, title: z.string() })),
  assignments: z.array(z.object({ id, accountId: id, content: z.string() })),
  personal: z.array(z.object({ id, title: z.string() })),
  hiddenPersonalCount: z.number().int().nonnegative(),
});
export type TaskCommand = z.infer<typeof taskCommandSchema>;
export type TaskImpact = z.infer<typeof taskImpactSchema>;
