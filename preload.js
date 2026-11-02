// Pont limité entre l'interface et le processus principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  version: () => ipcRenderer.invoke('app:version'),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  onUpdate: (fn) => ipcRenderer.on('update', (_e, status) => fn(status)),
});
