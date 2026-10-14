import { Body, Controller, Get, Header, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { taskCommandSchema, taskEndIntentSchema } from '@ntfs/contracts';
import { assertBusinessOrigin, csrfHeader, parseBody, businessToken } from '../identity/http.js';
import { TaskService } from './task.service.js';

/** 团队整体状态接口只处理协议，影响范围和确认均由服务重算。 */
@Controller('tasks')
export class TaskController {
  constructor(private readonly tasks: TaskService) {}
  /** 结束前读取最新范围，不接受客户端自报影响清单。 */
  @Get('impact') @Header('Cache-Control', 'no-store')
  impact(@Req() request: IncomingMessage, @Query('taskId') taskId: unknown, @Query('intent') intent: unknown) { return this.tasks.impact(businessToken(request), parseBody(z.string().uuid(), taskId), parseBody(taskEndIntentSchema, intent)); }
  /** 执行当前身份有权操作的团队状态变更。 */
  @Post('commands') @HttpCode(200)
  execute(@Req() request: IncomingMessage, @Body() body: unknown) { assertBusinessOrigin(request); return this.tasks.execute(businessToken(request), csrfHeader(request), parseBody(taskCommandSchema, body)); }
}
