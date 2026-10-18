import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from './server.js';
import { agentQuerySchema, agentCommandSchema, agentPreviewSchema } from '@ntfs/contracts';

test('V2 whitelist rejects legacy business routes, token management and unexpected input', () => {
  for (const path of ['tokens', 'work/requests', 'assignments', 'personal/items', 'weekly-plans', 'reports', 'lifecycle/impact', 'notifications']) {
    assert.equal(agentQuerySchema.safeParse({ path, query: {} }).success, false);
    assert.equal(agentCommandSchema.safeParse({ path, body: {} }).success, false);
    assert.equal(agentPreviewSchema.safeParse({ path, body: {} }).success, false);
  }
  assert.equal(agentQuerySchema.safeParse({ path: 'v2/workspace', query: {} }).success, true);
  assert.equal(agentQuerySchema.safeParse({ path: 'v2/workspace', query: { accountId: 'spoofed' } }).success, false);
  assert.equal(agentQuerySchema.safeParse({ path: 'v2/workspace', query: {}, url: 'https://example.com' }).success, false);
});

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
