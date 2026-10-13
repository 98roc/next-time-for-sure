import { Module } from '@nestjs/common';
import { DatabaseService } from './database/database.service.js';
import { HealthController } from './health/health.controller.js';

/** 工程底座模块，业务模块按实施阶段加入，不开放伪业务接口。 */
@Module({ controllers: [HealthController], providers: [DatabaseService] })
export class AppModule {}
