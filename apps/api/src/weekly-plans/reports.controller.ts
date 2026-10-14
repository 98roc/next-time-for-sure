import { Body, Controller, Get, Header, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { reportingQuerySchema, reportCommandSchema, tagCommandSchema } from '@ntfs/contracts';
import { z } from 'zod';
import { assertSameOrigin, csrfHeader, parseBody, sessionToken } from '../identity/http.js';
import { ReportsService } from './reports.service.js';
import { TagsService } from './tags.service.js';

/** 周报读取与命令共用当前会话授权，发布副本禁止缓存。 */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  /** 返回权限裁剪后的整理状态。 */
  @Get() @Header('Cache-Control', 'no-store')
  state(@Req() request: IncomingMessage, @Query() query: unknown) { const value = parseBody(reportingQuerySchema, query); return this.reports.state(sessionToken(request), value.teamId, value.week); }
  /** 获取绑定当前来源的发布确认摘要。 */
  @Get('preview') @Header('Cache-Control', 'no-store')
  preview(@Req() request: IncomingMessage, @Query() query: unknown) { const value = parseBody(reportingQuerySchema, query); return this.reports.preview(sessionToken(request), value.teamId, value.week); }
  /** 整理命令不直接修改原始执行内容。 */
  @Post('commands') @HttpCode(200)
  execute(@Req() request: IncomingMessage, @Body() body: unknown) { assertSameOrigin(request); return this.reports.execute(sessionToken(request), csrfHeader(request), parseBody(reportCommandSchema, body)); }
}
const tagQuery = z.object({ objectId: z.string().uuid(), objectKind: z.enum(['task', 'personal']) }).strict();
/** 标签是独立的人工维度，不能由日期推断。 */
@Controller('work-tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}
  /** 按当前对象查看权限读取标签。 */
  @Get() @Header('Cache-Control', 'no-store')
  state(@Req() request: IncomingMessage, @Query() query: unknown) { const value = parseBody(tagQuery, query); return this.tags.state(sessionToken(request), value.objectId, value.objectKind); }
  /** 标签修改必须通过行版本和管理范围校验。 */
  @Post('commands') @HttpCode(200)
  execute(@Req() request: IncomingMessage, @Body() body: unknown) { assertSameOrigin(request); return this.tags.execute(sessionToken(request), csrfHeader(request), parseBody(tagCommandSchema, body)); }
}
