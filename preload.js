// Pont limité entre l'interface et le processus principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  version: () => ipcRenderer.invoke('app:version'),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  onUpdate: (fn) => ipcRenderer.on('update', (_e, status) => fn(status)),
  vmic: {
    status: () => ipcRenderer.invoke('vmic:status'),
    enable: () => ipcRenderer.invoke('vmic:enable'),
    restore: () => ipcRenderer.invoke('vmic:restore'),
    install: () => ipcRenderer.invoke('vmic:install'),
    rename: () => ipcRenderer.invoke('vmic:rename'),
    setLatency: (samples) => ipcRenderer.invoke('vmic:setLatency', samples),
  },
  mic: {
    isMuted: (name) => ipcRenderer.invoke('mic:muted', name),
    unmute: (name) => ipcRenderer.invoke('mic:unmute', name),
  },
  sounds: {
    scan: () => ipcRenderer.invoke('sounds:scan'),
    pickFolder: () => ipcRenderer.invoke('sounds:pickFolder'),
    read: (p) => ipcRenderer.invoke('sounds:read', p),
  },
});
