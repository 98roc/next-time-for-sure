import { z } from 'zod';
import { reportWeekSchema } from './assignments.js';

/** 周计划选择器只返回可执行分工，不代表已经生成周安排或投入承诺。 */
export const weeklyCandidatesQuerySchema = z.object({ teamId: z.string().uuid(), week: reportWeekSchema }).strict();
export const weeklyCandidatesSchema = z.object({
  teamId: z.string().uuid(), week: reportWeekSchema,
  assignments: z.array(z.object({
    assignmentId: z.string().uuid(), assignmentVersion: z.number().int().nonnegative(),
    taskId: z.string().uuid(), taskVersion: z.number().int().nonnegative(),
    projectId: z.string().uuid(), projectName: z.string(), taskTitle: z.string(),
    accountId: z.string().uuid(), displayName: z.string(), groupId: z.string().uuid(), groupName: z.string(),
    content: z.string(), status: z.enum(['not_started', 'in_progress']), blockedReason: z.string(),
  })),
});
export type WeeklyCandidates = z.infer<typeof weeklyCandidatesSchema>;
