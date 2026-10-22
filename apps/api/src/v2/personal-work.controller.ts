import { Body, Controller, Get, Header, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { v2DailyCommandSchema, v2DailyQuerySchema, v2IdSchema, v2PersonalSettingsCommandSchema, v2SubtasksCommandSchema } from '@ntfs/contracts';
import { assertBusinessOrigin, businessToken, csrfHeader, parseBody } from '../identity/http.js';
import { PersonalWorkService } from './personal-work.service.js';

/** 私人执行协议仅负责输入、来源与防缓存，权限集中在事务服务。 */
@Controller('v2')
export class PersonalWorkController {
  constructor(private readonly service: PersonalWorkService) {}
  /** 本人当前任务的子任务清单。 */
  @Get('subtasks') @Header('Cache-Control', 'no-store')
  subtasks(@Req() request: IncomingMessage, @Query() query: unknown) { return this.service.subtasks(businessToken(request), parseBody(z.object({ taskId: v2IdSchema }).strict(), query).taskId); }
  /** 完整清单原子保存。 */
  @Post('subtasks') @HttpCode(200)
  saveSubtasks(@Req() request: IncomingMessage, @Body() body: unknown) { assertBusinessOrigin(request); return this.service.saveSubtasks(businessToken(request), csrfHeader(request), parseBody(v2SubtasksCommandSchema, body)); }
  /** 本人所选日期日报。 */
  @Get('daily') @Header('Cache-Control', 'no-store')
  daily(@Req() request: IncomingMessage, @Query() query: unknown) { return this.service.daily(businessToken(request), parseBody(v2DailyQuerySchema, query).on); }
  /** 私人文字保护与来源确认。 */
  @Post('daily') @HttpCode(200)
  saveDaily(@Req() request: IncomingMessage, @Body() body: unknown) { assertBusinessOrigin(request); return this.service.saveDaily(businessToken(request), csrfHeader(request), parseBody(v2DailyCommandSchema, body)); }
  /** 当前账号模式与私人日报排序。 */
  @Post('personal-settings') @HttpCode(200)
  settings(@Req() request: IncomingMessage, @Body() body: unknown) { assertBusinessOrigin(request); return this.service.settings(businessToken(request), csrfHeader(request), parseBody(v2PersonalSettingsCommandSchema, body)); }
}
