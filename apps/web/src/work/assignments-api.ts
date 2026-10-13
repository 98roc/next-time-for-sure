import { apiErrorSchema, assignmentSnapshotSchema, assignmentCompletionSchema } from '@ntfs/contracts';
import type { AssignmentCommand, AssignmentSnapshot } from '@ntfs/contracts';
import { IdentityApiError } from '../identity/api';

/** 团队侧分工查询和写入共用会话，业务条件仍由后端检查。 */
async function request(path: string, command?: AssignmentCommand, csrf?: string): Promise<unknown> {
  const response = await fetch(`/api/v1/assignments${path}`, {
    method: command ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: command ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' } : {},
    ...(command ? { body: JSON.stringify(command) } : {}), signal: AbortSignal.timeout(15000),
  });
  const body: unknown = await response.json();
  if (!response.ok) { const error = apiErrorSchema.safeParse(body); throw new IdentityApiError(error.success ? error.data.message : '分工请求失败，请重试。', response.status); }
  return body;
}

/** 进展按来源分工组织，保持每条记录的实际日期和归属周。 */
export async function assignmentSnapshot(project: string): Promise<AssignmentSnapshot> { return assignmentSnapshotSchema.parse(await request(`?projectId=${encodeURIComponent(project)}`)); }

/** 幂等标识在页面重试期间保持不变。 */
export async function assignmentCommand(command: AssignmentCommand, csrf: string): Promise<void> { await request('/commands', command, csrf); }

/** 获取当前未完成工作清单和与版本绑定的确认摘要。 */
export async function assignmentCompletion(id: string) { return assignmentCompletionSchema.parse(await request(`/completion?assignmentId=${encodeURIComponent(id)}`)); }
