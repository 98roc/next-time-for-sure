import { apiErrorSchema, weeklyCandidatesSchema, weeklyDraftResponseSchema, planPublicationsSchema } from '@ntfs/contracts';
import type { WeeklyArrangement, WeeklyPlanCommand } from '@ntfs/contracts';
import { shiftWeek, weekLabel } from '../layout/week-picker';

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

/** 连续安排两周时各周沿用现有批量事务；后一周仅补缺，失败明确报告已经保存的前一周。 */
export async function saveWeeklyBatch(command: WeeklyPlanCommand, csrf: string, alsoFollowingWeek: boolean) {
  await weeklyCommand(command, csrf);
  if (!alsoFollowingWeek || command.action !== 'save_arrangements') return;
  const targetWeek = shiftWeek(command.week, 1);
  try {
    const target = await weeklySnapshot(command.teamId, targetWeek);
    const existing = new Set(target.draft?.arrangements.map((entry) => entry.assignmentId));
    const arrangements = command.arrangements.filter((entry) => !existing.has(entry.assignmentId)).map((entry) => {
      const candidate = target.candidates.find((item) => item.assignmentId === entry.assignmentId);
      if (!candidate) throw new Error('分工状态或权限已经变化，请刷新后核对。');
      return { assignmentId: entry.assignmentId, assignmentVersion: candidate.assignmentVersion, taskVersion: candidate.taskVersion, version: null, goal: '', expectedProgress: null, plannedDays: null };
    });
    if (arrangements.length) await weeklyCommand({ action: 'save_arrangements', teamId: command.teamId, week: targetWeek, arrangements }, csrf);
  } catch (error) {
    throw new Error(`${weekLabel(command.week)}已保存，${weekLabel(targetWeek)}未完成确认。请切到目标周核对后补充；已有内容不会被覆盖。${error instanceof Error ? error.message : ''}`, { cause: error });
  }
}

/** 先读取目标周版本再原子移周；目标已有安排时保留其人工内容，并发变化由服务端拒绝。 */
export async function moveWeeklyArrangement(teamId: string, week: string, targetWeek: string, row: WeeklyArrangement, csrf: string) {
  const target = await weeklySnapshot(teamId, targetWeek);
  await weeklyCommand({ action: 'move_arrangement', teamId, week, arrangementId: row.id, version: row.version, targetWeek, targetVersion: target.draft?.arrangements.find((entry) => entry.assignmentId === row.assignmentId)?.version ?? null }, csrf);
}
