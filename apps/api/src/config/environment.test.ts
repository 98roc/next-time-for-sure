import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnvironment } from './environment.js';

const valid = { DB_HOST: '127.0.0.1', DB_USERNAME: 'test', DB_PASSWORD: 'secret-test-value', DB_DATABASE: 'next_time_for_sure' };

test('rejects other project databases and never discloses supplied credentials', () => {
  assert.throws(() => parseEnvironment({ ...valid, DB_DATABASE: 'other_project' }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /DB_DATABASE/);
    assert.doesNotMatch(error.message, /secret-test-value|other_project/);
    return true;
  });
});

test('rejects invalid ports and arbitrary bind addresses', () => {
  assert.throws(() => parseEnvironment({ ...valid, DB_PORT: '3306extra' }));
  assert.throws(() => parseEnvironment({ ...valid, API_PORT: '0' }));
  assert.throws(() => parseEnvironment({ ...valid, API_HOST: '192.168.1.1' }));
  assert.equal(parseEnvironment(valid).DB_PORT, 3306);
});

test('keeps loopback by default and supports explicit container binding', () => {
  assert.equal(parseEnvironment(valid).API_HOST, '127.0.0.1');
  assert.equal(parseEnvironment({ ...valid, API_HOST: '0.0.0.0' }).API_HOST, '0.0.0.0');
});
