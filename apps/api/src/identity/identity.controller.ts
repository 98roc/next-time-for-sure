import { Body, Controller, Get, Header, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { changePasswordSchema, loginSchema } from '@ntfs/contracts';
import { IdentityService } from './identity.service.js';
import { assertSameOrigin, csrfHeader, parseBody, sessionToken, setSessionCookie } from './http.js';

/** 身份协议适配层；密码、会话及状态规则由服务处理。 */
@ApiTags('identity')
@Controller('auth')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  /** 创建登录会话；不提供自助注册。 */
  @Post('login') @HttpCode(200)
  @ApiOperation({ summary: '账号密码登录' })
  async login(@Body() body: unknown, @Req() request: IncomingMessage, @Res({ passthrough: true }) response: ServerResponse) {
    assertSameOrigin(request);
    const input = parseBody(loginSchema, body);
    const result = await this.identity.login(input.loginName, input.password, request.socket.remoteAddress ?? 'unknown');
    setSessionCookie(response, result.token);
    return result.identity;
  }

  /** 查询当前身份，无有效会话返回401。 */
  @Get('me') @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '当前登录身份' })
  me(@Req() request: IncomingMessage) { return this.identity.current(sessionToken(request)); }

  /** 改密后清除当前Cookie并要求重新登录。 */
  @Post('password') @HttpCode(204)
  @ApiOperation({ summary: '本人修改密码并撤销全部会话' })
  async password(@Body() body: unknown, @Req() request: IncomingMessage, @Res({ passthrough: true }) response: ServerResponse) {
    assertSameOrigin(request);
    const input = parseBody(changePasswordSchema, body);
    await this.identity.changePassword(sessionToken(request), csrfHeader(request), input.currentPassword, input.newPassword);
    setSessionCookie(response, '');
  }

  /** 退出仅撤销当前会话。 */
  @Post('logout') @HttpCode(204)
  @ApiOperation({ summary: '退出登录' })
  async logout(@Req() request: IncomingMessage, @Res({ passthrough: true }) response: ServerResponse) {
    assertSameOrigin(request);
    await this.identity.logout(sessionToken(request), csrfHeader(request));
    setSessionCookie(response, '');
  }
}
