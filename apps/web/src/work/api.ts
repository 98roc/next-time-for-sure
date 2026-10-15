import { apiErrorSchema, workSnapshotSchema } from '@ntfs/contracts';
import type { WorkCommand, WorkSnapshot } from '@ntfs/contracts';
import { IdentityApiError } from '../identity/api';
import { z } from 'zod';

/** 工作接口共用会话及错误反馈，幂等键由调用页面跨重试保持。 */
async function request(path: string, command?: WorkCommand, csrf?: string): Promise<unknown> {
  const response = await fetch(`/api/v1/work${path}`, {
    method: command ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: command ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' } : {},
    ...(command ? { body: JSON.stringify(command) } : {}), signal: AbortSignal.timeout(15000),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw new IdentityApiError(parsed.success ? parsed.data.message : '请求失败，请稍后重试。', response.status);
  }
  return body;
}

/** 获取单一项目的需求、团队任务及历史。 */
export async function workSnapshot(projectId: string): Promise<WorkSnapshot> { return workSnapshotSchema.parse(await request(`?projectId=${encodeURIComponent(projectId)}`)); }

/** 服务端将内容及幂等键一同核验，重复请求不会重复生成任务。 */
export async function workCommand(command: WorkCommand, csrf: string): Promise<{ objectId: string }> { return z.object({ objectId: z.string().uuid() }).parse(await request('/commands', command, csrf)); }
