import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { z } from 'zod';

const { build } = createRequire(import.meta.resolve('vite'))('esbuild');
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/identity/operation-id.ts', import.meta.url))], bundle: true, write: false, format: 'iife', globalName: 'operationIds', platform: 'browser', logLevel: 'silent' });

function load(crypto) {
  return runInNewContext(`${bundled.outputFiles[0].text}\noperationIds.createOperationId`, { crypto });
}

test('HTTP 缺少 randomUUID 时仍生成后端接受的 UUID v4', () => {
  const create = load({ getRandomValues: (bytes) => webcrypto.getRandomValues(bytes) });
  const values = new Set(Array.from({ length: 1000 }, () => create()));
  assert.equal(values.size, 1000);
  for (const value of values) {
    assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(z.string().uuid().safeParse(value).success, true);
  }
});

test('HTTPS 支持原生 UUID 时保留 Crypto 接收者', () => {
  const crypto = { randomUUID() { assert.equal(this, crypto); return '12345678-1234-4234-8234-123456789abc'; } };
  assert.equal(load(crypto)(), '12345678-1234-4234-8234-123456789abc');
});

test('没有安全随机数能力时明确报错，不生成不可靠幂等键', () => {
  assert.throws(() => load(undefined)(), /当前浏览器不支持安全随机数/);
});
