import { Body, Controller, Get, Header, HttpCode, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { workCommandSchema } from '@ntfs/contracts';
import { assertBusinessOrigin, csrfHeader, parseBody, businessToken } from '../identity/http.js';
import { WorkService } from './work.service.js';

/** 工作入口只处理协议、外部输入与同源限制。 */
@ApiTags('work') @Controller('work')
export class WorkController {
  constructor(private readonly work: WorkService) {}

  /** 获取指定项目的需求、团队任务及变更历史。 */
  @Get() @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '查看项目需求与团队任务' })
  snapshot(@Req() request: IncomingMessage, @Query('projectId') projectId: unknown) {
    return this.work.snapshot(businessToken(request), parseBody(z.string().uuid(), projectId));
  }

  /** 创建类命令携带幂等标识，修改类命令携带版本号。 */
  @Post('commands') @HttpCode(200)
  @ApiOperation({ summary: '提交、处理需求或直接创建团队任务' })
  execute(@Req() request: IncomingMessage, @Body() body: unknown) {
    assertBusinessOrigin(request);
    return this.work.execute(businessToken(request), csrfHeader(request), parseBody(workCommandSchema, body));
  }
}
