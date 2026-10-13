import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from './server.js';

test('rejects credentials, external hosts and non-origin URLs', () => {
  for (const url of ['http://user:secret@127.0.0.1:3100', 'https://example.com', 'http://127.0.0.1:3100/api', 'file:///secret', 'http://127.0.0.1:3100?token=secret']) {
    assert.throws(() => createServer(url));
  }
  assert.throws(() => createServer('invalid-secret-url'), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, /invalid-secret-url/);
    return true;
  });
});
