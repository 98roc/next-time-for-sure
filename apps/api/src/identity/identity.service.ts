import { randomBytes } from 'node:crypto';
import { ForbiddenException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { Identity } from '@ntfs/contracts';
import { DatabaseService } from '../database/database.service.js';
import { IdentityRepository } from './identity.repository.js';
import type { AccountRow } from './identity.repository.js';
import { digest, hashPassword, verifyPassword } from './password.js';

export type Authenticated = { account: AccountRow; csrf: string; hash: string };

/** 会话身份和个人Token分开；本阶段只接受登录会话，不接受Bearer替代。 */
@Injectable()
export class IdentityService {
  constructor(private readonly database: DatabaseService) {}

  /** Cookie不能替代当前账号状态检查；锁定账号后再次核对会话撤销。 */
  async authenticate(manager: EntityManager, token: string, csrf?: string): Promise<Authenticated> {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException('请先登录。');
    const repository = new IdentityRepository(manager);
    const hash = digest(token);
    const session = await repository.session(hash);
    if (!session) throw new UnauthorizedException('登录已失效，请重新登录。');
    const account = await repository.accountById(session.account_id);
    // MySQL默认可重复读下，必须用当前读检查锁等待期间已提交的会话撤销。
    if (!account || account.disabled || !await repository.session(hash, true)) throw new UnauthorizedException('登录已失效，请重新登录。');
    if (csrf !== undefined && csrf !== session.csrf_token) throw new ForbiddenException('操作校验失败，请刷新后重试。');
    return { account, csrf: session.csrf_token, hash };
  }

  /** 返回脱敏身份，不把数据库账号对象直接返回给客户端。 */
  publicIdentity(account: AccountRow, csrf: string): Identity {
    return { id: account.id, loginName: account.login_name, displayName: account.display_name, isSuperAdmin: Boolean(account.is_super_admin), mustChangePassword: Boolean(account.must_change_password), csrfToken: csrf };
  }

  /** 登录失败和频率限制使用统一错误，不透露账号是否存在或被禁用。 */
  async login(login: string, password: string, remoteAddress: string) {
    const result = await this.database.transaction(async (manager) => {
      const repository = new IdentityRepository(manager);
      if (!await repository.reserveAttempt(digest(remoteAddress))) return { outcome: 'limited' };
      const account = await repository.accountByLogin(login);
      // 不存在的账号也执行同参数派生，减少账号枚举的时间差。
      const valid = await verifyPassword(password, account?.password_hash ?? `scrypt-v1$${'0'.repeat(32)}$${'0'.repeat(128)}`);
      if (!account || !valid || account.disabled) return { outcome: 'invalid' };
      const token = randomBytes(32).toString('hex');
      const csrf = randomBytes(32).toString('hex');
      await repository.createSession(digest(token), account.id, csrf);
      await repository.audit(account.id, 'session.login');
      return { outcome: 'success', token, identity: this.publicIdentity(account, csrf) };
    });
    if (result.outcome === 'limited') throw new HttpException('登录尝试过于频繁，请15分钟后重试。', 429);
    if (!result.token || !result.identity) throw new UnauthorizedException('账号或密码错误，或账号不可用。');
    return { token: result.token, identity: result.identity };
  }

  /** 每次重新读取身份，不缓存账号禁用或角色状态。 */
  async current(token: string): Promise<Identity> {
    return this.database.transaction(async (manager) => {
      const auth = await this.authenticate(manager, token);
      return this.publicIdentity(auth.account, auth.csrf);
    });
  }

  /** 本人改密须校验原密码；所有旧会话立即撤销。 */
  async changePassword(token: string, csrf: string, current: string, replacement: string): Promise<void> {
    await this.database.transaction(async (manager) => {
      const auth = await this.authenticate(manager, token, csrf);
      if (!await verifyPassword(current, auth.account.password_hash)) throw new ForbiddenException('当前密码不正确。');
      const repository = new IdentityRepository(manager);
      await repository.changePassword(auth.account.id, await hashPassword(replacement));
      await repository.audit(auth.account.id, 'account.password_changed');
    });
  }

  /** 撤销当前会话并留痕，客户端同时清除Cookie。 */
  async logout(token: string, csrf: string): Promise<void> {
    await this.database.transaction(async (manager) => {
      const auth = await this.authenticate(manager, token, csrf);
      const repository = new IdentityRepository(manager);
      await repository.revoke(auth.hash);
      await repository.audit(auth.account.id, 'session.logout');
    });
  }
}
