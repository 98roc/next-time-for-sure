import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '../config/environment.js';
import { createDataSource } from '../database/data-source.js';
import { hashPassword } from './password.js';
import { z } from 'zod';
import { IdentityRepository } from './identity.repository.js';

/** 仅在无账号时初始化超管，随机临时密码写入忽略的本地文件，不输出终端。 */
async function bootstrap(): Promise<void> {
  const source = createDataSource(loadEnvironment());
  const path = fileURLToPath(new URL('../../../../.bootstrap-credentials.local', import.meta.url));
  let wroteFile = false;
  try {
    await source.initialize();
    await source.transaction(async (manager) => {
      // 锁住持久化的基线行，串行化并发初始化，禁止创建第二个初始超管。
      await manager.query("SELECT metadata_key FROM platform_metadata WHERE metadata_key = 'schema_baseline' FOR UPDATE");
      const rows: unknown = await manager.query('SELECT COUNT(*) AS count FROM accounts');
      if (z.array(z.object({ count: z.coerce.number() })).parse(rows)[0]?.count !== 0) throw new Error('Already initialized');
      const password = randomBytes(24).toString('base64url');
      await writeFile(path, `loginName=admin\npassword=${password}\n首次登录后请立即修改密码，并删除此文件。\n`, { flag: 'wx', mode: 0o600 });
      wroteFile = true;
      const id = randomUUID();
      await manager.query('INSERT INTO accounts (id, login_name, display_name, password_hash, is_super_admin, created_at, updated_at) VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))', [id, 'admin', '系统管理员', await hashPassword(password)]);
      await new IdentityRepository(manager).audit(id, 'account.bootstrap');
    });
    console.log(`Administrator initialized. Read ${join('.bootstrap-credentials.local')} locally; password is not logged.`);
  } catch {
    if (wroteFile) await unlink(path);
    console.error('Initialization refused or failed. Check migrations, existing accounts and existing credential file. No existing account was overwritten.');
    process.exitCode = 1;
  } finally {
    if (source.isInitialized) await source.destroy();
  }
}

await bootstrap();
