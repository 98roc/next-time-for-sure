import { app, BrowserWindow, session } from 'electron';

/** 第1阶段只提供安全窗口底座；安装包、托盘及系统通知在第6阶段验收。 */
async function openWindow(): Promise<void> {
  const url = new URL(process.env.DESKTOP_WEB_URL ?? 'http://127.0.0.1:5174');
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) throw new Error('Only the local frontend is allowed');
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const window = new BrowserWindow({ width: 1200, height: 820, minWidth: 420, title: '下次一定', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin !== url.origin) event.preventDefault();
  });
  await window.loadURL(url.href);
}

void app.whenReady().then(openWindow).catch(() => { console.error('Desktop startup failed; verify the local frontend.'); app.quit(); });
app.on('window-all-closed', () => app.quit());
