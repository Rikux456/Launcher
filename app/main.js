// Proceso principal de Electron: ventana, archivos de la interfaz, ajustes y todo lo que pide la interfaz.
'use strict';
const { app, BrowserWindow, ipcMain, protocol, shell, dialog, screen } = require('electron');
const path = require('path');
const fsp = require('fs/promises');
const core = require('./core');

const SELFTEST = process.argv.includes('--selftest');
const RENDERER = path.join(__dirname, 'renderer');
const W = 1880, H = 1040;   // tamaño de diseño de la interfaz (se escala a la ventana)

// en PCs sin tarjeta gráfica compatible, que el fondo WebGL siga funcionando con el modo por software
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
if (!SELFTEST && !app.requestSingleInstanceLock()) app.quit();

let win, settings = {}, target = null, currentPlan = null, busy = false, waitTimer = null;
const send = (ch, ...a) => win && !win.isDestroyed() && win.webContents.send(ch, ...a);
const save = () => core.saveSettings(settings);

function setTarget(t, persist) {
  target = t;
  if (persist) { settings.targetKind = t.kind; settings.targetDir = t.dir; save(); }
  send('target', publicTarget());
}
const publicTarget = () => target && { kind: target.kind, name: target.name, label: target.label, dir: target.dir };

function createWindow() {
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const s = Math.min(1, (wa.width * 0.9) / W, (wa.height * 0.9) / H);
  win = new BrowserWindow({
    width: Math.round(W * s), height: Math.round(H * s), minWidth: 940, minHeight: 520,
    frame: false, backgroundColor: '#050819', show: false, title: core.PACK_NAME + ' Launcher',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false },
  });
  win.setAspectRatio(W / H);
  win.once('ready-to-show', () => win.show());
  win.loadURL('app://launcher/index.html' + (SELFTEST ? '?selftest=1' : ''));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); shell.openExternal(url); } });
}

// Sirve un archivo de la interfaz, por trozos si se piden (el vídeo de la intro los necesita para poder moverse).
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ttf': 'font/ttf', '.webm': 'video/webm', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.json': 'application/json' };
async function serveFile(file, range) {
  let st;
  try { st = await fsp.stat(file); } catch { return new Response('no existe', { status: 404 }); }
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return new Response(require('stream').Readable.toWeb(require('fs').createReadStream(file)),
    { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(st.size), 'Accept-Ranges': 'bytes' } });
  let a = m[1] === '' ? Math.max(0, st.size - Number(m[2])) : Number(m[1]);
  let b = m[1] !== '' && m[2] !== '' ? Number(m[2]) : st.size - 1;
  b = Math.min(b, st.size - 1);
  if (a > b) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
  return new Response(require('stream').Readable.toWeb(require('fs').createReadStream(file, { start: a, end: b })), {
    status: 206, headers: { 'Content-Type': type, 'Content-Length': String(b - a + 1), 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Accept-Ranges': 'bytes' } });
}

app.whenReady().then(async () => {
  protocol.handle('app', req => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(RENDERER, rel));
    if (!file.startsWith(RENDERER)) return new Response('no', { status: 403 });
    return serveFile(file, req.headers.get('range'));
  });
  settings = await core.loadSettings();
  setTarget(core.targetFromSettings(settings, await core.detectTargets()), false);
  createWindow();
  if (SELFTEST) require('./selftest')(win, { core, ipc: handlers });
  else setupUpdater();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());

// ---------- Auto-actualización (Releases de GitHub) ----------
let updateReady = null;
function setupUpdater() {
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', info => { updateReady = info.version; send('launcher-update', { version: info.version }); });
  autoUpdater.on('error', () => {});
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 4000);
  setInterval(check, 60 * 60 * 1000);
  handlers.checkLauncher = check;
  handlers.restartToUpdate = () => { if (updateReady) autoUpdater.quitAndInstall(false, true); };
}

