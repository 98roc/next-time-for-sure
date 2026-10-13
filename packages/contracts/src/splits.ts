import { z } from 'zod';

const id = z.string().uuid();
const version = z.number().int().nonnegative();
/** 一次拆分明确列出新子任务和所有有效分工去向，不接受隐式复制。 */
export const splitCommandSchema = z.object({
  taskId: id, version, operationId: id,
  children: z.array(z.object({ key: id, title: z.string().trim().min(1).max(200), description: z.string().trim().max(20000), acceptance: z.string().trim().max(20000) }).strict()).min(1).max(20),
  moves: z.array(z.object({ assignmentId: id, version, childKey: id }).strict()).max(1000),
}).strict().superRefine((value, context) => {
  const keys = new Set(value.children.map((entry) => entry.key));
  if (keys.size !== value.children.length || new Set(value.moves.map((entry) => entry.assignmentId)).size !== value.moves.length || value.moves.some((entry) => !keys.has(entry.childKey))) context.addIssue({ code: 'custom', message: '子任务标识、分工去向必须唯一且有效。' });
});
export type SplitCommand = z.infer<typeof splitCommandSchema>;
