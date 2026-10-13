import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller.js';
import { IdentityService } from './identity.service.js';

/** 统一登录身份模块，供后续组织权限模块复用当前身份检查。 */
@Module({ controllers: [IdentityController], providers: [IdentityService], exports: [IdentityService] })
export class IdentityModule {}
