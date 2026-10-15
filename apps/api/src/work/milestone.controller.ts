import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { IncomingMessage } from 'node:http';
import { milestoneCommandSchema } from '@ntfs/contracts';
import { assertBusinessOrigin, csrfHeader, parseBody, businessToken } from '../identity/http.js';
import { MilestoneService } from './milestone.service.js';

/** 里程碑写入入口；项目快照同时返回独立目标及其任务关联。 */
@ApiTags('milestones') @Controller('milestones')
export class MilestoneController {
  constructor(private readonly milestones: MilestoneService) {}
  /** 校验协议和输入后交给统一规划服务处理。 */
  @Post('commands') @HttpCode(200)
  @ApiOperation({ summary: '新增、调整或移出里程碑节点' })
  execute(@Req() request: IncomingMessage, @Body() body: unknown) {
    assertBusinessOrigin(request);
    return this.milestones.execute(businessToken(request), csrfHeader(request), parseBody(milestoneCommandSchema, body));
  }
}
