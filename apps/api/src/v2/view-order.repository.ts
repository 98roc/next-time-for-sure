import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { decodeJson } from './repository-utils.js';
import { resolveOrder } from './sorting.js';

const orderRows = z.array(z.object({ ordered_ids: z.unknown(), version: z.number(), manual_order: z.coerce.boolean() }));

/** 当前账号的页面顺序；账号只能由已认证上下文提供，调用方须在组织锁内校验可见范围。 */
export class V2ViewOrderRepository {
  constructor(private readonly manager: EntityManager, private readonly ownerId: string) {}

  /** 首次读取继承切换前的共享顺序，随后独立保存；完整目录合并新项，返回前由调用方裁剪权限。 */
  async order(teamId: string, scope: string, ids: string[], newestIds = ids) {
    await this.manager.query('INSERT IGNORE INTO v2_view_orders(owner_id,team_id,scope_key,ordered_ids,version,manual_order) SELECT ?,team_id,scope_key,ordered_ids,version,manual_order FROM v2_shared_orders WHERE team_id=? AND scope_key=?', [this.ownerId, teamId, scope]);
    const [row] = orderRows.parse(await this.manager.query('SELECT ordered_ids,version,manual_order FROM v2_view_orders WHERE owner_id=? AND team_id=? AND scope_key=?', [this.ownerId, teamId, scope]));
    const stored = row ? z.array(z.string()).parse(decodeJson(row.ordered_ids)) : [];
    const manual = row?.manual_order ?? false, resolved = resolveOrder(ids, manual ? stored : null, newestIds);
    let version = row?.version ?? 0;

    // 自动并入新增项也递增版本，避免另一窗口用旧列表覆盖新顺序。
    if (manual && JSON.stringify(resolved) !== JSON.stringify(stored)) {
      await this.saveOrder(teamId, scope, resolved); version++;
    }
    return { ids: resolved, version, manual };
  }

  /** 恢复默认保留版本行，仅更新本人在该团队和页面范围的顺序。 */
  async saveOrder(teamId: string, scope: string, ids: string[], manual = true): Promise<void> {
    await this.manager.query('INSERT INTO v2_view_orders(owner_id,team_id,scope_key,ordered_ids,version,manual_order) VALUES (?,?,?,?,1,?) ON DUPLICATE KEY UPDATE ordered_ids=VALUES(ordered_ids),manual_order=VALUES(manual_order),version=version+1', [this.ownerId, teamId, scope, JSON.stringify(ids), Number(manual)]);
  }
}
