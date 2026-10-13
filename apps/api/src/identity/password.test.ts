import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from './password.js';

test('password hashes use independent salts and reject wrong passwords and damaged hashes', async () => {
  const password = 'Test-only-long-password';
  const first = await hashPassword(password);
  assert.notEqual(first, await hashPassword(password));
  assert.ok(await verifyPassword(password, first));
  assert.equal(await verifyPassword('wrong', first), false);
  assert.equal(await verifyPassword(password, 'broken'), false);
  assert.ok(!first.includes(password));
});
