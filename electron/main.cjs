const { app, BrowserWindow, dialog, shell, nativeTheme } = require('electron');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let mainWindow;
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
app.on('second-instance', () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});

function projectRoot() {
  const settingsFile = path.join(app.getPath('userData'), 'project-root.txt');
  const candidates = [process.env.QA_ORBIT_PROJECT_ROOT, fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8').trim() : undefined, process.cwd(), path.join(app.getPath('desktop'), 'CityFM-Playwright')];
  for (const candidate of candidates) if (candidate && fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
  const chosen = dialog.showOpenDialogSync({ title: 'Select your Playwright project', properties: ['openDirectory'] })?.[0];
  if (chosen && fs.existsSync(path.join(chosen, 'package.json'))) {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, chosen);
    return chosen;
  }
  return undefined;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { const response = await fetch(`${url}/api/state`); if (response.ok) return; }
    catch { /* backend still starting */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('The QA Orbit server did not start.');
}

async function launch() {
  const root = projectRoot();
  if (!root) { dialog.showErrorBox('QA Orbit', 'Select the CityFM-Playwright project folder with package.json to start QA Orbit.'); app.quit(); return; }
  process.chdir(root);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  process.env.PORT = String(port);
  process.env.QA_ORBIT_DIST_DIR = path.join(app.getAppPath(), 'dist');
  nativeTheme.themeSource = 'dark';
  app.setAppUserModelId('com.raziharris.qaorbit');
  await import(pathToFileURL(path.join(app.getAppPath(), 'build', 'server', 'index.mjs')).href);
  await waitForServer(origin);

  mainWindow = new BrowserWindow({
    width: 1500, height: 920, minWidth: 880, minHeight: 620, show: false,
    backgroundColor: '#0e1016', title: 'QA Orbit',
    icon: path.join(app.getAppPath(), 'assets', 'qa-orbit-icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) { event.preventDefault(); if (/^https?:\/\//i.test(url)) void shell.openExternal(url); }
  });
  await mainWindow.loadURL(origin);
}

app.whenReady().then(launch).catch(error => { dialog.showErrorBox('QA Orbit could not start', String(error?.stack || error)); app.quit(); });
app.on('window-all-closed', () => app.quit());
