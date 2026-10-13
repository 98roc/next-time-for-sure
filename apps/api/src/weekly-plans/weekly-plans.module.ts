import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { WeeklyPlansController } from './weekly-plans.controller.js';
import { WeeklyPlansService } from './weekly-plans.service.js';

/** 周计划按团队共享，具体安排范围由服务按负责小组裁剪。 */
@Module({ imports: [IdentityModule], controllers: [WeeklyPlansController], providers: [WeeklyPlansService] })
export class WeeklyPlansModule {}
