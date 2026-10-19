import { resolveOrder } from './sorting.js';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { v2ArrangementHistorySchema, v2PeriodSchema, type V2Period } from '@ntfs/contracts';
import { naturalWeek, shiftDate } from './calendar.js';
import { decodeJson, instantColumn } from './repository-utils.js';
import type { V2ReportText } from './shared-report.js';

const textSchema = z.object({ body: z.string(), manual: z.union([z.boolean(), z.number()]).transform(Boolean), sourceHash: z.string(), version: z.number() });

/** 团队日期、共享顺序和共享文字持久化；调用前必须检查相应团队或项目管理权限。 */
export class V2PlanningRepository {
  constructor(private readonly manager: EntityManager) {}

  /** 新团队初始化默认自然周目录；不产生任务、不结转旧工作。 */
  async ensure(teamId: string, today: string): Promise<void> {
    await this.manager.query('INSERT IGNORE INTO v2_team_settings(team_id) VALUES (?)', [teamId]);
    if ((await this.periods(teamId)).length) return;
    const week = naturalWeek(today);
    for (let offset = -2; offset <= 4; offset++) await this.insertPeriod({ id: randomUUID(), teamId, startOn: shiftDate(week.startOn, offset * 7), endOn: shiftDate(week.endOn, offset * 7), version: 0 });
  }
  /** 完整目录按起始日期排序，相邻联动不能固定加减七天。 */
  async periods(teamId: string): Promise<V2Period[]> { return z.array(v2PeriodSchema).parse(await this.manager.query("SELECT id,team_id AS teamId,DATE_FORMAT(start_on,'%Y-%m-%d') AS startOn,DATE_FORMAT(end_on,'%Y-%m-%d') AS endOn,version FROM v2_periods WHERE team_id=? ORDER BY start_on", [teamId])); }
  /** 团队配置始终携带目录版本，避免日期调整和自动扩展互相覆盖。 */
  async settings(teamId: string) { return z.array(z.object({ message: z.string(), version: z.number() })).parse(await this.manager.query('SELECT message,version FROM v2_team_settings WHERE team_id=?', [teamId]))[0] ?? { message: '', version: 0 }; }
  /** 扩展目录只插入经过连续性验证的新区间。 */
  async insertPeriod(period: V2Period): Promise<void> { await this.manager.query('INSERT INTO v2_periods(id,team_id,start_on,end_on,version) VALUES (?,?,?,?,?)', [period.id, period.teamId, period.startOn, period.endOn, period.version]); }
  /** 调整边界只更新有变动的行并递增目录版本。 */
  async updatePeriods(current: V2Period[], proposed: V2Period[], teamId: string, actorId: string): Promise<void> {
    // 唯一起始日不能在交换中暂时冲突；连续区间不允许交换编号，只更新边界。
    for (const period of proposed) {
      const original = current.find((entry) => entry.id === period.id);
      if (original && (original.startOn !== period.startOn || original.endOn !== period.endOn)) await this.manager.query('UPDATE v2_periods SET start_on=?,end_on=?,version=version+1 WHERE id=?', [period.startOn, period.endOn, period.id]);
    }
    await this.bump(teamId);
    await this.manager.query("INSERT INTO v2_object_events(id,team_id,object_id,actor_id,action,payload_json,occurred_at) VALUES (?,?,?,?,'periods.changed',?,UTC_TIMESTAMP(3))", [randomUUID(), teamId, teamId, actorId, JSON.stringify({ before: current, after: proposed })]);
  }
  /** 团队文案空白标准化为空，前端不制造占位。 */
  async setMessage(teamId: string, message: string): Promise<void> { await this.manager.query('UPDATE v2_team_settings SET message=?,version=version+1 WHERE team_id=?', [message.trim(), teamId]); }
  /** 目录变更统一版本。 */
  async bump(teamId: string): Promise<void> { await this.manager.query('UPDATE v2_team_settings SET version=version+1 WHERE team_id=?', [teamId]); }

