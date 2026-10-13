import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { healthSchema, readinessSchema } from '@ntfs/contracts';

/** 工程探针仅连接本机；未来业务工具必须使用独立认证与权限校验。 */
export function createServer(baseUrl: string): McpServer {
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error('MCP_API_URL must be a valid loopback HTTP origin'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('MCP_API_URL must be a loopback HTTP origin');
  }
  const server = new McpServer({ name: 'next-time-for-sure', version: '0.1.0' });
  server.registerTool('system_health', {
    title: '检查下次一定工程状态',
    description: '仅查询公开的本机服务及数据库就绪状态；不访问业务数据，不验证用户身份，不代表业务已交付。',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => {
    try {
      const [liveResponse, readyResponse] = await Promise.all([
        fetch(new URL('/api/v1/health/live', url), { signal: AbortSignal.timeout(5000), redirect: 'error' }),
        fetch(new URL('/api/v1/health/ready', url), { signal: AbortSignal.timeout(5000), redirect: 'error' }),
      ]);
      if (!liveResponse.ok || !readyResponse.ok) throw new Error('Probe failed');
      const result = { live: healthSchema.parse(await liveResponse.json()), ready: readinessSchema.parse(await readyResponse.json()) };
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch {
      return { isError: true, content: [{ type: 'text', text: '工程状态检查失败，请检查本机API、数据库及迁移。此结果不表示业务操作成功。' }] };
    }
  });
  return server;
}