// ---------- Lo que pide la interfaz ----------
const fmtMB = b => (b / 1048576).toFixed(1).replace('.', ',') + ' MB';
const handlers = {
  async init() {
    return {
      version: app.getVersion(), pack: core.PACK_NAME, target: publicTarget(),
      introAlways: settings.introAlways === 'true', introSeen: settings.introSeenVersion === app.getVersion(),
      musicMuted: settings.musicMuted === 'true', volume: settings.volume != null ? Number(settings.volume) : 1,
      firstTime: !settings.targetKind,
      apps: { modrinth: await core.modrinthInstalled(), prism: await core.prismInstalled(), official: await core.officialInstalled() },
      updateReady,
    };
  },
  setPref(k, v) { if (['introAlways', 'introSeenVersion', 'musicMuted', 'volume'].includes(k)) { settings[k] = String(v); save(); } },
  async check() {
    if (busy) return { busy: true };
    if (handlers.checkLauncher) handlers.checkLauncher();
    const m = await core.fetchManifest();
    const [p, news] = await Promise.all([core.plan(target.dir, m), core.fetchNews()]);
    currentPlan = p;
    return {
      version: m.version, upToDate: core.upToDate(p), files: p.downloads.length, size: fmtMB(p.bytes),
      deletions: p.deletions.map(d => path.basename(d)), news,
    };
  },
  async update() {
    if (!currentPlan || busy) return { ok: false };
    busy = true;
    try {
      let last = 0;
      await core.apply(target.dir, currentPlan, (text, frac) => {
        const now = Date.now(); if (now - last > 50 || frac >= 1) { last = now; send('progress', { text, frac }); }
      });
      currentPlan = { ...currentPlan, downloads: [], deletions: [], bytes: 0 };
      return { ok: true, version: currentPlan.manifest.version };
    } catch (e) { return { ok: false, error: e.message }; }
    finally { busy = false; }
  },
  async targets() {
    return {
      list: (await core.detectTargets()).map(t => ({ kind: t.kind, name: t.name, label: t.label, dir: t.dir, current: target && t.dir === target.dir && t.kind === target.kind })),
      modrinth: await core.modrinthInstalled(), prism: await core.prismInstalled(), official: await core.officialInstalled(),
    };
  },
  async chooseTarget(t) {
    const found = (await core.detectTargets()).find(x => x.kind === t.kind && x.dir === t.dir);
    if (found) setTarget(found, true);
    return publicTarget();
  },
  async chooseFolder() {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: target.dir });
    if (r.canceled || !r.filePaths[0]) return null;
    const d = r.filePaths[0];
    setTarget({ kind: 'CUSTOM', name: d, dir: d, instanceId: null, label: 'Carpeta · ' + path.basename(d) }, true);
    return publicTarget();
  },
  async openFolder() { await fsp.mkdir(target.dir, { recursive: true }); return shell.openPath(target.dir); },
  openExternal(url) { if (/^https:\/\//.test(url)) shell.openExternal(url); },
  async keepOfficial() { settings.targetKind = target.kind; settings.targetDir = target.dir; save(); },

  /** Genera el .mrpack, lo abre en Modrinth/Prism y espera a que aparezca la instancia nueva. */
  async createInstance(kind) {
    const before = new Set((await core.detectTargets()).map(t => t.dir));
    const m = currentPlan ? currentPlan.manifest : await core.fetchManifest();
    const pack = await core.buildMrpack(m);
    const ok = kind === 'MODRINTH'
      ? (await core.openModrinth([pack])) || (await shell.openPath(pack)) === ''
      : await core.prismCmd(['--import', pack]);
    if (!ok) return { ok: false };
    clearInterval(waitTimer);
    const start = Date.now();
    waitTimer = setInterval(async () => {
      const t = (await core.detectTargets()).find(x => x.kind === kind && !before.has(x.dir));
      if (t) { clearInterval(waitTimer); setTarget(t, true); send('instance-created', publicTarget()); }
      else if (Date.now() - start > 15 * 60000) { clearInterval(waitTimer); send('instance-timeout'); }
    }, 2000);
    return { ok: true };
  },
  cancelWait() { clearInterval(waitTimer); },
  async waitForLauncher() {   // PC sin ningún launcher: avisa cuando aparezca uno
    clearInterval(waitTimer);
    waitTimer = setInterval(async () => {
      const a = { modrinth: await core.modrinthInstalled(), prism: await core.prismInstalled(), official: await core.officialInstalled() };
      if (a.modrinth || a.prism || a.official) {
        clearInterval(waitTimer);
        setTarget(core.targetFromSettings({}, await core.detectTargets()), false);
        send('launcher-installed', a);
      }
    }, 3000);
  },

  /** Jugar: según el destino. Devuelve un mensaje para la barra de estado o lo que haga falta preguntar. */
  async play() {
    const t = target;
    if (t.kind === 'MODRINTH') {
      const id = await core.modrinthInstanceId(t.dir);
      if (id) { await shell.openExternal('modrinth://launch/instance/' + encodeURIComponent(id)); return { status: `Iniciando ${t.name} en Modrinth…` }; }
      return { status: (await core.openModrinth()) ? `Abriendo Modrinth… dale a Jugar en el perfil "${t.name}".` : `Abre Modrinth y dale a Jugar en el perfil "${t.name}".` };
    }
    if (t.kind === 'PRISM')
      return { status: (await core.prismCmd(['--launch', t.instanceId])) ? `Iniciando ${t.name} con Prism…` : `Abre Prism y dale a Jugar en "${t.name}".` };
    if (t.kind === 'CUSTOM') return { info: `Modpack listo en:\n${t.dir}\n\nAbre tu launcher y juega con la instancia que usa esa carpeta.` };
    // launcher oficial
    if (!(await core.officialInstalled())) {
      return (await core.modrinthInstalled()) || (await core.prismInstalled())
        ? { error: 'El launcher oficial no está instalado. Elige Modrinth o Prism en "Se abre con".' } : { noLauncher: true };
    }
    const mc = currentPlan ? currentPlan.manifest : await core.fetchManifest();
    let res = await core.ensureProfile(t.dir, mc.minecraft);
    if (res === 'NEOFORGE') {
      busy = true;
      try { await core.installNeoForge(mc.neoforge, (text, frac) => send('progress', { text, frac, neoforge: true })); }
      catch (e) { return { error: e.message, status: 'No se pudo instalar NeoForge' }; }
      finally { busy = false; }
      res = await core.ensureProfile(t.dir, mc.minecraft);
    }
    if (res) return { info: res + `\n\nPuedes jugar igualmente: crea un perfil de NeoForge en tu launcher con esta carpeta de juego:\n${t.dir}` };
    return { status: (await core.openOfficialLauncher()) ? `Abriendo Minecraft… elige el perfil "${core.PACK_NAME}" y dale a Jugar.`
      : `Perfil "${core.PACK_NAME}" listo. Abre el launcher de Minecraft y elígelo.` };
  },
  minimize() { win.minimize(); },
  close() { win.close(); },
  restartToUpdate() {},
};
for (const [name, fn] of Object.entries(handlers)) ipcMain.handle(name, (_e, ...a) => handlers[name](...a));
module.exports = { handlers };
