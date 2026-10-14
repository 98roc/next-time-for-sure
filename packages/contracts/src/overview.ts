import { z } from 'zod';
import { publicationRowSchema } from './reporting.js';
/** 总览只返回当前可见项目的团队事实，不包含私人事项。 */
export const overviewSchema = z.object({ week: z.string(), projects: z.array(z.object({
  id: z.string(), name: z.string(), archived: z.boolean(), arrangements: z.array(publicationRowSchema),
  changes: z.array(z.string()), unassigned: z.array(z.string()), blockers: z.array(z.string()),
  progress: z.array(z.object({ title: z.string(), person: z.string(), content: z.string(), occurredOn: z.string() })),
})), people: z.array(z.object({ id: z.string(), name: z.string(), plannedDays: z.string(), unestimated: z.number(), assignments: z.array(publicationRowSchema) })) });
