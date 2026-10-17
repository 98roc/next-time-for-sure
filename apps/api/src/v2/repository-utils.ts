import { createHash, randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { ConflictException } from '@nestjs/common';
import { z } from 'zod';

/** 兼容 mysql2 的 JSON 文本和已解码对象，后续必须继续用业务 Schema 校验。 */
export function decodeJson(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : value; }

/** UTC 时间固定毫秒精度，mysql2 参数使用 Date 避免 MySQL 字符串时间截断。 */
export function dbTime(value: string | null): Date | null { return value === null ? null : new Date(value); }

/** SQL 日期读取表达式仅由仓储固定列名调用，不接收用户标识符。 */
export function instantColumn(column: string, alias: string): string { return `CONCAT(DATE_FORMAT(${column},'%Y-%m-%dT%H:%i:%s.'),LEFT(DATE_FORMAT(${column},'%f'),3),'Z') AS ${alias}`; }

export const v2ResultSchema = z.object({ objectIds: z.array(z.string().uuid()) });
export type V2Result = z.infer<typeof v2ResultSchema>;

/** 权限须在调用前重新验证；幂等结果仅在已授权操作者下读取。 */
export async function executeOnce(manager: EntityManager, actorId: string, command: { operationId: string }, work: () => Promise<V2Result>): Promise<V2Result> {
  const hash = hashValue(command);
  const records = z.array(z.object({ payload_hash: z.string(), result_json: z.unknown() })).parse(await manager.query('SELECT payload_hash,result_json FROM v2_operations WHERE actor_id=? AND operation_id=?', [actorId, command.operationId]));
  const previous = records[0];
  if (previous) {
    if (previous.payload_hash !== hash) throw new ConflictException('幂等标识已用于其他内容，请核对后重新操作。');
    return v2ResultSchema.parse(decodeJson(previous.result_json));
  }
  const result = await work();
  await manager.query('INSERT INTO v2_operations(actor_id,operation_id,payload_hash,result_json,created_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))', [actorId, command.operationId, hash, JSON.stringify(result)]);
  await manager.query('INSERT INTO audit_events(id,actor_id,action,subject_id,created_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), actorId, 'v2.command', result.objectIds[0] ?? actorId]);
  return result;
}

/** 摘要绑定服务端读取的对象、版本和具体影响；浏览器仅回传服务端结果。 */
export function hashValue(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
