import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { WorkController } from './work.controller.js';
import { WorkService } from './work.service.js';
import { AssignmentController } from './assignment.controller.js';
import { AssignmentService } from './assignment.service.js';
import { PersonalController } from './personal.controller.js';
import { PersonalService } from './personal.service.js';
import { MilestoneController } from './milestone.controller.js';
import { MilestoneService } from './milestone.service.js';

/** 需求与团队任务共用同一业务服务，为网页及后续Agent提供一致规则。 */
@Module({ imports: [IdentityModule], controllers: [WorkController, AssignmentController, PersonalController, MilestoneController], providers: [WorkService, AssignmentService, PersonalService, MilestoneService] })
export class WorkModule {}
