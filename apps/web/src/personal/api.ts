import { apiErrorSchema, personalSnapshotSchema } from '@ntfs/contracts';
import type { PersonalCommand } from '@ntfs/contracts';
import { IdentityApiError } from '../identity/api';

/** 个人内容仅通过当前会话传递，不放入浏览器持久化存储。 */
async function request(path: string, command?: PersonalCommand, csrf?: string): Promise<unknown> {
  const response = await fetch(`/api/v1/personal${path}`, { method: command ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: command ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' } : {}, ...(command ? { body: JSON.stringify(command) } : {}), signal: AbortSignal.timeout(15000) });
  const body: unknown = await response.json();
  if (!response.ok) { const parsed = apiErrorSchema.safeParse(body); throw new IdentityApiError(parsed.success ? parsed.data.message : '个人事项请求失败。', response.status); }
  return body;
}

/** 返回本人空间或服务端裁剪后的可见工作事项。 */
export async function personalSnapshot(scope: 'mine' | 'visible') { return personalSnapshotSchema.parse(await request(`?scope=${scope}`)); }
/** 写入须携带版本和必要的幂等标识。 */
export async function personalCommand(command: PersonalCommand, csrf: string): Promise<void> { await request('/commands', command, csrf); }
