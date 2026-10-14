import { apiErrorSchema, reportWeekSchema } from '@ntfs/contracts';

/** 周业务请求统一处理错误；服务端每次重新授权及校验版本。 */
export async function reportingRequest(path: string, body?: unknown, csrf?: string): Promise<unknown> {
  const response = await fetch(`/api/v1/${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const result: unknown = await response.json();
  if (!response.ok) { const error = apiErrorSchema.safeParse(result); throw new Error(error.success ? error.data.message : '请求失败，请刷新重试。'); }
  return result;
}
/** 本地周一，避免UTC日期在零点跨周。 */
export function currentWeek() { const date = new Date(); date.setDate(date.getDate() - (date.getDay() + 6) % 7); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
/** 周次链接便于团队定位同一份计划和周报，非法参数回到本周。 */
export function selectedWeek() { const value = reportWeekSchema.safeParse(new URLSearchParams(window.location.search).get('week')); return value.success ? value.data : currentWeek(); }
