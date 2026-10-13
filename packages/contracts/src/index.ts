import { z } from 'zod';

/** 运行探针只报告工程状态，不宣称业务功能已经交付。 */
export const healthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('next-time-for-sure'),
  stage: z.literal('foundation'),
  time: z.string().datetime(),
});
export type Health = z.infer<typeof healthSchema>;

/** 就绪探针要求数据库可访问且已应用已知迁移。 */
export const readinessSchema = z.object({
  status: z.literal('ready'),
  database: z.literal('connected'),
  migrations: z.literal('current'),
});
export type Readiness = z.infer<typeof readinessSchema>;
export * from './identity.js';
export * from './organization.js';
export * from './work.js';
export * from './assignments.js';
export * from './personal.js';
export * from './milestones.js';
export * from './tasks.js';
export * from './splits.js';
