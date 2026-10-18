import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';

export const DEFAULT_WEB_URL = 'http://127.0.0.1:5174';
export const DEFAULT_UPDATE_URL = 'https://github.com/98roc/next-time-for-sure/releases/latest/download/';

/** 客户端本地配置；更新地址为空表示尚未启用客户端升级。 */
export interface DesktopConfig {
  webUrl: string;
  updateUrl: string;
  checkOnStartup: boolean;
}

/** 校验管理员或用户填写的HTTP(S)地址，不允许内嵌凭据和查询参数。 */
function parseAddress(value: unknown, label: string, originOnly: boolean): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`);
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error(`${label}格式不正确`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label}只允许HTTP或HTTPS地址，不能包含账号、密码、查询参数或锚点`);
  }
  if (originOnly && url.pathname !== '/') throw new Error('网页地址只填写域名或IP及端口，不包含页面路径');
  return originOnly ? url.origin : `${url.href.replace(/\/+$/, '')}/`;
}

/** 所有配置入口共用校验，不把渲染进程或JSON文件当作可信输入。 */
export function parseConfig(value: unknown): DesktopConfig {
  if (typeof value !== 'object' || value === null || !('webUrl' in value) || !('updateUrl' in value) || !('checkOnStartup' in value)) {
    throw new Error('客户端配置缺少必要字段');
  }
  if (typeof value.updateUrl !== 'string' || typeof value.checkOnStartup !== 'boolean') throw new Error('客户端配置字段类型不正确');
  return {
    webUrl: parseAddress(value.webUrl, '网页地址', true),
    updateUrl: value.updateUrl.trim() ? parseAddress(value.updateUrl, '更新地址', false) : '',
    checkOnStartup: value.checkOnStartup,
  };
}

/** 已保存配置优先；环境变量只用于首次启动，没有配置时默认连接本机。 */
export async function loadConfig(path: string, environment: NodeJS.ProcessEnv): Promise<DesktopConfig> {
  try { return parseConfig(JSON.parse(await readFile(path, 'utf8'))); } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  return parseConfig({ webUrl: environment.DESKTOP_WEB_URL ?? DEFAULT_WEB_URL, updateUrl: environment.DESKTOP_UPDATE_URL ?? DEFAULT_UPDATE_URL, checkOnStartup: true });
}

/** 原子替换配置，避免中断写入留下半个JSON文件。 */
export async function saveConfig(path: string, value: unknown): Promise<DesktopConfig> {
  const config = parseConfig(value);
  await writeFile(`${path}.tmp`, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await rename(`${path}.tmp`, path);
  return config;
}

/** 按站点隔离会话，默认本机站点保留原有用户数据。 */
export function siteStorage(webUrl: string): { partition: string } {
  const origin = parseAddress(webUrl, '网页地址', true);
  if (origin === DEFAULT_WEB_URL) return { partition: '' };
  const key = createHash('sha256').update(origin).digest('hex');
  return { partition: `persist:site-${key}` };
}
