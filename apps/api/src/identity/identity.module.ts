import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller.js';
import { IdentityService } from './identity.service.js';
import { TokensController } from './tokens.controller.js';
import { AgentController } from './agent.controller.js';
import { TokenService } from './token.service.js';

/** 统一登录身份模块，供后续组织权限模块复用当前身份检查。 */
@Module({ controllers: [IdentityController, TokensController, AgentController], providers: [IdentityService, TokenService], exports: [IdentityService] })
export class IdentityModule {}
