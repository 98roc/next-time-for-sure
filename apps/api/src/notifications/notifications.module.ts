import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Module, Post, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { readNotificationSchema } from '@ntfs/contracts';
import { DatabaseService } from '../database/database.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { IdentityModule } from '../identity/identity.module.js';
import { assertBusinessOrigin, csrfHeader, parseBody, businessToken } from '../identity/http.js';
import { loadWorkAccess } from '../work/work-access.js';
import { NotificationRepository } from './notification.repository.js';

/** 轮询与桌面共用此入口；失败保留事件，下次请求继续投递。 */
@Controller('notifications')
class NotificationsController {
  constructor(private readonly database: DatabaseService, private readonly identity: IdentityService) {}
  /** 读取本人有效通知，轮询重连不生成重复记录。 */
  @Get() @Header('Cache-Control', 'no-store')
  list(@Req() request: IncomingMessage) {
    return this.database.transaction(async (manager) => { const access = await loadWorkAccess(manager, this.identity, businessToken(request)); const repository = new NotificationRepository(manager); await repository.deliver(); return repository.list(access); });
  }
  /** 当前可见通知才允许标为已读，拒绝猜测他人标识。 */
  @Post('read') @HttpCode(200)
  read(@Req() request: IncomingMessage, @Body() body: unknown) {
    assertBusinessOrigin(request); const { id } = parseBody(readNotificationSchema, body);
    return this.database.transaction(async (manager) => { const access = await loadWorkAccess(manager, this.identity, businessToken(request), csrfHeader(request)); const repository = new NotificationRepository(manager); if (!(await repository.list(access)).some((entry) => entry.id === id)) throw new ForbiddenException('通知不存在或无权读取。'); await repository.read(id, access.actor.id); return { ok: true }; });
  }
}
/** 站内通知独立于桌面系统弹窗。 */
@Module({ imports: [IdentityModule], controllers: [NotificationsController] })
export class NotificationsModule {}
