import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_UPDATE_URL, DEFAULT_WEB_URL, loadConfig, parseConfig, saveConfig, siteStorage } from './config.js';

test('本机、局域网和公网可配置；网页只接受origin，更新允许目录', () => {
  for (const webUrl of [DEFAULT_WEB_URL, 'http://localhost:5174', 'http://192.168.1.10:8080', 'https://work.example.com', 'http://[::1]:5174']) {
    const config = parseConfig({ webUrl: `${webUrl}/`, updateUrl: ' https://downloads.example.com/desktop ', checkOnStartup: false });
    assert.equal(config.webUrl, webUrl);
    assert.equal(config.updateUrl, 'https://downloads.example.com/desktop/');
  }
  assert.equal(parseConfig({ webUrl: DEFAULT_WEB_URL, updateUrl: ' ', checkOnStartup: true }).updateUrl, '');
});

test('拒绝可执行协议、内嵌凭据、查询、锚点及错误字段类型', () => {
  for (const value of ['file:///C:/secret', 'javascript:alert(1)', 'ftp://example.com', 'https://name:password@example.com', 'https://example.com?token=secret', 'https://example.com/#part', '', null]) {
    assert.throws(() => parseConfig({ webUrl: value, updateUrl: '', checkOnStartup: true }));
    if (value !== '') assert.throws(() => parseConfig({ webUrl: DEFAULT_WEB_URL, updateUrl: value, checkOnStartup: true }));
  }
  assert.throws(() => parseConfig({ webUrl: 'https://example.com/work', updateUrl: '', checkOnStartup: true }));
  assert.throws(() => parseConfig({ webUrl: DEFAULT_WEB_URL, updateUrl: '', checkOnStartup: 'true' }));
});

test('环境切换隔离Cookie，同一origin稳定且默认保留历史', () => {
  assert.deepEqual(siteStorage(DEFAULT_WEB_URL), { partition: '' });
  assert.deepEqual(siteStorage('https://WORK.example.com/'), siteStorage('https://work.example.com'));
  assert.notDeepEqual(siteStorage('http://work.example.com'), siteStorage('https://work.example.com'));
  assert.notDeepEqual(siteStorage('http://127.0.0.1:5174'), siteStorage('http://127.0.0.1:5175'));
});

test('配置持久化优先于环境变量；损坏配置不会被静默覆盖', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ntfs-config-'));
  const path = join(directory, 'desktop-settings.json');
  try {
    assert.deepEqual(await loadConfig(path, {}), { webUrl: DEFAULT_WEB_URL, updateUrl: DEFAULT_UPDATE_URL, checkOnStartup: true });
    const initial = await loadConfig(path, { DESKTOP_WEB_URL: 'http://192.168.1.10:80', DESKTOP_UPDATE_URL: 'https://updates.example.com/win' });
    assert.equal(initial.webUrl, 'http://192.168.1.10');
    const expected = await saveConfig(path, { ...initial, webUrl: 'https://work.example.com', checkOnStartup: false });
    assert.deepEqual(await loadConfig(path, { DESKTOP_WEB_URL: DEFAULT_WEB_URL }), expected);
    await assert.rejects(saveConfig(path, { ...expected, webUrl: 'file:///etc' }));
    assert.deepEqual(await loadConfig(path, {}), expected);
    await writeFile(path, '{broken');
    await assert.rejects(loadConfig(path, {}));
    assert.equal(await readFile(path, 'utf8'), '{broken');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
