import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { readFile } from 'node:fs/promises';

let token = process.env.NTFS_ACCESS_TOKEN;
if (process.env.NTFS_TOKEN_FILE) {
  if (token) throw new Error('Configure only one personal token source');
  try { token = (await readFile(process.env.NTFS_TOKEN_FILE, 'utf8')).trim(); } catch { throw new Error('Cannot read personal token configuration file'); }
}
const server = createServer(process.env.MCP_API_URL ?? 'http://127.0.0.1:3100', token);
// stdout保留给MCP协议，不输出启动横幅或凭据。
await server.connect(new StdioServerTransport());
