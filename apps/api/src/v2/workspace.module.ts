import { MessageRetentionService } from './message-retention.service.js';
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { V2WorkspaceController } from './workspace.controller.js';
import { V2WorkspaceService } from './workspace.service.js';

/** V2 协议入口集中复用同一事务服务，不依赖旧分工、发布和通知模块。 */
@Module({ imports: [IdentityModule], controllers: [V2WorkspaceController], providers: [V2WorkspaceService, MessageRetentionService] })
export class V2WorkspaceModule {}
