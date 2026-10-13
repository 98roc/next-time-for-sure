import { apiErrorSchema, taskImpactSchema } from '@ntfs/contracts';
import type { TaskCommand, TaskImpact } from '@ntfs/contracts';
import { IdentityApiError } from '../identity/api';

/** 团队整体操作沿用同源会话；错误原样反馈业务冲突。 */
async function request(path: string, command?: TaskCommand, csrf?: string): Promise<unknown> {
  const response = await fetch(`/api/v1/tasks${path}`, { method: command ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: command ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' } : {}, ...(command ? { body: JSON.stringify(command) } : {}) });
  const body: unknown = await response.json();
  if (!response.ok) { const parsed = apiErrorSchema.safeParse(body); throw new IdentityApiError(parsed.success ? parsed.data.message : '任务操作失败。', response.status); }
  return body;
}
/** 获取结束或取消的最新影响范围，二者确认不可混用。 */
export async function taskImpact(id: string, intent: TaskImpact['intent']) { return taskImpactSchema.parse(await request(`/impact?taskId=${encodeURIComponent(id)}&intent=${intent}`)); }
/** 保存团队事实，成员事实仍通过本人分工入口维护。 */
export async function taskCommand(command: TaskCommand, csrf: string): Promise<void> { await request('/commands', command, csrf); }
