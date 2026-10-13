import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { OrganizationService } from './organization.service.js';
import { OrganizationController } from './organization.controller.js';

/** 组织及角色模块复用统一身份与数据库，不创建独立认证通道。 */
@Module({ imports: [IdentityModule], controllers: [OrganizationController], providers: [OrganizationService] })
export class OrganizationModule {}
