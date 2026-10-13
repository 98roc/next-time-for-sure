import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { healthSchema, readinessSchema } from '../packages/contracts/dist/index.js';
import { startNode, stopChild, waitForHttp } from './processes.mjs';

/** 使用空闲端口，探针只读已迁移数据库，不修改业务数据。 */
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

const apiPort = await freePort();
const webPort = await freePort();
const environment = { ...process.env, API_PORT: String(apiPort), WEB_PORT: String(webPort), MCP_API_URL: `http://127.0.0.1:${apiPort}` };
const children = [];
try {
  const api = startNode(['apps/api/dist/main.js'], { env: environment });
  children.push(api);
  const live = await waitForHttp(`${environment.MCP_API_URL}/api/v1/health/live`, api);
  healthSchema.parse(await live.json());
  const ready = await fetch(`${environment.MCP_API_URL}/api/v1/health/ready`);
  assert.equal(ready.status, 200);
  readinessSchema.parse(await ready.json());
  const docs = await fetch(`${environment.MCP_API_URL}/api/docs-json`);
  assert.equal(docs.status, 200);
  const web = startNode(['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1'], { cwd: 'apps/web', env: environment });
  children.push(web);
  const page = await waitForHttp(`http://127.0.0.1:${webPort}`, web);
  assert.match(await page.text(), /<title>下次一定/);
  const proxied = await fetch(`http://127.0.0.1:${webPort}/api/v1/health/ready`);
  readinessSchema.parse(await proxied.json());
  const mcp = startNode(['apps/mcp/dist/probe-client.js'], { env: environment });
  children.push(mcp);
  const [code] = await once(mcp, 'exit');
  assert.equal(code, 0);
  console.log('PASS: API, MySQL readiness, OpenAPI, web proxy and MCP stdio. Browser and Codex checks are separate.');
} finally {
  await Promise.all(children.map(stopChild));
}
