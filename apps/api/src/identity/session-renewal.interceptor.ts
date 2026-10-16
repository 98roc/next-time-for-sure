import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mergeMap } from 'rxjs';
import type { Observable } from 'rxjs';
import { IdentityService } from './identity.service.js';
import { sessionToken, setSessionCookie } from './http.js';

/** 成功请求后同步续期数据库和Cookie；失败、Bearer和后台轮询不计为使用。 */
@Injectable()
export class SessionRenewalInterceptor implements NestInterceptor {
  constructor(private readonly identity: IdentityService) {}

  /** 登录、改密和退出自行设置Cookie，不能被自动续期覆盖。 */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<IncomingMessage>();
    const response = context.switchToHttp().getResponse<ServerResponse>();
    const token = sessionToken(request);
    const path = request.url?.split('?')[0];
    const background = request.headers['x-ntfs-session-activity'] === 'passive' || (request.method === 'GET' && path === '/api/v1/notifications');
    if (!token || request.headers.authorization !== undefined || background || path?.startsWith('/api/v1/health/')) return next.handle();

    return next.handle().pipe(mergeMap(async (value: unknown) => {
      // 续期失败时保留原有效期，不能把已经提交的业务操作改报为失败。
      if (!response.hasHeader('Set-Cookie') && await this.identity.renewSession(token).catch(() => false)) setSessionCookie(response, token);
      return value;
    }));
  }
}
