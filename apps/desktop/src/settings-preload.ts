import { contextBridge, ipcRenderer } from 'electron';

// 此预加载脚本只挂载到本地设置页，不能接收任意IPC通道名。
contextBridge.exposeInMainWorld('desktopSettings', {
  read: () => ipcRenderer.invoke('desktop-settings:read'),
  save: (config: unknown) => ipcRenderer.invoke('desktop-settings:save', config),
});
