import { apiErrorSchema, organizationSnapshotSchema } from '@ntfs/contracts';
import type { OrganizationCommand, OrganizationSnapshot } from '@ntfs/contracts';
import { IdentityApiError } from '../identity/api';

/** 组织请求共用同源会话及服务端错误契约。 */
async function request(command?: OrganizationCommand, csrf?: string): Promise<unknown> {
  const response = await fetch(`/api/v1/organization${command ? '/commands' : ''}`, {
    method: command ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: command ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' } : {},
    ...(command ? { body: JSON.stringify(command) } : {}), signal: AbortSignal.timeout(10000),
  });
  if (response.status === 204) return undefined;
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw new IdentityApiError(parsed.success ? parsed.data.message : '请求失败，请刷新后重试。', response.status);
  }
  return body;
}

/** 仅获取后端按当前权限裁剪的组织目录。 */
export async function organizationSnapshot(): Promise<OrganizationSnapshot> { return organizationSnapshotSchema.parse(await request()); }

/** 写入携带当前会话校验值及对象版本，后端重新检查身份和范围。 */
export async function organizationCommand(command: OrganizationCommand, csrf: string): Promise<void> { await request(command, csrf); }
