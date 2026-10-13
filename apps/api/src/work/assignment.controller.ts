import { Body, Controller, Get, Header, HttpCode, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { assignmentCommandSchema } from '@ntfs/contracts';
import { assertSameOrigin, csrfHeader, parseBody, sessionToken } from '../identity/http.js';
import { AssignmentService } from './assignment.service.js';

/** 分工入口使用同一身份及事务服务，拒绝伪造执行人。 */
@ApiTags('assignments') @Controller('assignments')
export class AssignmentController {
  constructor(private readonly assignments: AssignmentService) {}
  /** 只向本人展示分工完成将停止执行的关联工作。 */
  @Get('completion') @Header('Cache-Control', 'no-store') @ApiOperation({ summary: '预览本人分工完成影响范围' })
  completion(@Req() request: IncomingMessage, @Query('assignmentId') id: unknown) { return this.assignments.completion(sessionToken(request), parseBody(z.string().uuid(), id)); }
  /** 查看项目团队侧分工和多条进展。 */
  @Get() @Header('Cache-Control', 'no-store') @ApiOperation({ summary: '查看项目人员分工' })
  snapshot(@Req() request: IncomingMessage, @Query('projectId') project: unknown) { return this.assignments.snapshot(sessionToken(request), parseBody(z.string().uuid(), project)); }
  /** 责任调整和本人执行使用不同命令契约。 */
  @Post('commands') @HttpCode(200) @ApiOperation({ summary: '分配、认领、转交或维护本人分工' })
  execute(@Req() request: IncomingMessage, @Body() body: unknown) {
    assertSameOrigin(request);
    return this.assignments.execute(sessionToken(request), csrfHeader(request), parseBody(assignmentCommandSchema, body));
  }
}
