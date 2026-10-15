import { Body, Controller, Get, Header, HttpCode, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { personalCommandSchema } from '@ntfs/contracts';
import { assertBusinessOrigin, csrfHeader, parseBody, businessToken } from '../identity/http.js';
import { PersonalService } from './personal.service.js';

/** 个人入口独立裁剪私人数据，不复用团队任务目录返回私人内容。 */
@ApiTags('personal') @Controller('personal')
export class PersonalController {
  constructor(private readonly personal: PersonalService) {}
  /** 查询本人空间，或当前角色有权查看的工作明细。 */
  @Get() @Header('Cache-Control', 'no-store') @ApiOperation({ summary: '查看个人事项' })
  snapshot(@Req() request: IncomingMessage, @Query('scope') scope: unknown) { return this.personal.snapshot(businessToken(request), parseBody(z.enum(['mine', 'visible']).default('mine'), scope)); }
  /** 聚合权限内团队工作，供个人空间选择及拆分。 */
  @Get('team-work') @Header('Cache-Control', 'no-store') @ApiOperation({ summary: '查看可加入个人空间的团队工作' })
  teamWork(@Req() request: IncomingMessage) { return this.personal.teamWork(businessToken(request)); }
  /** 私人内容历史仅供本人查询。 */
  @Get('history') @Header('Cache-Control', 'no-store') @ApiOperation({ summary: '查看本人事项历史' })
  history(@Req() request: IncomingMessage, @Query('itemId') id: unknown) { return this.personal.history(businessToken(request), parseBody(z.string().uuid(), id)); }
  /** 外部输入严格校验，管理角色无法代改本人执行事实。 */
  @Post('commands') @HttpCode(200) @ApiOperation({ summary: '维护本人事项、分类与进展' })
  execute(@Req() request: IncomingMessage, @Body() body: unknown) {
    assertBusinessOrigin(request);
    return this.personal.execute(businessToken(request), csrfHeader(request), parseBody(personalCommandSchema, body));
  }
}
