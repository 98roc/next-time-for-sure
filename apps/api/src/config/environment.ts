import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';

const environmentSchema = z.object({
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_USERNAME: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  // 本阶段只允许项目独立库，避免迁移触及其他项目。
  DB_DATABASE: z.literal('next_time_for_sure'),
  API_HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1024).max(65535).default(3100),
});
export type Environment = z.infer<typeof environmentSchema>;

/** 只定位本项目根目录，不读取上层或其他项目的凭据。 */
function findProjectRoot(start: string): string {
  let current = start;
  while (!existsSync(join(current, 'pnpm-workspace.yaml'))) {
    const parent = dirname(current);
    if (parent === current) throw new Error('Cannot locate project workspace');
    current = parent;
  }
  return current;
}

/** 校验配置，错误只包含字段名称，不泄漏密码或连接串。 */
export function parseEnvironment(input: NodeJS.ProcessEnv): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid local configuration: ${fields.join(', ')}`);
  }
  return result.data;
}

/** 环境变量优先，本地文件只补充未配置的值。 */
export function loadEnvironment(): Environment {
  config({ path: join(findProjectRoot(dirname(fileURLToPath(import.meta.url))), '.env.local'), quiet: true });
  return parseEnvironment(process.env);
}
