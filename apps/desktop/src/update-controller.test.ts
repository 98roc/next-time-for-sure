import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UpdateController, type UpdateDriver } from './update-controller.js';

/** 模拟用户确认及组件边界，检查没有用户授权时绝不安装。 */
function harness(driver?: UpdateDriver, answers: boolean[] = []) {
  const messages: string[] = [];
  const statuses: string[] = [];
  const controller = new UpdateController(driver, {
    confirm: async (message) => { messages.push(message); return answers.shift() ?? false; },
    inform: async (message) => { messages.push(message); },
    status: (message) => { statuses.push(message); },
  }, '未配置更新地址');
  return { controller, messages, statuses };
}

test('未配置不联网；启动无更新保持安静，手动检查有反馈', async () => {
  const disabled = harness();
  await disabled.controller.check(false);
  assert.equal(disabled.messages.length, 0);
  await disabled.controller.check(true);
  assert.deepEqual(disabled.messages, ['未配置更新地址']);
  const current = harness({ check: async () => undefined, download: async () => assert.fail(), install: () => assert.fail() });
  await current.controller.check(false);
  assert.equal(current.messages.length, 0);
  await current.controller.check(true);
  assert.match(current.messages[0] ?? '', /最新版本/);
});

test('拒绝下载不下载；稍后安装保留下载，下次操作只需确认安装', async () => {
  let checks = 0; let downloads = 0; let installs = 0;
  const fixture = harness({ check: async () => { checks++; return '0.3.0'; }, download: async () => { downloads++; }, install: () => { installs++; } }, [false, true, false, true]);
  await fixture.controller.check(true);
  assert.equal(downloads, 0);
  await fixture.controller.check(true);
  assert.equal(downloads, 1);
  assert.equal(installs, 0);
  await fixture.controller.check(true);
  assert.equal(checks, 2);
  assert.equal(downloads, 1);
  assert.equal(installs, 1);
});

test('重复检查不会重复下载或出现并发确认框', async () => {
  let finish: (version: string) => void = () => assert.fail();
  let checks = 0;
  const fixture = harness({ check: () => { checks++; return new Promise<string>((resolve) => { finish = resolve; }); }, download: async () => assert.fail(), install: () => assert.fail() });
  const pending = fixture.controller.check(false);
  assert.equal(fixture.controller.isBusy, true);
  await fixture.controller.check(true);
  assert.equal(checks, 1);
  finish('0.3.0');
  await pending;
  assert.equal(fixture.controller.isBusy, false);
});

test('网络或校验失败不安装，可以重新检查并下载', async () => {
  let downloads = 0; let installs = 0;
  const fixture = harness({ check: async () => '0.3.0', download: async () => { if (++downloads === 1) throw new Error('checksum mismatch'); }, install: () => { installs++; } }, [true, true, true]);
  await fixture.controller.check(true);
  assert.equal(installs, 0);
  assert.equal(fixture.controller.isBusy, false);
  assert.match(fixture.messages.at(-1) ?? '', /更新失败/);
  await fixture.controller.check(true);
  assert.equal(installs, 1);
});
