// Processus principal : fenêtre, accès au micro et mises à jour automatiques.
const { app, BrowserWindow, ipcMain, session, shell, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

const CHECK_EVERY = 30 * 60 * 1000;
let win = null;
let updateStatus = { state: app.isPackaged ? 'idle' : 'dev' };

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0e1014',
    title: 'Voix Studio',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // La voix doit continuer d'être traitée quand la fenêtre est en arrière-plan
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function sendUpdate(status) {
  updateStatus = status;
  if (win && !win.isDestroyed()) win.webContents.send('update', status);
}

function checkForUpdates() {
  if (!app.isPackaged) return Promise.resolve(false);
  return autoUpdater.checkForUpdates().then(() => true).catch(() => false);
}

function setupUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => sendUpdate({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => sendUpdate({ state: 'latest' }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', version: updateStatus.version, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => sendUpdate({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => sendUpdate({ state: 'error', message: err ? String(err.message || err) : '' }));
  checkForUpdates();
  setInterval(checkForUpdates, CHECK_EVERY);
}

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('update:status', () => updateStatus);
ipcMain.handle('update:check', () => checkForUpdates());
ipcMain.on('update:install', () => {
  if (updateStatus.state === 'ready') autoUpdater.quitAndInstall(false, true);
});

app.whenReady().then(() => {
  const allowed = ['media', 'speaker-selection'];
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(allowed.includes(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => allowed.includes(perm));
  createWindow();
  setupUpdates();
});

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on('window-all-closed', () => app.quit());
