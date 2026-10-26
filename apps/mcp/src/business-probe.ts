import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { identitySchema, v2WorkspaceSchema, v2ImpactSchema, v2SubtasksSchema, v2DailyReportSchema } from '@ntfs/contracts';
import { z } from 'zod';

/** 真实 stdio MCP 客户端调用 V2 API；协议证据不等同于真实外部模型客户端。 */
const environment = z.object({ MCP_API_URL: z.string().url(), NTFS_ACCESS_TOKEN: z.string(), NTFS_TEST_PROJECT: z.string().uuid(), NTFS_TEST_FOREIGN_PROJECT: z.string().uuid() }).parse(process.env);
const client = new Client({ name: 'v2-protocol-smoke', version: '2.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./main.js', import.meta.url))], env: environment, stderr: 'inherit' });

/** 解析结构化协议结果，错误只比对状态，不输出凭据或完整业务响应。 */
async function call(name: string, args: Record<string, unknown>, error = false): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args }); assert.equal(result.isError === true, error);
  const first = z.array(z.object({ type: z.literal('text'), text: z.string() })).parse(result.content)[0]; assert.ok(first); return JSON.parse(first.text);
}
try {
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), ['business_command', 'business_preview', 'business_query', 'system_health']);
  const identity = identitySchema.parse(await call('business_query', { request: { path: 'agent/me', query: {} } }));
  const workspace = async () => v2WorkspaceSchema.parse(await call('business_query', { request: { path: 'v2/workspace', query: {} } }));
  const initial = await workspace(); assert.equal(initial.projects.some((row) => row.id === environment.NTFS_TEST_FOREIGN_PROJECT), false);
  const period = initial.periods.find((row) => row.startOn <= initial.today && row.endOn >= initial.today); assert.ok(period);
  const body = { action: 'create_project', operationId: randomUUID(), task: { projectId: environment.NTFS_TEST_PROJECT, title: 'MCP V2真实任务', executorId: identity.id, periodId: period.id, priority: 3, plannedDays: 1, milestoneId: null } };
  await call('business_command', { request: { path: 'v2/tasks', body } }); await call('business_command', { request: { path: 'v2/tasks', body } });
  const tasks = (await workspace()).tasks.filter((row) => row.title === body.task.title); assert.equal(tasks.length, 1); let task = tasks[0]; assert.ok(task);
  // MCP 只访问 Token 所属人的私人清单与日报，同样使用版本及完整保存契约。
  const child = { id: randomUUID(), title: 'MCP 私人步骤', completed: true };
  const subtaskCommand = { action: 'save_subtasks', operationId: randomUUID(), taskId: task.id, version: 0, items: [child], removedIds: [] };
  await call('business_command', { request: { path: 'v2/subtasks', body: subtaskCommand } });
  await call('business_command', { request: { path: 'v2/subtasks', body: subtaskCommand } });
  const subtasks = v2SubtasksSchema.parse(await call('business_query', { request: { path: 'v2/subtasks', query: { taskId: task.id } } })); assert.equal(subtasks.version, 1); assert.equal(subtasks.items[0]?.title, child.title);
  assert.equal((await workspace()).tasks.find(row => row.id === task?.id)?.status, 'not_started');
  const daily = v2DailyReportSchema.parse(await call('business_query', { request: { path: 'v2/daily', query: { on: initial.today } } })); assert.match(daily.generatedText, /（1）MCP 私人步骤/u);
  await call('business_command', { request: { path: 'v2/daily', body: { action: 'save_daily', operationId: randomUUID(), on: initial.today, version: daily.text.version, sourceHash: daily.currentSourceHash, body: 'MCP 私人日报草稿' } } });
  await call('business_command', { request: { path: 'v2/personal-settings', body: { action: 'set_completed_mode', operationId: randomUUID(), version: initial.personalPreferences.version, mode: 'period' } } });
  assert.equal((await workspace()).personalPreferences.completedMode, 'period');
  const denied = await call('business_command', { request: { path: 'v2/tasks', body: { ...body, operationId: randomUUID(), task: { ...body.task, projectId: environment.NTFS_TEST_FOREIGN_PROJECT } } } }, true);
  assert.equal(z.object({ status: z.number() }).parse(denied).status, 403);
  // Agent 同样必须填写实际投入，估算不能替代完成结果；普通执行人可维护已有周期预计。
  const missingResult = await call('business_command', { request: { path: 'v2/tasks', body: { action: 'set_status', operationId: randomUUID(), taskId: task.id, version: task.version, status: 'completed' } } }, true);
  assert.equal(z.object({ status: z.number() }).parse(missingResult).status, 409);
  const completedAt = new Date().toISOString(), startedAt = new Date(Date.parse(task.createdAt) - 3_600_000).toISOString();
  await call('business_command', { request: { path: 'v2/edit', body: { action: 'save_task', operationId: randomUUID(), taskId: task.id, version: task.version, arrangements: [{ periodId: period.id, plannedDays: 1.25, workNote: 'MCP本期验收' }], status: 'completed', completion: { actualDays: 0, aiContribution: null, startedAt, completedAt } } } });
  let updated = await workspace(); task = updated.tasks.find((row) => row.id === task?.id); assert.ok(task);
  assert.equal(task.actualDays, 0); assert.equal(task.aiContribution, 'high');
  assert.equal(updated.arrangements.find((row) => row.taskId === task?.id)?.plannedDays, 1.25);
  assert.equal(updated.arrangements.find((row) => row.taskId === task?.id)?.workNote, 'MCP本期验收');
  assert.equal(task.completedAt, completedAt); assert.equal(task.startedAt, startedAt);
  await call('business_command', { request: { path: 'v2/tasks', body: { action: 'set_status', operationId: randomUUID(), taskId: task.id, version: task.version, status: 'not_started' } } });
  updated = await workspace(); task = updated.tasks.find((row) => row.id === task?.id); assert.ok(task);
  assert.equal(task.actualDays, 0); assert.equal(task.aiContribution, 'high');
  const intent = { action: 'delete_task', taskId: task.id, version: task.version };
  const preview = v2ImpactSchema.parse(await call('business_preview', { request: { path: 'v2/impact', body: intent } })); assert.equal(preview.blockers.length, 0);
  const command = { action: 'delete', taskId: task.id, version: task.version };
  const stale = await call('business_command', { request: { path: 'v2/tasks', body: { ...command, operationId: randomUUID(), confirmation: '0'.repeat(64) } } }, true);
  assert.equal(z.object({ status: z.number() }).parse(stale).status, 409);
  // 此处仅清理本脚本创建的随机夹具；正式 Agent 必须先取得具体影响确认。
  await call('business_command', { request: { path: 'v2/tasks', body: { ...command, operationId: randomUUID(), confirmation: preview.confirmation } } });
  assert.equal((await workspace()).tasks.some((row) => row.id === task.id), false);
  console.log('PASS: authenticated V2 MCP list/query/write, private subtasks/daily/preferences, effort and completion, idempotence, scope rejection, preview and version-bound confirmation.');
} finally { await client.close(); }
