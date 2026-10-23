import { z } from 'zod';
import { organizationCommandSchema } from './organization.js';
import { v2TaskCommandSchema } from './v2.js';
import { v2DailyQuerySchema, v2DailyCommandSchema, v2SubtasksCommandSchema, v2PersonalSettingsCommandSchema } from './v2-personal-work.js';
import { v2ImpactIntentSchema, v2ProjectCommandSchema, v2PersonalCommandSchema, v2PlanningCommandSchema, v2ReportCommandSchema, v2TeamCommandSchema, v2TaskEditSchema, v2MemberImpactInputSchema, v2PeriodPairSchema } from './v2-workspace.js';
const id = z.string().uuid();
const empty = z.object({}).strict();

/** 固定 V2 白名单，不开放登录、本人改密、Token 管理或旧业务路径。 */
export const agentQuerySchema = z.discriminatedUnion('path', [
  z.object({ path: z.literal('agent/me'), query: empty }).strict(),
  z.object({ path: z.literal('organization'), query: empty }).strict(),
  z.object({ path: z.literal('v2/workspace'), query: empty }).strict(),
  z.object({ path: z.literal('v2/subtasks'), query: z.object({ taskId: id }).strict() }).strict(),
  z.object({ path: z.literal('v2/daily'), query: v2DailyQuerySchema }).strict(),
  z.object({ path: z.literal('v2/weekly'), query: v2PeriodPairSchema }).strict(),
  z.object({ path: z.literal('v2/history'), query: z.object({ taskId: id }).strict() }).strict(),
  z.object({ path: z.literal('v2/summary'), query: z.object({ periodId: id }).strict() }).strict(),
]);

/** 影响预览使用 POST 但仍只读；确认令牌必须来自当前版本的服务端结果。 */
export const agentPreviewSchema = z.discriminatedUnion('path', [
  z.object({ path: z.literal('v2/impact'), body: v2ImpactIntentSchema }).strict(),
  z.object({ path: z.literal('v2/members-impact'), body: v2MemberImpactInputSchema }).strict(),
]);

/** 复用网页严格契约；权限、事务、版本与确认由同一后端服务执行。 */
export const agentCommandSchema = z.discriminatedUnion('path', [
  z.object({ path: z.literal('organization/commands'), body: organizationCommandSchema }).strict(),
  z.object({ path: z.literal('v2/tasks'), body: v2TaskCommandSchema }).strict(),
  z.object({ path: z.literal('v2/projects'), body: v2ProjectCommandSchema }).strict(),
  z.object({ path: z.literal('v2/personal'), body: v2PersonalCommandSchema }).strict(),
  z.object({ path: z.literal('v2/subtasks'), body: v2SubtasksCommandSchema }).strict(),
  z.object({ path: z.literal('v2/daily'), body: v2DailyCommandSchema }).strict(),
  z.object({ path: z.literal('v2/personal-settings'), body: v2PersonalSettingsCommandSchema }).strict(),
  z.object({ path: z.literal('v2/planning'), body: v2PlanningCommandSchema }).strict(),
  z.object({ path: z.literal('v2/report'), body: v2ReportCommandSchema }).strict(),
  z.object({ path: z.literal('v2/team'), body: v2TeamCommandSchema }).strict(),
  z.object({ path: z.literal('v2/edit'), body: v2TaskEditSchema }).strict(),
]);
