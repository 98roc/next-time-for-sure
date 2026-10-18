import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { loadEnvironment } from '../../config/environment.js';
import { createDataSource } from '../data-source.js';
import { runCutover } from './cutover.js';

/** 发布专用入口；备份由停写后的部署脚本生成并只读挂载，不接受密码或连接串参数。 */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { input: { type: 'string' }, backup: { type: 'string' }, evidence: { type: 'string' } }, strict: true });
  const paths = z.object({ input: z.string().min(1), backup: z.string().min(1), evidence: z.string().min(1) }).parse(values);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(paths.backup)) hash.update(chunk);
  const source = createDataSource(loadEnvironment(), true); await source.initialize();
  try {
    const result = await runCutover(source, JSON.parse(await readFile(paths.input, 'utf8')), hash.digest('hex'));
    await writeFile(paths.evidence, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log('V2 conversion, source/target reconciliation and legacy retirement passed.');
  } finally { await source.destroy(); }
}

void main().catch(() => { console.error('V2_CUTOVER_FAILED: keep traffic stopped; inspect source, backup and migration evidence before recovery.'); process.exitCode = 1; });
