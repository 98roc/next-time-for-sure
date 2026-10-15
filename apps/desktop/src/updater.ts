import { app, dialog, type BrowserWindow } from 'electron';
import { NsisUpdater } from 'electron-updater';
import type { DesktopConfig } from './config.js';
import { UpdateController } from './update-controller.js';

/** 连接可配置的静态更新目录；不借用业务登录Cookie，也不自动退出安装。 */
export function createUpdater(config: DesktopConfig, window: BrowserWindow, status: (label: string) => void): UpdateController {
  const updater = app.isPackaged && config.updateUrl ? new NsisUpdater({ provider: 'generic', url: config.updateUrl }) : undefined;
  let componentError: Error | undefined;
  if (updater) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    // 不将包含服务器地址的组件调试日志写入控制台。
    updater.logger = null;
    updater.on('error', (error: Error) => { componentError = error; console.error('客户端更新组件报告错误。'); });
  }
  const controller = new UpdateController(updater ? {
    check: async () => {
      const result = await updater.checkForUpdates();
      return result?.isUpdateAvailable ? result.updateInfo.version : undefined;
    },
    download: async () => { await updater.downloadUpdate(); },
    install: () => {
      componentError = undefined;
      updater.quitAndInstall(false, true);
      // 安装启动失败通过事件报告，转为异常让控制器提供重试反馈。
      if (componentError) throw componentError;
    },
  } : undefined, {
    confirm: async (message, action) => {
      const answer = await dialog.showMessageBox({ type: 'question', title: '下次一定 · 客户端更新', message, buttons: [action, '稍后'], defaultId: 1, cancelId: 1, noLink: true });
      return answer.response === 0;
    },
    inform: async (message) => { await dialog.showMessageBox({ type: 'info', title: '下次一定 · 客户端更新', message }); },
    status: (label, progress) => {
      if (!window.isDestroyed()) window.setProgressBar(progress ?? -1);
      status(label);
    },
  }, config.updateUrl ? '开发模式不执行安装包更新，请使用已安装的Windows客户端。' : '尚未配置更新地址，请在“客户端设置”中填写安装包更新目录。');
  updater?.on('download-progress', (progress) => controller.progress(progress.percent));
  return controller;
}