  /** 仅加载已授权任务历史，不能借共享区间读取私人或无权项目。 */
  async arrangementHistory(taskIds: string[]) {
    if (!taskIds.length) return [];
    return z.array(z.object({ plannedDays: z.coerce.number().nullable() }).passthrough().pipe(v2ArrangementHistorySchema)).parse(await this.manager.query(`SELECT id,task_id AS taskId,period_id AS periodId,provenance,planned_days AS plannedDays,${instantColumn('valid_from','validFrom')},${instantColumn('valid_until','validUntil')} FROM v2_arrangement_history WHERE task_id IN (${taskIds.map(() => '?').join(',')}) ORDER BY valid_from,id`, taskIds));
  }
  /** 完整作用域在组织锁内合并新增项并保存，避免下一次新增挤乱已置顶对象。 */
  async order(teamId: string, scope: string, ids: string[], newestIds = ids) {
    const rows = z.array(z.object({ ordered_ids: z.unknown(), version: z.number(), manual_order: z.coerce.boolean() })).parse(await this.manager.query('SELECT ordered_ids,version,manual_order FROM v2_shared_orders WHERE team_id=? AND scope_key=?', [teamId, scope]));
    const row = rows[0], stored = row ? z.array(z.string()).parse(decodeJson(row.ordered_ids)) : [];
    const manual = row?.manual_order ?? false, resolved = resolveOrder(ids, manual ? stored : null, newestIds);
    let version = row?.version ?? 0;
    if (manual && JSON.stringify(resolved) !== JSON.stringify(stored)) {
      await this.saveOrder(teamId, scope, resolved); version++;
    }
    return { ids: resolved, version, manual };
  }

  /** 恢复默认也递增版本，不删除版本行，防止旧的拖动请求再次覆盖。 */
  async saveOrder(teamId: string, scope: string, ids: string[], manual = true): Promise<void> {
    await this.manager.query('INSERT INTO v2_shared_orders(team_id,scope_key,ordered_ids,version,manual_order) VALUES (?,?,?,1,?) ON DUPLICATE KEY UPDATE ordered_ids=VALUES(ordered_ids),manual_order=VALUES(manual_order),version=version+1', [teamId, scope, JSON.stringify(ids), Number(manual)]);
  }
  /** 整稿仅供团队负责人，受限成员不调用本查询。 */
  async report(teamId: string, summaryId: string, planId: string): Promise<V2ReportText | null> { return z.array(textSchema).parse(await this.manager.query('SELECT body,manual,source_hash AS sourceHash,version FROM v2_report_texts WHERE team_id=? AND summary_period_id=? AND plan_period_id=?', [teamId, summaryId, planId]))[0] ?? null; }
  /** 保存保留来源摘要，禁止静默将手工文字标记同步。 */
  async saveReport(teamId: string, summaryId: string, planId: string, actorId: string, text: V2ReportText): Promise<void> {
    await this.manager.query('INSERT INTO v2_report_texts(team_id,summary_period_id,plan_period_id,body,manual,source_hash,version,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE body=VALUES(body),manual=VALUES(manual),source_hash=VALUES(source_hash),version=VALUES(version),updated_by=VALUES(updated_by),updated_at=UTC_TIMESTAMP(3)', [teamId, summaryId, planId, text.body, Number(text.manual), text.sourceHash, text.version, actorId]);
  }
  /** 日期影响预览只列范围及版本，不泄漏手工全文。 */
  async reportVersions(teamId: string) { return z.array(z.object({ summaryPeriodId: z.string(), planPeriodId: z.string(), version: z.number() })).parse(await this.manager.query('SELECT summary_period_id AS summaryPeriodId,plan_period_id AS planPeriodId,version FROM v2_report_texts WHERE team_id=?', [teamId])); }
}
