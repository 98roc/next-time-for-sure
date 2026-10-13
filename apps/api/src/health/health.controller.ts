import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Health, Readiness } from '@ntfs/contracts';
import { DatabaseService } from '../database/database.service.js';

/** 公开探针不返回凭据、用户名、任务或其他业务数据。 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  /** 检查进程能否响应，不依赖数据库连接。 */
  @Get('live')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '进程存活检查；不代表数据库或业务已就绪' })
  live(): Health {
    return { status: 'ok', service: 'next-time-for-sure', stage: 'foundation', time: new Date().toISOString() };
  }

  /** 数据库不可访问或基线不匹配时返回503，不执行迁移。 */
  @Get('ready')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '检查数据库连接及迁移基线' })
  ready(): Promise<Readiness> { return this.database.readiness(); }
}
