import { app, BrowserWindow, dialog, Menu, nativeImage, session, Tray, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import { DEFAULT_UPDATE_URL, DEFAULT_WEB_URL, loadConfig, siteStorage, type DesktopConfig } from './config.js';
import { createSettings } from './settings.js';
import { createUpdater } from './updater.js';
import type { UpdateController } from './update-controller.js';

// 修正运行时系统名称，同时保留旧安装版的用户数据目录与登录状态。
const existingUserData = app.getPath('userData');
app.setName('下次一定');
app.setPath('userData', existingUserData);

let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let configured = new URL(DEFAULT_WEB_URL);
let updater: UpdateController | undefined;
let openSettings: (() => void) | undefined;
let updateLabel = '检查更新';
let startupTimer: ReturnType<typeof setTimeout> | undefined;

/** 使用从网页favicon生成的品牌资源，托盘在离线时仍可显示。 */
function appIcon() {
  return nativeImage.createFromPath(join(__dirname, '../assets/icon.png'));
}

/** 托盘只能打开当前配置的业务站点，页面本身重新加载权限。 */
function show(path?: string): void {
  if (!window) return;
  if (path) {
    const target = new URL(path, configured);
    if (target.origin !== configured.origin) return;
    void window.loadURL(target.href).catch(() => openSettings?.());
  }
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
}

/** 主窗口与托盘共用配置和更新入口，网页故障时仍可操作。 */
function refreshMenus(): void {
  const actions: MenuItemConstructorOptions[] = [
    { label: '打开下次一定', click: () => show('/') },
    { label: '刷新网页', accelerator: 'CmdOrCtrl+R', click: () => window?.webContents.reload() },
    { type: 'separator' },
    { label: '客户端设置', click: () => openSettings?.() },
    { label: updateLabel, click: () => { void updater?.check(true); } },
    { label: `当前版本 ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ];
  tray?.setContextMenu(Menu.buildFromTemplate(actions));
  window?.setMenu(Menu.buildFromTemplate([{ label: '客户端', submenu: actions }]));
}

/** 安全窗口复用网页；关闭隐藏到托盘，显式退出才终止应用。 */
async function start(): Promise<void> {
  app.setAppUserModelId('cn.nexttimeforsure.desktop');
  const configPath = join(app.getPath('userData'), 'desktop-settings.json');
  let config: DesktopConfig = { webUrl: DEFAULT_WEB_URL, updateUrl: DEFAULT_UPDATE_URL, checkOnStartup: true };
  let configError = '';
  try { config = await loadConfig(configPath, process.env); } catch {
    configError = '原配置无法读取或地址不合法，请重新填写并保存。';
  }
  configured = new URL(config.webUrl);

  // 不同环境可能有相同账号与事件ID，登录Cookie必须按站点隔离。
  const storage = siteStorage(config.webUrl);
  const businessSession = storage.partition ? session.fromPartition(storage.partition) : session.defaultSession;
  businessSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  businessSession.setPermissionCheckHandler(() => false);
  window = new BrowserWindow({ width: 1200, height: 820, minWidth: 420, title: '下次一定', icon: appIcon(), webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, session: businessSession } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => { if (new URL(target).origin !== configured.origin) event.preventDefault(); });
  window.webContents.on('will-redirect', (event, target) => { if (new URL(target).origin !== configured.origin) event.preventDefault(); });
  window.on('close', (event) => { if (!quitting) { event.preventDefault(); window?.hide(); } });
  tray = new Tray(appIcon().resize({ width: 32, height: 32 })); tray.setToolTip('下次一定');
  tray.on('double-click', () => show());
  openSettings = createSettings(config, configPath, () => updater?.isBusy ?? false, configError);
  updater = createUpdater(config, window, (label) => { updateLabel = label; refreshMenus(); });
  refreshMenus();
  if (configError) { openSettings(); return; }

  void window.loadURL(configured.href).catch(async () => {
    if (quitting) return;
    await dialog.showMessageBox({ type: 'warning', title: '无法连接网页服务', message: '请检查服务是否启动、网络是否可用，或在客户端设置中修改网页地址。' });
    openSettings?.();
  });
  if (app.isPackaged && config.checkOnStartup && config.updateUrl) startupTimer = setTimeout(() => { void updater?.check(false); }, 5000);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => show());
  app.on('activate', () => show());
  app.on('before-quit', () => { quitting = true; clearTimeout(startupTimer); tray?.destroy(); });
  void app.whenReady().then(start).catch(() => { console.error('桌面启动失败，请检查服务与客户端配置。'); app.quit(); });
}
