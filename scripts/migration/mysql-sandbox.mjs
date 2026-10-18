import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { pipeline } from 'node:stream/promises';

const requireApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { createConnection } = requireApi('mysql2/promise');

/** 固定程序参数数组，不经过 shell；失败仅报告程序与退出码，不打印凭据或业务 SQL。 */
export async function run(binary, args, { input, output, env = process.env, timeout = 120000 } = {}) {
  const child = spawn(binary, args, { env, windowsHide: true, stdio: [input ? 'pipe' : 'ignore', output ? 'pipe' : 'ignore', 'ignore'] });
  const completed = new Promise((accept, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('CHILD_TIMEOUT')); }, timeout);
    child.once('error', () => { clearTimeout(timer); reject(new Error('CHILD_START_FAILED')); });
    child.once('exit', (code) => { clearTimeout(timer); if (code === 0) accept(); else reject(new Error(`CHILD_EXIT_${code}`)); });
  });
  await Promise.all([completed, ...(input ? [pipeline(createReadStream(input), child.stdin)] : []), ...(output ? [pipeline(child.stdout, createWriteStream(output, { flags: 'wx', mode: 0o600 }))] : [])]);
}

/** MySQL 密码只进入短命本地文件；不进入命令行、终端或 Git。 */
export async function withClientConfig(directory, connection, action) {
  const path = join(directory, `client-${randomBytes(8).toString('hex')}.cnf`);
  const quote = (value) => `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\r', '\\r')}"`;
  await writeFile(path, `[client]\nhost=${quote(connection.host)}\nport=${connection.port}\nuser=${quote(connection.user)}\npassword=${quote(connection.password)}\nprotocol=TCP\ndefault-character-set=utf8mb4\n`, { flag: 'wx', mode: 0o600 });
  try { return await action(path); } finally { await rm(path); }
}

/** 仅删除本次 mkdtemp 创建且仍位于缓存目录的资源，不接收外部删除路径。 */
async function cleanup(cache, directory) {
  const actual = await realpath(directory), within = relative(await realpath(cache), actual);
  if (isAbsolute(within) || within.startsWith('..') || !within.startsWith('mysql-rehearsal-')) throw new Error('SANDBOX_CLEANUP_PATH_REJECTED');
  await rm(actual, { recursive: true, maxRetries: 8, retryDelay: 500 });
}

/** 启动独立 MySQL 5.7 数据目录与随机回环端口；回调结束后停库并清理自己创建的实例。 */
export async function withMysqlSandbox(root, mysqlBin, verify) {
  const cache = resolve(root, '.cache'); await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, 'mysql-rehearsal-'));
  let server, database, owned = false;
  try {
    const data = join(directory, 'data'); await mkdir(data);
    await run(join(mysqlBin, 'mysqld.exe'), ['--no-defaults', '--initialize-insecure', `--basedir=${resolve(mysqlBin, '..')}`, `--datadir=${data}`]);
    const port = await new Promise((accept, reject) => {
      const reservation = createServer(); reservation.once('error', reject); reservation.listen(0, '127.0.0.1', () => {
        const address = reservation.address(); if (!address || typeof address === 'string') { reservation.close(); reject(new Error('NO_PORT')); return; }
        reservation.close(() => accept(address.port));
      });
    });
    const configPath = join(directory, 'server.cnf');
    await writeFile(configPath, `[mysqld]\nbasedir=${resolve(mysqlBin, '..').replaceAll('\\', '/')}\ndatadir=${data.replaceAll('\\', '/')}\nport=${port}\nbind-address=127.0.0.1\ncharacter-set-server=utf8mb4\ncollation-server=utf8mb4_unicode_ci\nmax_connections=30\ninnodb_buffer_pool_size=64M\n`, { flag: 'wx' });
    server = spawn(join(mysqlBin, 'mysqld.exe'), [`--defaults-file=${configPath}`, '--console'], { windowsHide: true, stdio: 'ignore' });
    let startError = false; server.once('error', () => { startError = true; });
    const options = { host: '127.0.0.1', port, user: 'root', password: '', connectTimeout: 1000, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true };
    for (let attempt = 0; attempt < 80; attempt++) {
      if (startError || server.exitCode !== null) throw new Error('SANDBOX_START_FAILED');
      try { database = await createConnection(options); break; } catch { await delay(250); }
    }
    if (!database) throw new Error('SANDBOX_NOT_READY');
    const [[identity]] = await database.query('SELECT VERSION() version,@@port port,@@datadir datadir');
    if (!identity.version.startsWith('5.7.') || Number(identity.port) !== port || (await realpath(identity.datadir)) !== (await realpath(data))) throw new Error('SANDBOX_IDENTITY_REJECTED');
    owned = true;
    const password = randomBytes(32).toString('hex');
    await database.query("ALTER USER 'root'@'localhost' IDENTIFIED BY ?", [password]); options.password = password;
    await verify({ connection: database, options, directory, mysqlBin });
  } finally {
    if (database) { if (owned) { try { await database.query('SHUTDOWN'); } catch { /* 已退出时连接可能先断开。 */ } } await database.end().catch(() => {}); }
    if (server && server.exitCode === null) await Promise.race([new Promise((accept) => server.once('exit', accept)), delay(10000)]);
    if (server && server.exitCode === null) { server.kill(); await new Promise((accept) => server.once('exit', accept)); }
    await cleanup(cache, directory);
  }
}

/** 规范化整库内容并按表计算摘要；只输出摘要，不输出身份凭据和业务正文。 */
export async function manifest(connection) {
  const [tables] = await connection.query("SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");
  const { createHash } = await import('node:crypto');
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  const result = [];
  for (const { name } of tables) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('UNEXPECTED_TABLE');
    const [rows] = await connection.query(`SELECT * FROM \`${name}\``);
    const [schema] = await connection.query(`SHOW CREATE TABLE \`${name}\``);
    result.push({ table: name, rows: rows.length, dataHash: createHash('sha256').update(JSON.stringify(rows.map((row) => JSON.stringify(canonical(row))).sort())).digest('hex'), schemaHash: createHash('sha256').update(schema[0]['Create Table']).digest('hex') });
  }
  return result;
}
