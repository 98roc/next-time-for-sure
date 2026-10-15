import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { saveConfig, type DesktopConfig } from './config.js';

/** 独立本地设置窗口；只有本窗口主框架可以读写配置，业务网页没有IPC入口。 */
export function createSettings(config: DesktopConfig, path: string, isUpdating: () => boolean, initialError = ''): () => void {
  let settingsWindow: BrowserWindow | undefined;
  let saving = false;
  const page = join(__dirname, '../assets/settings.html');
  const trusted = (event: IpcMainInvokeEvent) => settingsWindow && event.sender === settingsWindow.webContents
    && event.senderFrame === settingsWindow.webContents.mainFrame && event.senderFrame.url === pathToFileURL(page).href;

  ipcMain.handle('desktop-settings:read', (event) => {
    if (!trusted(event)) throw new Error('不允许访问客户端配置');
    return { config, version: app.getVersion(), error: initialError };
  });
  ipcMain.handle('desktop-settings:save', async (event, value: unknown) => {
    if (!trusted(event)) throw new Error('不允许修改客户端配置');
    if (saving || isUpdating()) return { ok: false, error: '请先完成当前更新操作或关闭更新确认框，再保存配置。' };
    saving = true;
    try {
      await saveConfig(path, value);
      // 等IPC响应送达后重启，原窗口的正常退出流程负责停止通知并清理托盘。
      setTimeout(() => { app.relaunch(); app.quit(); }, 200);
      return { ok: true };
    } catch (error) {
      saving = false;
      return { ok: false, error: error instanceof Error && !('code' in error) ? error.message : '无法保存配置，请检查用户数据目录的写入权限。' };
    }
  });

  return () => {
    if (settingsWindow) { settingsWindow.show(); settingsWindow.focus(); return; }
    settingsWindow = new BrowserWindow({ width: 650, height: 700, minWidth: 520, minHeight: 640, title: '下次一定 · 客户端设置', icon: join(__dirname, '../assets/icon.png'), autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, 'settings-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'desktop-settings' } });
    settingsWindow.setMenu(null);
    settingsWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    settingsWindow.webContents.session.setPermissionCheckHandler(() => false);
    settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    settingsWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    settingsWindow.webContents.on('will-redirect', (event) => event.preventDefault());
    settingsWindow.on('closed', () => { settingsWindow = undefined; });
    void settingsWindow.loadFile(page).catch(() => console.error('无法打开客户端设置。'));
  };
}
