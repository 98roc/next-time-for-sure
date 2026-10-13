import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { IncomingMessage } from 'node:http';
import { weeklyCandidatesQuerySchema } from '@ntfs/contracts';
import { parseBody, sessionToken } from '../identity/http.js';
import { WeeklyPlansService } from './weekly-plans.service.js';

/** 周计划协议入口，读取选择器不隐式生成草稿或形成周承诺。 */
@ApiTags('weekly-plans') @Controller('weekly-plans')
export class WeeklyPlansController {
  constructor(private readonly plans: WeeklyPlansService) {}

  /** 返回当前有权安排的可执行分工；周次必须为周一。 */
  @Get('candidates') @Header('Cache-Control', 'no-store') @ApiOperation({ summary: '查询周计划可安排分工' })
  candidates(@Req() request: IncomingMessage, @Query() query: unknown) {
    const input = parseBody(weeklyCandidatesQuerySchema, query);
    return this.plans.candidates(sessionToken(request), input.teamId, input.week);
  }
}
