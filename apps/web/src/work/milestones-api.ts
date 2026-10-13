import { apiErrorSchema } from '@ntfs/contracts';
import type { MilestoneCommand } from '@ntfs/contracts';
import { IdentityApiError } from '../identity/api';

/** 规划写入共用登录会话，错误保留状态码供页面提示刷新冲突。 */
export async function milestoneCommand(command: MilestoneCommand, csrf: string): Promise<void> {
  const response = await fetch('/api/v1/milestones/commands', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(command),
  });
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(await response.json());
    throw new IdentityApiError(parsed.success ? parsed.data.message : '保存规划失败，请重试。', response.status);
  }
}
