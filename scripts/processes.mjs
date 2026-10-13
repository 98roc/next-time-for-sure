import { spawn } from 'node:child_process';
import { once } from 'node:events';

/** 启动项目Node子进程，隐藏Windows控制台，保留进程句柄供退出时回收。 */
export function startNode(args, options = {}) {
  return spawn(process.execPath, args, { windowsHide: true, stdio: 'inherit', ...options });
}

/** 只终止本脚本创建且仍运行的进程；不按进程名或端口清理其他服务。 */
export async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await once(killer, 'exit');
  } else {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
}

/** HTTP轮询有总超时，不用固定长等待假定服务已经启动。 */
export async function waitForHttp(url, child, milliseconds = 20000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Service exited before becoming available');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response;
    } catch { /* 进程启动期间暂时拒绝连接，继续在总时限内重试。 */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Service did not become ready: ${url}`);
}
