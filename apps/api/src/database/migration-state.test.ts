import assert from 'node:assert/strict';
import test from 'node:test';
import { migrationsCurrent } from './migration-state.js';

test('V2 切换后新增迁移不因切换记录处于中间而被误判未就绪', () => {
  const required = ['foundation', 'sorting', 'project-created-at'];
  assert.equal(migrationsCurrent(['foundation', 'V2RetireLegacy1792281600000', 'sorting', 'project-created-at'], required, true), true);
  assert.equal(migrationsCurrent([...required, 'V2RetireLegacy1792281600000'], required, true), true);
  assert.equal(migrationsCurrent(required, required, false), true);
  assert.equal(migrationsCurrent(required, required, true), false);
  assert.equal(migrationsCurrent(['foundation', 'V2RetireLegacy1792281600000', 'sorting', 'sorting'], required, true), false);
  assert.equal(migrationsCurrent([...required, 'unknown'], required, true), false);
});
