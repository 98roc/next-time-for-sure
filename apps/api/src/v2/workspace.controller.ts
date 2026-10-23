import { Body, Controller, Get, Header, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { v2IdSchema, v2ImpactIntentSchema, v2MemberImpactInputSchema, v2PeriodPairSchema, v2PersonalCommandSchema, v2PlanningCommandSchema, v2ProjectCommandSchema, v2ReportCommandSchema, v2TaskCommandSchema, v2TaskEditSchema, v2TeamCommandSchema } from '@ntfs/contracts';
import { assertBusinessOrigin, businessToken, csrfHeader, parseBody } from '../identity/http.js';
import { V2WorkspaceService } from './workspace.service.js';

/** 页面和 Agent 共用的新版协议入口，只做输入及来源检查。 */
@Controller('v2')
export class V2WorkspaceController {
  constructor(private readonly service: V2WorkspaceService) {}
  /** 分页消息及桌面增量游标共用身份和权限边界。 */
  @Get('notifications') @Header('Cache-Control', 'no-store')
  notifications(@Req() request: IncomingMessage, @Query() query: unknown) {
    const input = parseBody(z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), after: z.union([z.literal('start'), z.string().regex(/^\d{1,20}$/u)]).optional() }).strict(), query);
    return this.service.messages(businessToken(request), input.page, input.after);
  }
  /** 读取当前可见的工作区。 */
  @Get('workspace') @Header('Cache-Control', 'no-store')
  workspace(@Req() request: IncomingMessage) { return this.service.snapshot(businessToken(request)); }
  /** 查询单条任务历史。 */
  @Get('history') @Header('Cache-Control', 'no-store')
  history(@Req() request: IncomingMessage, @Query() query: unknown) { return this.service.history(businessToken(request), parseBody(z.object({ taskId: v2IdSchema }).strict(), query).taskId); }
  /** 总览包含区间安排和实际执行，不把后来状态写入历史。 */
  @Get('summary') @Header('Cache-Control', 'no-store')
  summary(@Req() request: IncomingMessage, @Query() query: unknown) { return this.service.summary(businessToken(request), parseBody(z.object({ periodId: v2IdSchema }).strict(), query).periodId); }
  /** 只读影响预览不需要 CSRF 写入令牌，但仍验证业务来源。 */
  @Post('impact') @HttpCode(200) @Header('Cache-Control', 'no-store')
  impact(@Req() request: IncomingMessage, @Body() body: unknown) { assertBusinessOrigin(request); return this.service.impact(businessToken(request), parseBody(v2ImpactIntentSchema, body)); }
  /** 项目和私人任务共用命令入口。 */
  @Post('tasks') @HttpCode(200)
  task(@Req() request: IncomingMessage, @Body() body: unknown) { assertBusinessOrigin(request); return this.service.task(businessToken(request), csrfHeader(request), parseBody(v2TaskCommandSchema, body)); }
  /** 项目待建和里程碑命令。 */
  @Post('projects') @HttpCode(200)
  project(@Req() request: IncomingMessage, @Body() body: unknown) { assertBusinessOrigin(request); return this.service.project(businessToken(request), csrfHeader(request), parseBody(v2ProjectCommandSchema, body)); }
  /** 本人分类及顺序命令。 */
  @Post('personal') @HttpCode(200)
  personal(@Req() request: IncomingMessage, @Body() body: unknown) { assertBusinessOrigin(request); return this.service.personal(businessToken(request), csrfHeader(request), parseBody(v2PersonalCommandSchema, body)); }
  /** 按相邻两个日期区间读取总结和计划。 */
  @Get('weekly') @Header('Cache-Control', 'no-store')
  weekly(@Req() request: IncomingMessage, @Query() query: unknown) { const pair = parseBody(v2PeriodPairSchema, query); return this.service.weekly(businessToken(request), pair.summaryPeriodId, pair.planPeriodId); }
  /** 日期与共享排序命令。 */
  @Post('planning') @HttpCode(200)
  planning(@Req() request: IncomingMessage, @Body() body: unknown) { assertBusinessOrigin(request); return this.service.planning(businessToken(request), csrfHeader(request), parseBody(v2PlanningCommandSchema, body)); }
  /** 共享文字写入，服务再次核验团队负责人身份。 */
  @Post('report') @HttpCode(200)
  report(@Req() request: IncomingMessage, @Body() body: unknown) { assertBusinessOrigin(request); return this.service.report(businessToken(request), csrfHeader(request), parseBody(v2ReportCommandSchema, body)); }
  /** 成员移出影响不含私人工作。 */
  @Post('members-impact') @HttpCode(200) @Header('Cache-Control', 'no-store')
  membersImpact(@Req() request: IncomingMessage, @Body() body: unknown) { assertBusinessOrigin(request); return this.service.membersImpact(businessToken(request), parseBody(v2MemberImpactInputSchema, body)); }
  /** 团队文案及多人项目负责人配置。 */
  @Post('team') @HttpCode(200)
  team(@Req() request: IncomingMessage, @Body() body: unknown) { assertBusinessOrigin(request); return this.service.team(businessToken(request), csrfHeader(request), parseBody(v2TeamCommandSchema, body)); }
  /** 编辑弹窗一次保存。 */
  @Post('edit') @HttpCode(200)
  edit(@Req() request: IncomingMessage, @Body() body: unknown) { assertBusinessOrigin(request); return this.service.edit(businessToken(request), csrfHeader(request), parseBody(v2TaskEditSchema, body)); }
}
