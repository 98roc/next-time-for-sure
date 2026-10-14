import { Body, Controller, Get, Header, HttpCode, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { IncomingMessage } from 'node:http';
import { weeklyCandidatesQuerySchema, weeklyPlanCommandSchema } from '@ntfs/contracts';
import { assertSameOrigin, csrfHeader, parseBody, sessionToken } from '../identity/http.js';
import { WeeklyPlansService } from './weekly-plans.service.js';

/** 周计划协议入口，读取选择器不隐式生成草稿或形成周承诺。 */
@ApiTags('weekly-plans') @Controller('weekly-plans')
export class WeeklyPlansController {
  constructor(private readonly plans: WeeklyPlansService) {}
  /** 正式计划按当前团队身份读取，不暴露其他团队快照。 */
  @Get('publications') @Header('Cache-Control', 'no-store')
  publications(@Req() request: IncomingMessage, @Query() query: unknown) { const input = parseBody(weeklyCandidatesQuerySchema, query); return this.plans.publications(sessionToken(request), input.teamId, input.week); }
  /** 发布之前显示完整范围并获得确认摘要。 */
  @Get('preview') @Header('Cache-Control', 'no-store')
  preview(@Req() request: IncomingMessage, @Query() query: unknown) { const input = parseBody(weeklyCandidatesQuerySchema, query); return this.plans.preview(sessionToken(request), input.teamId, input.week); }

  /** 查看有权编排的共享草稿内容，不自动创建。 */
  @Get() @Header('Cache-Control', 'no-store')
  async draft(@Req() request: IncomingMessage, @Query() query: unknown) {
    const input = parseBody(weeklyCandidatesQuerySchema, query);
    return { draft: await this.plans.draft(sessionToken(request), input.teamId, input.week) };
  }

  /** 初始化、保存及结转均在当前身份和组织锁下完成。 */
  @Post('commands') @HttpCode(200)
  execute(@Req() request: IncomingMessage, @Body() body: unknown) {
    assertSameOrigin(request);
    return this.plans.execute(sessionToken(request), csrfHeader(request), parseBody(weeklyPlanCommandSchema, body));
  }

  /** 返回当前有权安排的可执行分工；周次必须为周一。 */
  @Get('candidates') @Header('Cache-Control', 'no-store') @ApiOperation({ summary: '查询周计划可安排分工' })
  candidates(@Req() request: IncomingMessage, @Query() query: unknown) {
    const input = parseBody(weeklyCandidatesQuerySchema, query);
    return this.plans.candidates(sessionToken(request), input.teamId, input.week);
  }
}
