import { Body, Controller, Get, Header, HttpCode, Module, Post, Req, Query } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { lifecycleIntentSchema, lifecycleCommandSchema, reportWeekSchema } from '@ntfs/contracts';
import { IdentityModule } from '../identity/identity.module.js';
import { assertBusinessOrigin, csrfHeader, parseBody, businessToken } from '../identity/http.js';
import { LifecycleService } from './lifecycle.service.js';

/** 生命周期协议层只负责校验与会话提取。 */
@Controller('lifecycle')
class LifecycleController {
  constructor(private readonly service: LifecycleService) {}
  /** 查询独立保存的操作历史。 */
  @Get('history') @Header('Cache-Control', 'no-store')
  history(@Req() request: IncomingMessage) { return this.service.history(businessToken(request)); }
  /** 按周返回项目与人员维度的授权总览。 */
  @Get('overview') @Header('Cache-Control', 'no-store')
  overview(@Req() request: IncomingMessage, @Query('week') week: unknown) { return this.service.overview(businessToken(request), parseBody(reportWeekSchema, week)); }
  /** 预览使用POST避免在URL承载复杂操作参数，不改变数据。 */
  @Post('preview') @HttpCode(200) @Header('Cache-Control', 'no-store')
  preview(@Req() request: IncomingMessage, @Body() body: unknown) { assertBusinessOrigin(request); return this.service.preview(businessToken(request), parseBody(lifecycleIntentSchema, body)); }
  /** 返回负责人当前需处理的职责，无自动代办。 */
  @Get('handoff') @Header('Cache-Control', 'no-store')
  handoff(@Req() request: IncomingMessage) { return this.service.handoff(businessToken(request)); }
  /** 确认请求与影响版本绑定。 */
  @Post('commands') @HttpCode(200)
  execute(@Req() request: IncomingMessage, @Body() body: unknown) { assertBusinessOrigin(request); return this.service.execute(businessToken(request), csrfHeader(request), parseBody(lifecycleCommandSchema, body)); }
}
/** 项目与人员生命周期共用事务和身份模块。 */
@Module({ imports: [IdentityModule], controllers: [LifecycleController], providers: [LifecycleService] })
export class LifecycleModule {}
