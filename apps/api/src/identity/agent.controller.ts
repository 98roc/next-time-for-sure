import { Controller, Get, Header, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { IdentityService } from './identity.service.js';
import { businessToken } from './http.js';

/** Agent仅查询当前身份，不开放会话创建、改密或Token管理。 */
@Controller('agent')
export class AgentController {
  constructor(private readonly identity: IdentityService) {}
  /** 业务工具可确认当前操作者，返回值不含凭据。 */
  @Get('me') @Header('Cache-Control', 'no-store')
  me(@Req() request: IncomingMessage) { return this.identity.current(businessToken(request)); }
}
