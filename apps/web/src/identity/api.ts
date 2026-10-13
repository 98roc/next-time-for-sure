import { apiErrorSchema, identitySchema } from '@ntfs/contracts';
import type { Identity } from '@ntfs/contracts';

/** 身份API错误保留HTTP状态，用于区分未登录与服务不可用。 */
export class IdentityApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Cookie由浏览器管理，密码与CSRF不放入持久化浏览器存储。 */
async function request(path: string, body?: unknown, csrf?: string): Promise<unknown> {
  const response = await fetch(`/api/v1/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 204) return undefined;
  const result: unknown = await response.json();
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(result);
    throw new IdentityApiError(error.success ? error.data.message : '请求失败，请稍后重试。', response.status);
  }
  return result;
}

/** 获取当前身份，401表示未登录；其他错误不能伪装为未登录。 */
export async function currentIdentity(): Promise<Identity | null> {
  try { return identitySchema.parse(await request('me')); }
  catch (error) { if (error instanceof IdentityApiError && error.status === 401) return null; throw error; }
}

/** 登录只返回公开身份，原始会话不进入JavaScript。 */
export async function login(loginName: string, password: string): Promise<Identity> {
  return identitySchema.parse(await request('login', { loginName, password }));
}

/** 改密成功后服务端撤销旧会话，页面返回登录入口。 */
export async function changePassword(currentPassword: string, newPassword: string, csrf: string): Promise<void> { await request('password', { currentPassword, newPassword }, csrf); }

/** 主动退出当前设备会话。 */
export async function logout(csrf: string): Promise<void> { await request('logout', {}, csrf); }
