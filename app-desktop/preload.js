const { contextBridge, ipcRenderer } = require('electron');

// 桌面端能力桥(H0):原生文件夹选择框
contextBridge.exposeInMainWorld('jlcDesktop', {
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
});
