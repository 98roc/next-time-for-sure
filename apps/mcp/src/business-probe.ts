import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { workSnapshotSchema, lifecyclePreviewSchema, personalSnapshotSchema, personalTeamWorkSchema } from '@ntfs/contracts';
import { z } from 'zod';

/** 使用真实API夹具启动stdio进程，不把协议通过误报为Codex兼容验收。 */
const environment = z.object({ MCP_API_URL: z.string().url(), NTFS_ACCESS_TOKEN: z.string(), NTFS_TEST_PROJECT: z.string().uuid(), NTFS_TEST_FOREIGN_PROJECT: z.string().uuid() }).parse(process.env);
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./main.js', import.meta.url))], env: environment, stderr: 'inherit' });
const client = new Client({ name: 'business-protocol-smoke', version: '0.1.0' });
const text = z.array(z.object({ type: z.literal('text'), text: z.string() }));
/** 检查协议结果后解析业务JSON，不输出凭据或完整业务响应。 */
async function call(name: string, args: Record<string, unknown>, error = false): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError === true, error);
  const first = text.parse(result.content)[0]; assert.ok(first);
  return JSON.parse(first.text);
}
try {
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), ['business_command', 'business_query', 'lifecycle_preview', 'system_health']);
  await call('business_query', { request: { path: 'agent/me', query: {} } });
  const refused = await call('business_query', { request: { path: 'work', query: { projectId: environment.NTFS_TEST_FOREIGN_PROJECT } } }, true);
  assert.equal(z.object({ status: z.number() }).parse(refused).status, 403);
  const body = { action: 'create_task', projectId: environment.NTFS_TEST_PROJECT, title: 'MCP协议验收任务', description: '', acceptance: '', operationId: randomUUID() };
  await call('business_command', { request: { path: 'work/commands', body } });
  await call('business_command', { request: { path: 'work/commands', body } });
  const snapshot = workSnapshotSchema.parse(await call('business_query', { request: { path: 'work', query: { projectId: body.projectId } } }));
  const tasks = snapshot.tasks.filter((entry) => entry.title === body.title); assert.equal(tasks.length, 1);
  const task = tasks[0]; assert.ok(task);
  const intent = { action: 'delete_task', objectId: task.id };
  const preview = lifecyclePreviewSchema.parse(await call('lifecycle_preview', { intent }));
  assert.equal(preview.blockers.length, 0);
  const stale = await call('business_command', { request: { path: 'lifecycle/commands', body: { intent, confirmation: '0'.repeat(64), reason: '验收拒绝过期确认', operationId: randomUUID() } } }, true);
  assert.equal(z.object({ status: z.number() }).parse(stale).status, 409);
  // 测试夹具已授权删除自己创建的任务；真实Agent需先在对话取得用户确认。
  await call('business_command', { request: { path: 'lifecycle/commands', body: { intent, confirmation: preview.confirmation, reason: '验收清理', operationId: randomUUID() } } });
  const remaining = workSnapshotSchema.parse(await call('business_query', { request: { path: 'work', query: { projectId: body.projectId } } }));
  assert.equal(remaining.tasks.some((entry) => entry.id === task.id), false);
  // 新个人工作流沿用同一个MCP命令契约，不经过网页也必须执行相同联动。
  const personalTask = z.object({ objectId: z.string() }).parse(await call('business_command', { request: { path: 'work/commands', body: { ...body, title: 'MCP个人联动验收', operationId: randomUUID() } } }));
  const claimed = z.object({ objectId: z.string() }).parse(await call('business_command', { request: { path: 'assignments/commands', body: { action: 'claim', taskId: personalTask.objectId, groupId: null, content: '', operationId: randomUUID() } } }));
  const catalog = personalTeamWorkSchema.parse(await call('business_query', { request: { path: 'personal/team-work', query: {} } }));
  assert.ok(catalog.tasks.some((entry) => entry.id === personalTask.objectId));
  const imported = z.object({ objectId: z.string() }).parse(await call('business_command', { request: { path: 'personal/commands', body: { action: 'import_assignment', assignmentId: claimed.objectId, categoryId: null, split: false, operationId: randomUUID() } } }));
  const personal = personalSnapshotSchema.parse(await call('business_query', { request: { path: 'personal', query: { scope: 'mine' } } }));
  const item = personal.items.find((entry) => entry.id === imported.objectId); assert.ok(item);
  await call('business_command', { request: { path: 'personal/commands', body: { action: 'complete_personal', itemId: item.id, version: item.version } } });
  const completed = personalTeamWorkSchema.parse(await call('business_query', { request: { path: 'personal/team-work', query: {} } }));
  assert.equal(completed.assignments.find((entry) => entry.id === claimed.objectId)?.status, 'completed');
  assert.equal(completed.tasks.find((entry) => entry.id === personalTask.objectId)?.status, 'not_started');
  console.log('PASS: MCP team catalog, import and personal completion automatically finish only the own assignment');
  console.log('PASS: authenticated MCP stdio list/query/write, permissions, idempotency and confirmation rejection/execution');
} finally { await client.close(); }
