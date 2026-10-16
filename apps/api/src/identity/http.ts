import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { z } from 'zod';
import { sessionLifetimeSeconds } from './session-policy.js';

/** 从HttpOnly Cookie中提取会话，绝不把Bearer Token当登录会话。 */
export function sessionToken(request: IncomingMessage): string {
  const value = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('ntfs_session='))?.slice('ntfs_session='.length) ?? '';
  return /^[a-f0-9]{64}$/.test(value) ? value : '';
}

/** 业务端显式支持Bearer；有Authorization时不降级为Cookie，防止认证混淆。 */
export function businessToken(request: IncomingMessage): string {
  const header = request.headers.authorization;
  if (header !== undefined) return `bearer:${header.startsWith('Bearer ') ? header.slice(7) : ''}`;
  return sessionToken(request);
}

/** Bearer业务写入不使用Cookie或CSRF；浏览器会话仍要求同源及CSRF。 */
export function assertBusinessOrigin(request: IncomingMessage): void {
  if (request.headers.authorization !== undefined) {
    if (request.headers.origin || request.headers['sec-fetch-site'] === 'cross-site') throw new ForbiddenException('Agent凭据不接受浏览器跨站调用。');
    if (!request.headers['content-type']?.startsWith('application/json')) throw new BadRequestException('仅接受JSON请求。');
    return;
  }
  assertSameOrigin(request);
}

/** 写操作必须为同站JSON请求，拒绝跨站表单及缺失来源的会话调用。 */
export function assertSameOrigin(request: IncomingMessage): void {
  const origin = request.headers.origin;
  let parsed: URL;
  try { parsed = new URL(origin ?? ''); } catch { throw new ForbiddenException('请求来源无效。'); }
  if (parsed.host !== request.headers.host || parsed.protocol !== 'http:' || request.headers['sec-fetch-site'] === 'cross-site') throw new ForbiddenException('拒绝跨站请求。');
  if (!request.headers['content-type']?.startsWith('application/json')) throw new BadRequestException('仅接受JSON请求。');
}

/** CSRF值由登录响应提供并由前端内存保存。 */
export function csrfHeader(request: IncomingMessage): string {
  const value = request.headers['x-csrf-token'];
  return typeof value === 'string' ? value : '';
}

/** Cookie限制于API，HttpOnly且SameSite严格；本机HTTP不设置Secure。 */
export function setSessionCookie(response: ServerResponse, token: string): void {
  response.setHeader('Set-Cookie', `ntfs_session=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${token ? sessionLifetimeSeconds : 0}`);
  response.setHeader('Cache-Control', 'no-store');
}

/** 输入错误只返回字段名，不把密码等原始值写入响应。 */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException(`请检查输入字段：${[...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join('、')}`);
  return parsed.data;
}
