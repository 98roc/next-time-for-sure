import { app, BrowserWindow, Menu, nativeImage, session, Tray } from 'electron';
import { join } from 'node:path';
import { startNotifications } from './notifications.js';

let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let stopNotifications: (() => void) | undefined;
const configured = new URL(process.env.DESKTOP_WEB_URL ?? 'http://127.0.0.1:5174');
if (configured.protocol !== 'http:' || configured.hostname !== '127.0.0.1' || configured.username || configured.password || configured.pathname !== '/' || configured.search || configured.hash) throw new Error('Only a local frontend origin is allowed');

/** 绘制与网页一致的错位方块标志，托盘在离线时仍可显示。 */
function appIcon() {
  const size = 32; const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = (y * size + x) * 4;
    const back = x >= 5 && x <= 19 && y >= 14 && y <= 28 && (x <= 6 || x >= 18 || y <= 15 || y >= 27);
    const clearance = x >= 12 && x <= 29 && y >= 2 && y <= 20;
    const front = x >= 14 && x <= 27 && y >= 4 && y <= 18;
    const mark = front || (back && !clearance);
    pixels[index] = mark ? 48 : 249; pixels[index + 1] = mark ? 39 : 246; pixels[index + 2] = mark ? 36 : 245; pixels[index + 3] = 255;
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size });
}

/** 通知与托盘只能打开当前本机业务站点，页面本身重新加载权限。 */
function show(path?: string): void {
  if (!window) return;
  if (path) void window.loadURL(new URL(path, configured).href).catch(() => console.error('本机网页服务不可用。'));
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
}

/** 安全窗口复用网页；关闭隐藏到托盘，显式退出才终止应用。 */
async function start(): Promise<void> {
  app.setAppUserModelId('cn.nexttimeforsure.desktop');
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  window = new BrowserWindow({ width: 1200, height: 820, minWidth: 420, title: '下次一定', icon: appIcon(), webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => { if (new URL(target).origin !== configured.origin) event.preventDefault(); });
  window.webContents.on('will-redirect', (event, target) => { if (new URL(target).origin !== configured.origin) event.preventDefault(); });
  window.on('close', (event) => { if (!quitting) { event.preventDefault(); window?.hide(); } });
  tray = new Tray(appIcon()); tray.setToolTip('下次一定');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开下次一定', click: () => show('/') }, { label: '查看通知', click: () => show('/collaboration') }, { type: 'separator' }, { label: '退出', click: () => app.quit() }]));
  tray.on('double-click', () => show());
  stopNotifications = await startNotifications(configured.origin, join(app.getPath('userData'), 'notification-ledger.json'), show);
  await window.loadURL(configured.href).catch(() => console.error('本机网页服务不可用；启动服务后从托盘重新打开。'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => show());
  app.on('activate', () => show());
  app.on('before-quit', () => { quitting = true; stopNotifications?.(); tray?.destroy(); });
  void app.whenReady().then(start).catch(() => { console.error('桌面启动失败，请检查本机服务或通知记录文件。'); app.quit(); });
}
