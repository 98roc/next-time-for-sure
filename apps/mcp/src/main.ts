import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const server = createServer(process.env.MCP_API_URL ?? 'http://127.0.0.1:3100');
// stdout保留给MCP协议，不输出启动横幅或凭据。
await server.connect(new StdioServerTransport());
