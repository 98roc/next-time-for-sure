import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const { build } = createRequire(import.meta.resolve('vite'))('esbuild');
const result = await build({ entryPoints: [fileURLToPath(new URL('../src/v2/greeting.ts', import.meta.url))], bundle: true, write: false, format: 'iife', globalName: 'welcome', platform: 'browser', logLevel: 'silent' });
const { timeGreeting, pickTeamMessage } = runInNewContext(`${result.outputFiles[0].text}\nwelcome`);

test('北京时间问候覆盖全部边界，尤其是 09:30 和 22:00', () => {
  for (const [time, expected] of [['00:00', '夜深了'], ['05:59', '夜深了'], ['06:00', '早上好'], ['09:29', '早上好'], ['09:30', '上午好'], ['11:59', '上午好'], ['12:00', '中午好'], ['13:59', '中午好'], ['14:00', '下午好'], ['17:59', '下午好'], ['18:00', '晚上好'], ['21:59', '晚上好'], ['22:00', '夜深了'], ['23:59', '夜深了']]) {
    assert.equal(timeGreeting(new Date(`2026-10-19T${time}:00+08:00`)), expected, time);
  }
  assert.equal(timeGreeting(new Date('2026-10-19T01:30:00Z')), '上午好');
});

test('随机只返回已配置内容，空配置不补默认文案', () => {
  assert.equal(pickTeamMessage([]), null);
  assert.equal(pickTeamMessage(['唯一一句']), '唯一一句');
  const messages = ['甲', '乙', '丙'];
  for (let i = 0; i < 100; i++) assert.ok(messages.includes(pickTeamMessage(messages)));
});
