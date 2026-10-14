import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { splitCommandSchema } from '@ntfs/contracts';
import { assertBusinessOrigin, csrfHeader, parseBody, businessToken } from '../identity/http.js';
import { SplitService } from './split.service.js';

/** 拆分入口共用服务事务，不在协议层迁移分工。 */
@Controller('tasks')
export class SplitController {
  constructor(private readonly splits: SplitService) {}
  /** 一次命令提交全部子任务及当前分工映射。 */
  @Post('split') @HttpCode(200)
  execute(@Req() request: IncomingMessage, @Body() body: unknown) { assertBusinessOrigin(request); return this.splits.execute(businessToken(request), csrfHeader(request), parseBody(splitCommandSchema, body)); }
}
