import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changePasswordSchema, loginSchema, organizationCommandSchema, passwordSchema } from '@ntfs/contracts';
import { generateTemporaryPassword, hashPassword, verifyPassword } from './password.js';

test('new password policy covers length boundaries and each required character class', () => {
  for (const value of ['Abcdefg1', 'Aa1' + '!'.repeat(125), 'With-symbols-123']) assert.ok(passwordSchema.safeParse(value).success);
  for (const value of ['Abcdef1', 'abcdefgh1', 'ABCDEFGH1', 'Abcdefgh', '12345678', 'Aa1' + '!'.repeat(126)]) assert.equal(passwordSchema.safeParse(value).success, false);
  assert.ok(loginSchema.safeParse({ loginName: 'legacy', password: 'legacy-password' }).success);
  assert.ok(changePasswordSchema.safeParse({ currentPassword: 'legacy-password', newPassword: 'Abcdefg1' }).success);
  for (const action of ['create_account', 'create_member', 'reset_password']) {
    const fields = action === 'reset_password' ? { accountId: '00000000-0000-4000-8000-000000000001', version: 1 } : { loginName: 'member', displayName: '成员', ...(action === 'create_member' ? { teamId: '00000000-0000-4000-8000-000000000001' } : {}) };
    assert.ok(organizationCommandSchema.safeParse({ action, ...fields, password: 'Abcdefg1' }).success);
    assert.equal(organizationCommandSchema.safeParse({ action, ...fields, password: 'abcdefgh1' }).success, false);
  }
  for (let index = 0; index < 20; index++) assert.ok(passwordSchema.safeParse(generateTemporaryPassword()).success);
});

test('password hashes use independent salts and reject wrong passwords and damaged hashes', async () => {
  const password = 'Test-only-long-password';
  const first = await hashPassword(password);
  assert.notEqual(first, await hashPassword(password));
  assert.ok(await verifyPassword(password, first));
  assert.equal(await verifyPassword('wrong', first), false);
  assert.equal(await verifyPassword(password, 'broken'), false);
  assert.ok(!first.includes(password));
});
