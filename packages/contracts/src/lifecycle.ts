import { z } from 'zod';
const id = z.string().uuid();
const version = z.number().int().nonnegative();
/** 高影响操作先预览，确认摘要绑定范围、当前版本及目标归属。 */
export const lifecycleIntentSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('delete_task'), objectId: id }).strict(),
  z.object({ action: z.literal('delete_personal'), objectId: id }).strict(),
  z.object({ action: z.literal('transfer_task'), objectId: id, targetProjectId: id }).strict(),
  z.object({ action: z.literal('transfer_personal'), objectId: id, targetProjectId: id }).strict(),
  z.object({ action: z.literal('archive_project'), objectId: id }).strict(),
  z.object({ action: z.literal('restore_project'), objectId: id }).strict(),
  z.object({ action: z.literal('remove_member'), objectId: id }).strict(),
  z.object({ action: z.literal('remove_project_member'), objectId: id, projectId: id }).strict(),
]);
export const lifecycleCommandSchema = z.object({ intent: lifecycleIntentSchema, confirmation: z.string().length(64), reason: z.string().trim().max(2000).default(''), operationId: id }).strict().superRefine((command, context) => {
  // 删除只需影响确认；转移、归档、移出等操作仍要求说明原因。
  if (!['delete_task', 'delete_personal'].includes(command.intent.action) && !command.reason) context.addIssue({ code: 'custom', path: ['reason'], message: '请填写操作原因。' });
});
export type LifecycleIntent = z.infer<typeof lifecycleIntentSchema>;
export type LifecycleCommand = z.infer<typeof lifecycleCommandSchema>;
/** 团队审计只展示摘要和原因，不返回个人内容快照。 */
export const lifecycleHistorySchema = z.array(z.object({ id, action: z.string(), actorId: id, objectId: id, title: z.string(), reason: z.string(), createdAt: z.string() }));
export const lifecyclePreviewSchema = z.object({ confirmation: z.string(), title: z.string(), impacts: z.array(z.string()), blockers: z.array(z.string()) });
export const handoffSchema = z.array(z.object({ accountId: id, displayName: z.string(), tasks: z.array(z.object({ id, title: z.string(), projectId: id, version })), assignments: z.array(z.object({ id, taskId: id, projectId: id, version })), duties: z.array(z.string()) }));
