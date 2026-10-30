import { z } from 'zod';
import { v2DailyReportSchema, v2SubtasksSchema, type V2DailyCommand, type V2PersonalSettingsCommand, type V2SubtasksCommand } from '@ntfs/contracts';
import { v2MessagesSchema, apiErrorSchema, v2ImpactSchema, v2MemberImpactSchema, v2SummaryRowSchema, v2TaskHistorySchema, v2WeeklyStateSchema, v2WorkspaceSchema } from '@ntfs/contracts';
import type { V2ImpactIntent, V2MemberImpactInput, V2PersonalCommand, V2PlanningCommand, V2ProjectCommand, V2ReportCommand, V2TaskCommand, V2TaskEdit, V2TeamCommand } from '@ntfs/contracts';
import { IdentityApiError } from '../identity/api';

export type Commands = { tasks: V2TaskCommand; projects: V2ProjectCommand; personal: V2PersonalCommand; planning: V2PlanningCommand; report: V2ReportCommand; team: V2TeamCommand; edit: V2TaskEdit; subtasks: V2SubtasksCommand; daily: V2DailyCommand; 'personal-settings': V2PersonalSettingsCommand };
const resultSchema = z.object({ objectIds: z.array(z.string().uuid()) });

/** 团队上下文显式随请求发送，后端重新鉴权，不从浏览器偏好推断写入范围。 */
function scopedPath(path: string, teamId?: string): string { return teamId ? `${path}?${new URLSearchParams({ teamId })}` : path; }

/** 同源 Cookie 认证；轮询标记为被动，业务写入不做自动重试。 */
async function request<T>(path: string, schema: z.ZodType<T>, body?: unknown, csrf?: string, passive = false): Promise<T> {
  const response = await fetch(`/api/v1/v2/${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' }), ...(passive ? { 'X-NTFS-Session-Activity': 'passive' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
  });
  const result: unknown = await response.json();
  if (!response.ok) { const error = apiErrorSchema.safeParse(result); throw new IdentityApiError(error.success ? error.data.message : '请求失败，请保留内容后重试。', response.status); }
  return schema.parse(result);
}

/** 当前工作区由服务器按当前成员关系裁剪。 */
export const readWorkspace = (teamId?: string) => request(`workspace${teamId ? `?${new URLSearchParams({ teamId })}` : ''}`, v2WorkspaceSchema, undefined, undefined, true);
/** 日期组合必须相邻，筛选不缩小共享文字范围。 */
export const readWeekly = (summaryPeriodId: string, planPeriodId: string, teamId?: string) => request(`weekly?${new URLSearchParams({ summaryPeriodId, planPeriodId, ...(teamId ? { teamId } : {}) })}`, v2WeeklyStateSchema, undefined, undefined, true);
/** 历史权限每次由服务重新校验。 */
export const readHistory = (taskId: string) => request(`history?${new URLSearchParams({ taskId })}`, v2TaskHistorySchema);
/** 独立项目区间汇总沿用服务端历史规则。 */
export const readSummary = (periodId: string, teamId?: string) => request(`summary?${new URLSearchParams({ periodId, ...(teamId ? { teamId } : {}) })}`, z.array(v2SummaryRowSchema), undefined, undefined, true);
/** 影响确认必须使用服务器摘要，不能由客户端拼接。 */
export const readImpact = (intent: V2ImpactIntent, teamId?: string) => request(scopedPath('impact', teamId), v2ImpactSchema, intent);
/** 只读取当前项目成员移出阻塞项。 */
export const readMemberImpact = (input: V2MemberImpactInput, teamId?: string) => request(scopedPath('members-impact', teamId), v2MemberImpactSchema, input);
/** 命令和地址一一对应，防止不同入口生成不同语义。 */
export const sendCommand = <K extends keyof Commands>(path: K, body: Commands[K], csrf: string, teamId?: string) => request(scopedPath(path, teamId), resultSchema, body, csrf);

/** 最近七天的本人消息，后台刷新不续期登录。 */
export const readMessages = (page: number) => request(`notifications?page=${page}`, v2MessagesSchema, undefined, undefined, true);
/** 只读本人当前执行任务的私人清单。 */
export const readSubtasks = (taskId: string) => request(`subtasks?${new URLSearchParams({ taskId })}`, v2SubtasksSchema, undefined, undefined, true);
/** 日期明确传递，日报不受看板搜索和来源筛选影响。 */
export const readDaily = (on: string) => request(`daily?${new URLSearchParams({ on })}`, v2DailyReportSchema, undefined, undefined, true);
