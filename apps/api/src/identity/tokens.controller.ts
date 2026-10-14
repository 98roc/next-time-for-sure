import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Post, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { createTokenSchema, revokeTokenSchema } from '@ntfs/contracts';
import { assertSameOrigin, csrfHeader, parseBody, sessionToken } from './http.js';
import { TokenService } from './token.service.js';

/** Token管理只接受登录Cookie，带Bearer的请求即使同时有Cookie也拒绝。 */
@Controller('tokens')
export class TokensController {
  constructor(private readonly tokens: TokenService) {}
  /** 仅本人登录入口可查询凭据元数据。 */
  @Get() @Header('Cache-Control', 'no-store')
  list(@Req() request: IncomingMessage) {
    rejectBearer(request);
    return this.tokens.list(sessionToken(request));
  }
  /** 登录用户设置过期时间，永久有效需要明确确认。 */
  @Post() @HttpCode(200) @Header('Cache-Control', 'no-store')
  create(@Req() request: IncomingMessage, @Body() body: unknown) {
    rejectBearer(request); assertSameOrigin(request);
    return this.tokens.create(sessionToken(request), csrfHeader(request), parseBody(createTokenSchema, body));
  }
  /** 仅本人会话撤销；响应不披露其他人的凭据是否存在。 */
  @Post('revoke') @HttpCode(200) @Header('Cache-Control', 'no-store')
  revoke(@Req() request: IncomingMessage, @Body() body: unknown) {
    rejectBearer(request); assertSameOrigin(request);
    return this.tokens.revoke(sessionToken(request), csrfHeader(request), parseBody(revokeTokenSchema, body).id);
  }
}
/** 独立检查协议入口，防止Bearer与Cookie混用突破管理边界。 */
function rejectBearer(request: IncomingMessage) { if (request.headers.authorization) throw new ForbiddenException('个人Token不能调用Token管理接口。'); }
