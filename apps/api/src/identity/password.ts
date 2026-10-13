import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const cost = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** 异步scrypt避免阻塞事件循环，参数固定且派生值按账号随机加盐。 */
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, cost, (error, key) => error ? reject(error) : resolve(key)));
}

/** 密码永不原样持久化；派生格式包含算法及参数版本。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `scrypt-v1$${salt}$${(await derive(password, salt)).toString('hex')}`;
}

/** 固定时间比较；损坏或不支持的派生值直接拒绝。 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [version, salt, hash] = stored.split('$');
  if (version !== 'scrypt-v1' || !salt || !hash || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash)) return false;
  return timingSafeEqual(await derive(password, salt), Buffer.from(hash, 'hex'));
}

/** 随机会话凭据只写HttpOnly Cookie，数据库使用SHA256摘要定位。 */
export function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
