import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { WeeklyPlansController } from './weekly-plans.controller.js';
import { WeeklyPlansService } from './weekly-plans.service.js';
import { ReportsService } from './reports.service.js';
import { TagsService } from './tags.service.js';
import { ReportsController, TagsController } from './reports.controller.js';

/** 周计划按团队共享，具体安排范围由服务按负责小组裁剪。 */
@Module({ imports: [IdentityModule], controllers: [WeeklyPlansController, ReportsController, TagsController], providers: [WeeklyPlansService, ReportsService, TagsService] })
export class WeeklyPlansModule {}
