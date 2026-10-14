import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** 单次Codex真实兼容验收：只保存脱敏的工具名、结果状态和Skill读取证据。 */
export async function probeCodex(base: string, token: string, projectId: string, foreignId: string): Promise<void> {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const directory = new URL('../../../../.cache/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const tokenPath = fileURLToPath(new URL(`codex-${randomUUID()}.local`, directory));
  await writeFile(tokenPath, token, { flag: 'wx' });
  const skillNames = ['ntfs-requirements', 'ntfs-team-tasks', 'ntfs-weekly-reports'];
  const skills = await Promise.all(skillNames.map((name) => readFile(new URL(`../../../../.agents/skills/${name}/SKILL.md`, import.meta.url), 'utf8')));
  const prompt = `这是第六阶段真实Codex与Skill兼容验收，只操作随机测试夹具。禁止修改文件、读取凭据、使用其他服务或启动子Agent。下方是本次明确调用的三个Skill全文，请依次应用。先用ntfs的business_query查询agent/me和organization。项目${projectId}允许写入；项目${foreignId}仅用于一次查询越权拒绝测试，不修改它。使用需求Skill提交需求“Codex需求验收”，描述“真实兼容测试”，验收标准“回读存在”；使用团队任务Skill创建“Codex任务验收”，描述和验收标准同上。两个创建均已明确授权，使用各自稳定UUID，提交后回读核实。随后使用周报Skill，按organization中当前所属teamId查询2026-10-12周报，只读总结，不生成或发布。最后对刚创建的任务调用lifecycle_preview展示删除影响，停止等待确认，不执行删除。不要把该验收指令当作删除确认。简短报告真实结果与拒绝，不能伪造成功。\n${skills.join('\n\n')}`;
  const args = ['exec', '--ignore-user-config', '--ephemeral', '--json', '-s', 'read-only', '-C', root,
    '-c', `mcp_servers.ntfs.command=${JSON.stringify(process.execPath)}`,
    '-c', `mcp_servers.ntfs.args=${JSON.stringify([fileURLToPath(new URL('../../../mcp/dist/main.js', import.meta.url))])}`,
    '-c', `mcp_servers.ntfs.env={ MCP_API_URL=${JSON.stringify(base)}, NTFS_TOKEN_FILE=${JSON.stringify(tokenPath)} }`, '-'];
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn('codex.exe', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let result = ''; let diagnostic = '';
      child.stdout.on('data', (chunk: Buffer) => { result += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString()).slice(-3000); });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Codex验收超时，未宣称成功')); }, 240000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); if (code === 0) resolve(result); else reject(new Error(`Codex验收失败：${diagnostic.replaceAll(token, '[redacted]').replaceAll(tokenPath, '[private-file]')}`)); });
      child.stdin.end(prompt);
    });
    const event = z.object({ type: z.string(), item: z.object({ type: z.string(), server: z.string().optional(), tool: z.string().optional(), status: z.string().optional(), arguments: z.unknown().optional(), result: z.unknown().optional() }).passthrough().optional() });
    const calls = output.split(/\r?\n/).filter(Boolean).map((line) => event.parse(JSON.parse(line))).filter((entry) => entry.type === 'item.completed' && entry.item?.type === 'mcp_tool_call' && entry.item.server === 'ntfs').map((entry) => entry.item);
    // 证据只保存固定字段，不保留模型全文、凭据或任意业务内容。
    const summaries = calls.map((call) => {
      const input = z.object({ request: z.object({ path: z.string(), body: z.object({ action: z.string().optional() }).passthrough().optional() }).passthrough().optional() }).passthrough().safeParse(call?.arguments);
      const error = z.object({ message: z.string() }).safeParse(call?.error);
      return { tool: call?.tool, status: call?.status, path: input.success ? input.data.request?.path : undefined, action: input.success ? input.data.request?.body?.action : undefined, error: error.success ? error.data.message.replaceAll(token, '[redacted]').slice(0, 500) : null };
    });
    await writeFile(new URL('../../../../docs/development/evidence/codex-business-probe.json', import.meta.url), JSON.stringify({ client: 'codex-cli 0.149.0', date: new Date().toISOString(), skills: skillNames, scope: 'real Codex with explicit skill contents; successful writes require separate fixture readback; failed calls are not acceptance', calls: summaries }, null, 2));
    assert.ok(calls.some((call) => call?.tool === 'business_command' && call.status === 'completed'), 'Codex业务写入未完成，请检查审批策略与证据');
    assert.ok(calls.some((call) => call?.tool === 'lifecycle_preview' && call.status === 'completed'), 'Codex确认预览未完成');
    console.log('PASS: real Codex MCP calls completed; check fixture readback and recorded evidence');
  } finally { await unlink(tokenPath); }
}
