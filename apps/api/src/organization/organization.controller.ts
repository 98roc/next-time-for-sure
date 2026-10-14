import { Body, Controller, Get, Header, HttpCode, Post, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { organizationCommandSchema } from '@ntfs/contracts';
import { assertBusinessOrigin, csrfHeader, parseBody, businessToken } from '../identity/http.js';
import { OrganizationService } from './organization.service.js';

/** 组织协议适配，命令为明确的业务操作，权限与事务均由服务处理。 */
@ApiTags('organization') @Controller('organization')
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  /** 返回当前用户允许查看的组织目录。 */
  @Get() @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '查看当前可见组织目录' })
  snapshot(@Req() request: IncomingMessage) { return this.organization.snapshot(businessToken(request)); }

  /** 执行单个组织命令，失败不会部分保存成员或角色。 */
  @Post('commands') @HttpCode(204)
  @ApiOperation({ summary: '执行团队、小组、项目或账号管理命令' })
  execute(@Body() body: unknown, @Req() request: IncomingMessage) {
    assertBusinessOrigin(request);
    return this.organization.execute(businessToken(request), csrfHeader(request), parseBody(organizationCommandSchema, body));
  }
}
