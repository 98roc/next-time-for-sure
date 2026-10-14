import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { createTokenSchema } from '@ntfs/contracts';
import type { z } from 'zod';
import { DatabaseService } from '../database/database.service.js';
import { IdentityService } from './identity.service.js';
import { IdentityRepository } from './identity.repository.js';
import { TokenRepository } from './token.repository.js';
import { digest } from './password.js';

/** 凭据管理使用登录会话，权限、事务和审计集中在服务层。 */
@Injectable()
export class TokenService {
  constructor(private readonly database: DatabaseService, private readonly identity: IdentityService) {}
  /** 仅返回本人凭据元数据。 */
  list(session: string) {
    return this.database.transaction(async (manager) => {
      const auth = await this.identity.authenticate(manager, session);
      return new TokenRepository(manager).list(auth.account.id);
    });
  }
  /** 明文只在创建响应出现，数据库及审计均不保存明文。 */
  create(session: string, csrf: string, input: z.infer<typeof createTokenSchema>) {
    return this.database.transaction(async (manager) => {
      const auth = await this.identity.authenticate(manager, session, csrf);
      if (auth.account.must_change_password) throw new ForbiddenException('请先修改临时密码。');
      if (input.expiresAt === null ? !input.permanentConfirmed : Date.parse(input.expiresAt) <= Date.now()) throw new BadRequestException('请选择未来的到期时间，永久有效需明确确认。');

      // 身份和有效期通过后才生成凭据，写入摘要与无敏感信息的审计。
      const id = randomUUID(); const token = `ntfs_${randomBytes(32).toString('hex')}`;
      await new TokenRepository(manager).create(id, auth.account.id, input.name, digest(token), input.expiresAt);
      await new IdentityRepository(manager).audit(auth.account.id, 'token.created', id);
      return { id, token };
    });
  }
  /** 重复撤销保持首次时间，拒绝管理他人凭据。 */
  revoke(session: string, csrf: string, id: string) {
    return this.database.transaction(async (manager) => {
      const auth = await this.identity.authenticate(manager, session, csrf);
      const repository = new TokenRepository(manager);
      if (!(await repository.list(auth.account.id)).some((entry) => entry.id === id)) throw new ForbiddenException('没有该凭据的管理权限。');
      await repository.revoke(auth.account.id, id);
      await new IdentityRepository(manager).audit(auth.account.id, 'token.revoked', id);
      return { ok: true };
    });
  }
}
