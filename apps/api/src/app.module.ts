import { NotificationsModule } from './notifications/notifications.module.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { OrganizationModule } from './organization/organization.module.js';
import { WorkModule } from './work/work.module.js';
import { HealthController } from './health/health.controller.js';
import { WeeklyPlansModule } from './weekly-plans/weekly-plans.module.js';
import { LifecycleModule } from './lifecycle/lifecycle.module.js';

/** 工程底座模块，业务模块按实施阶段加入，不开放伪业务接口。 */
@Module({ imports: [DatabaseModule, IdentityModule, OrganizationModule, WorkModule, WeeklyPlansModule, LifecycleModule, NotificationsModule], controllers: [HealthController] })
export class AppModule {}
