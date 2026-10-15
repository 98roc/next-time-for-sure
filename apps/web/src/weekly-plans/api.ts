import { apiErrorSchema, weeklyCandidatesSchema, weeklyDraftResponseSchema, planPublicationsSchema } from '@ntfs/contracts';
import type { WeeklyArrangement, WeeklyPlanCommand } from '@ntfs/contracts';

/** 会话接口只传本次业务参数，不在浏览器持久化计划或凭据。 */
async function request(path: string, command?: WeeklyPlanCommand, csrf?: string): Promise<unknown> {
  const response = await fetch(`/api/v1/weekly-plans${path}`, { method: command ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: command ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' } : {}, ...(command ? { body: JSON.stringify(command) } : {}), signal: AbortSignal.timeout(15000) });
  const data: unknown = await response.json();
  if (!response.ok) { const error = apiErrorSchema.safeParse(data); throw new Error(error.success ? error.data.message : '周计划请求失败。'); }
  return data;
}
/** 同时读取共享草稿与当前可安排分工；服务端仍在保存时重新校验。 */
export async function weeklySnapshot(teamId: string, week: string) {
  const query = new URLSearchParams({ teamId, week });
  const published = planPublicationsSchema.parse(await request(`/publications?${query}`));
  if (!published.canEdit) return { ...published, draft: null, candidates: [] };
  const [draft, candidates] = await Promise.all([request(`?${query}`), request(`/candidates?${query}`)]);
  return { ...published, ...weeklyDraftResponseSchema.parse(draft), candidates: weeklyCandidatesSchema.parse(candidates).assignments };
}
/** 周计划写入共用严格命令契约。 */
export async function weeklyCommand(command: WeeklyPlanCommand, csrf: string) { await request('/commands', command, csrf); }

/** 先读取目标周版本再原子移周；目标已有安排时保留其人工内容，并发变化由服务端拒绝。 */
export async function moveWeeklyArrangement(teamId: string, week: string, targetWeek: string, row: WeeklyArrangement, csrf: string) {
  const target = await weeklySnapshot(teamId, targetWeek);
  await weeklyCommand({ action: 'move_arrangement', teamId, week, arrangementId: row.id, version: row.version, targetWeek, targetVersion: target.draft?.arrangements.find((entry) => entry.assignmentId === row.assignmentId)?.version ?? null }, csrf);
}
