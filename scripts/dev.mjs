import { loadEnvFile } from 'node:process';
import { once } from 'node:events';
import { startNode, stopChild, waitForHttp } from './processes.mjs';

loadEnvFile('.env.local');
const children = [];
let stopping = false;

/** 退出整组开发服务，防止终端关闭后遗留编译器和HTTP监听。 */
async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  await Promise.all(children.map(stopChild));
  process.exitCode = code;
}

process.on('SIGINT', () => { void shutdown(0); });
process.on('SIGTERM', () => { void shutdown(0); });

try {
  const api = startNode(['--watch', 'apps/api/dist/main.js']);
  children.push(api);
  await waitForHttp(`http://127.0.0.1:${process.env.API_PORT ?? '3100'}/api/v1/health/live`, api);
  const compiler = startNode(['node_modules/typescript/bin/tsc', '-p', 'apps/api/tsconfig.json', '--watch', '--preserveWatchOutput']);
  const web = startNode(['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { cwd: 'apps/web' });
  children.push(compiler, web);
  for (const child of children) child.once('error', () => { void shutdown(1); });
  console.log('Development services started. Press Ctrl+C to stop this process group.');
  await Promise.race(children.map((child) => once(child, 'exit')));
  if (!stopping) await shutdown(1);
} catch {
  console.error('Development startup failed; check local configuration and port availability.');
  await shutdown(1);
}
