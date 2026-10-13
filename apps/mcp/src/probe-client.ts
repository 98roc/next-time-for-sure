import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { healthSchema, readinessSchema } from '@ntfs/contracts';

/** 协议级冒烟客户端；只能证明MCP传输，不替代真实Codex验收。 */
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('./main.js', import.meta.url))],
  env: { MCP_API_URL: process.env.MCP_API_URL ?? 'http://127.0.0.1:3100' },
  stderr: 'inherit',
});
const client = new Client({ name: 'foundation-smoke', version: '0.1.0' });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), ['system_health']);
  const result = await client.callTool({ name: 'system_health', arguments: {} });
  assert.notEqual(result.isError, true);
  const content = z.array(z.object({ type: z.literal('text'), text: z.string() })).parse(result.content);
  assert.ok(content[0]);
  const payload: unknown = JSON.parse(content[0].text);
  z.object({ live: healthSchema, ready: readinessSchema }).parse(payload);
  console.log('PASS: MCP initialize, tools/list and system_health with validated response');
} finally {
  await client.close();
}
