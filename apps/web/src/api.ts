import { healthSchema, readinessSchema } from '@ntfs/contracts';
import type { Health, Readiness } from '@ntfs/contracts';

/** 仅请求同源API，超时及非JSON响应都作为失败反馈给用户。 */
async function get(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/v1/health/${path}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), cache: 'no-store' });
  if (!response.ok) throw new Error(path === 'ready' ? '数据库尚未就绪，请检查配置并执行迁移。' : '后端暂时无法连接，请检查服务是否启动。');
  return response.json();
}

/** 探针响应也进行运行时校验，避免前后端契约漂移被静默接受。 */
export async function fetchHealth(signal: AbortSignal): Promise<Health> { return healthSchema.parse(await get('live', signal)); }

/** 数据库检查与进程存活独立展示，避免把启动成功当作迁移成功。 */
export async function fetchReadiness(signal: AbortSignal): Promise<Readiness> { return readinessSchema.parse(await get('ready', signal)); }
