import { z } from 'zod';
import { organizationCommandSchema } from './organization.js';
import { workCommandSchema } from './work.js';
import { taskCommandSchema, taskEndIntentSchema } from './tasks.js';
import { assignmentCommandSchema, reportWeekSchema } from './assignments.js';
import { personalCommandSchema } from './personal.js';
import { milestoneCommandSchema } from './milestones.js';
import { splitCommandSchema } from './splits.js';
import { weeklyPlanCommandSchema } from './weekly-plans.js';
import { reportCommandSchema, tagCommandSchema } from './reporting.js';
import { lifecycleCommandSchema } from './lifecycle.js';
import { readNotificationSchema } from './notifications.js';
const id = z.string().uuid();
const empty = z.object({}).strict();
const project = z.object({ projectId: id }).strict();
const weekly = z.object({ teamId: id, week: reportWeekSchema }).strict();
/** 固定业务白名单；不允许任意URL、登录或Token管理路径。 */
export const agentQuerySchema = z.discriminatedUnion('path', [
  z.object({ path: z.literal('agent/me'), query: empty }).strict(),
  z.object({ path: z.literal('organization'), query: empty }).strict(),
  z.object({ path: z.literal('work'), query: project }).strict(),
  z.object({ path: z.literal('assignments'), query: project }).strict(),
  z.object({ path: z.literal('assignments/completion'), query: z.object({ assignmentId: id }).strict() }).strict(),
  z.object({ path: z.literal('tasks/impact'), query: z.object({ taskId: id, intent: taskEndIntentSchema }).strict() }).strict(),
  z.object({ path: z.literal('personal'), query: z.object({ scope: z.enum(['mine', 'visible']) }).strict() }).strict(),
  z.object({ path: z.literal('personal/history'), query: z.object({ itemId: id }).strict() }).strict(),
  z.object({ path: z.literal('personal/team-work'), query: empty }).strict(),
  ...['weekly-plans', 'weekly-plans/candidates', 'weekly-plans/preview', 'weekly-plans/publications', 'reports', 'reports/preview'].map((path) => z.object({ path: z.literal(path), query: weekly }).strict()),
  z.object({ path: z.literal('work-tags'), query: z.object({ objectId: id, objectKind: z.enum(['task', 'personal']) }).strict() }).strict(),
  ...['lifecycle/handoff', 'lifecycle/history', 'notifications'].map((path) => z.object({ path: z.literal(path), query: empty }).strict()),
  z.object({ path: z.literal('lifecycle/overview'), query: z.object({ week: reportWeekSchema }).strict() }).strict(),
]);
/** 各业务模块沿用网页契约，Agent不另建宽松命令或复制权限规则。 */
export const agentCommandSchema = z.discriminatedUnion('path', [
  z.object({ path: z.literal('organization/commands'), body: organizationCommandSchema }).strict(),
  z.object({ path: z.literal('work/commands'), body: workCommandSchema }).strict(),
  z.object({ path: z.literal('tasks/commands'), body: taskCommandSchema }).strict(),
  z.object({ path: z.literal('tasks/split'), body: splitCommandSchema }).strict(),
  z.object({ path: z.literal('assignments/commands'), body: assignmentCommandSchema }).strict(),
  z.object({ path: z.literal('personal/commands'), body: personalCommandSchema }).strict(),
  z.object({ path: z.literal('milestones/commands'), body: milestoneCommandSchema }).strict(),
  z.object({ path: z.literal('weekly-plans/commands'), body: weeklyPlanCommandSchema }).strict(),
  z.object({ path: z.literal('reports/commands'), body: reportCommandSchema }).strict(),
  z.object({ path: z.literal('work-tags/commands'), body: tagCommandSchema }).strict(),
  z.object({ path: z.literal('lifecycle/commands'), body: lifecycleCommandSchema }).strict(),
  z.object({ path: z.literal('notifications/read'), body: readNotificationSchema }).strict(),
]);
