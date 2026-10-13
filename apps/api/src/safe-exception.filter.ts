import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { z } from 'zod';

/** 未知异常不输出SQL、绑定参数或堆栈，避免凭据进入日志及响应。 */
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  /** 已知业务错误保留反馈，未知错误统一提示重试。 */
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ServerResponse>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const parsed = error instanceof HttpException ? z.object({ message: z.string() }).safeParse(error.getResponse()) : null;
    const message = error instanceof HttpException ? (parsed?.success ? parsed.data.message : error.message) : '服务暂时不可用，请稍后重试。';
    if (status >= 500) console.error('API request failed; sensitive error details suppressed.');
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ statusCode: status, message }));
  }
}
