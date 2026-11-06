// Lógica del launcher (sin interfaz): modpack, destinos (oficial / Modrinth / Prism), NeoForge.
// Es la misma que tenía el launcher Java 1.4, y usa los mismos archivos de ajustes y de estado,
// así que quien venga del launcher viejo no vuelve a descargar nada.
'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

// ====== CONFIGURACIÓN ======
const PACK_NAME = 'Derisomod';
const REPO = 'Rikux456/Launcher';
const BRANCH = 'main';
const RAM = '-Xmx4G';
// ===========================

const PROFILE_ID = PACK_NAME.toLowerCase().replace(/[^a-z0-9]/g, '') + '-launcher';
const RAW_BASE = process.env.LAUNCHER_RAW || `https://raw.githubusercontent.com/${REPO}`;
const UA = { 'User-Agent': `${PACK_NAME}-Launcher` };
const isWin = process.platform === 'win32', isMac = process.platform === 'darwin';

// ---------- Rutas ----------
function home() { return process.env.LAUNCHER_HOME || os.homedir(); }
function appData() {
  if (isWin) return process.env.APPDATA || home();
  if (isMac) return path.join(home(), 'Library', 'Application Support');
  return process.env.XDG_DATA_HOME || path.join(home(), '.local', 'share');
}
function minecraftDir() {
  if (isWin) return path.join(process.env.APPDATA || home(), '.minecraft');
  if (isMac) return path.join(home(), 'Library', 'Application Support', 'minecraft');
  return path.join(home(), '.minecraft');
}
function defaultGameDir() {
  return path.join(path.dirname(minecraftDir()), '.' + PACK_NAME.toLowerCase().replace(/[^a-z0-9]/g, '') + '-modpack');
}
const settingsFile = () => path.join(path.dirname(defaultGameDir()), '.' + PROFILE_ID + '.properties');
async function cacheDir() {
  const d = path.join(path.dirname(defaultGameDir()), '.' + PROFILE_ID + '-cache');
  await fsp.mkdir(d, { recursive: true });
  return d;
}

// ---------- Archivos .properties (mismo formato que Java) ----------
function parseProps(text) {
  const out = {};
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/^\s+/, '');
    if (!line || line[0] === '#' || line[0] === '!') continue;
    while (/(^|[^\\])(\\\\)*\\$/.test(line) && i + 1 < lines.length) line = line.slice(0, -1) + lines[++i].replace(/^\s+/, '');
    let k = 0, key = '';
    for (; k < line.length; k++) {
      const c = line[k];
      if (c === '\\') { key += line[k] + (line[k + 1] ?? ''); k++; continue; }
      if (c === '=' || c === ':' || /\s/.test(c)) break;
      key += c;
    }
    let rest = line.slice(k).replace(/^\s*/, '');
    if (rest[0] === '=' || rest[0] === ':') rest = rest.slice(1).replace(/^\s*/, '');
    out[unescapeProp(key)] = unescapeProp(rest);
  }
  return out;
}
function unescapeProp(s) {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (m, e) => {
    if (e[0] === 'u' && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
    return { t: '\t', n: '\n', r: '\r', f: '\f' }[e] ?? e;
  });
}
function escapeProp(s, isKey) {
  let o = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i], code = s.charCodeAt(i);
    if (c === '\\') o += '\\\\';
    else if (c === '\t') o += '\\t'; else if (c === '\n') o += '\\n'; else if (c === '\r') o += '\\r'; else if (c === '\f') o += '\\f';
    else if ('=:#!'.includes(c)) o += '\\' + c;
    else if (c === ' ' && (isKey || i === 0)) o += '\\ ';
    else if (code < 0x20 || code > 0x7e) o += '\\u' + code.toString(16).padStart(4, '0');
    else o += c;
  }
  return o;
}
function writeProps(obj, comment) {
  let s = (comment ? '#' + comment + '\n' : '') + '#' + new Date().toString() + '\n';
  for (const [k, v] of Object.entries(obj)) s += escapeProp(k, true) + '=' + escapeProp(String(v), false) + '\n';
  return s;
}
async function readPropsFile(f) { try { return parseProps(await fsp.readFile(f, 'utf8')); } catch { return {}; } }
async function writePropsFile(f, obj, comment) {
  await fsp.mkdir(path.dirname(f), { recursive: true });
  await fsp.writeFile(f, writeProps(obj, comment), 'utf8');
}

const loadSettings = () => readPropsFile(settingsFile());
const saveSettings = s => writePropsFile(settingsFile(), s).catch(() => {});
const stateFile = gameDir => path.join(gameDir, '.launcher', 'state.properties');
const loadState = gameDir => readPropsFile(stateFile(gameDir));
const saveState = (gameDir, s) => writePropsFile(stateFile(gameDir), s, PACK_NAME + ' launcher');

// ---------- Red ----------
async function getText(url) {
  const r = await fetch(url, { headers: UA, cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (r.status !== 200) throw new Error(`HTTP ${r.status} en ${url}`);
  return r.text();
}
async function getJson(url) { return JSON.parse(await getText(url)); }

// El manifest se lee de la rama con un parámetro distinto cada vez (sin la caché de 5 min de GitHub y sin
// gastar el límite de la API). Trae "commit": la publicación de la que salió; los archivos se bajan de ese commit.
async function fetchManifest() {
  const m = await getJson(`${RAW_BASE}/${BRANCH}/manifest.json?t=${Date.now()}`);
  const commit = /^[0-9a-f]{40}$/.test(String(m.commit || '')) ? m.commit : BRANCH;
  return {
    version: String(m.version), minecraft: String(m.minecraft || '1.21.1'), neoforge: String(m.neoforge || '21.1.262'),
    commit, files: m.files.map(f => ({ path: f.path, sha1: f.sha1, size: Number(f.size) })),
    mirrorDirs: Array.isArray(m.mirrorDirs) ? m.mirrorDirs.map(String) : ['mods'],
  };
}
function rawUrl(m, p) {
  let u = `${RAW_BASE}/${m.commit}/` + ('modpack/' + p).split('/').map(encodeURIComponent).join('/');
  if (m.commit === BRANCH) u += '?v=' + m.version;
  return u;
}
async function fetchNews() {
  try { return await getJson(`${RAW_BASE}/${BRANCH}/news.json?t=${Date.now()}`); } catch { return null; }
}

// ---------- Sincronización ----------
function sha1File(p) {
  return new Promise((res, rej) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(p).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej);
  });
}
function safeResolve(root, rel) {
  const p = path.resolve(root, rel);
  const r = path.resolve(root);
  if (p !== r && !p.startsWith(r + path.sep)) throw new Error('Ruta no válida en el manifest: ' + rel);
  return p;
}
const exists = p => fsp.access(p).then(() => true, () => false);

async function plan(gameDir, m) {
  const state = await loadState(gameDir);
  const downloads = []; let bytes = 0;
  const wanted = new Set();
  for (const f of m.files) {
    const local = safeResolve(gameDir, f.path);
    wanted.add(local);
    const mirrored = m.mirrorDirs.some(d => f.path.startsWith(d + '/'));
    let need;
    if (!(await exists(local))) need = true;
    else {
      const localSha = await sha1File(local);
      if (localSha === f.sha1) need = false;
      else if (mirrored) need = true;
      else need = f.sha1 !== state[f.path];   // config: si ya instalamos esta versión y el jugador la cambió, se respeta
    }
    if (need) { downloads.push(f); bytes += f.size; }
  }
  const deletions = [];
  for (const d of m.mirrorDirs) {
    const dir = safeResolve(gameDir, d);
    let ents = [];
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) if (e.isFile() && !wanted.has(path.join(dir, e.name))) deletions.push(path.join(dir, e.name));
  }
  return { manifest: m, downloads, deletions, bytes };
}
const upToDate = p => p.downloads.length === 0 && p.deletions.length === 0;

async function apply(gameDir, p, progress = () => {}) {
  await fsp.mkdir(gameDir, { recursive: true });
  const state = await loadState(gameDir);
  let done = 0; const total = Math.max(1, p.bytes);
  let i = 0;
  for (const f of p.downloads) {
    i++;
    const name = f.path.slice(f.path.lastIndexOf('/') + 1);
    const label = `Descargando ${name} (${i}/${p.downloads.length})`;
    progress(label, done / total);
    const target = safeResolve(gameDir, f.path);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = target + '.part';
    const r = await fetch(rawUrl(p.manifest, f.path), { headers: UA });
    if (r.status !== 200) throw new Error(`No se pudo descargar ${f.path} (HTTP ${r.status})`);
    let fileDone = 0;
    const counter = new (require('stream').Transform)({
      transform(chunk, _e, cb) { fileDone += chunk.length; progress(label, Math.min(1, (done + fileDone) / total)); cb(null, chunk); },
    });
    await pipeline(Readable.fromWeb(r.body), counter, fs.createWriteStream(tmp));
    if ((await sha1File(tmp)) !== f.sha1) {
      await fsp.rm(tmp, { force: true });
      throw new Error(`El archivo ${f.path} llegó dañado. Vuelve a intentarlo.`);
    }
    await fsp.rename(tmp, target);
    state[f.path] = f.sha1;
    done += f.size;
  }
  for (const d of p.deletions) { progress('Quitando ' + path.basename(d), 1); await fsp.rm(d, { force: true }); }
  for (const f of p.manifest.files) if (!(f.path in state)) state[f.path] = f.sha1;
  state._version = p.manifest.version;
  await saveState(gameDir, state);
  progress('Modpack actualizado', 1);
}

// ---------- Destinos ----------
async function subdirs(dir) {
  try {
    const e = await fsp.readdir(dir, { withFileTypes: true });
    return e.filter(x => x.isDirectory() && !x.name.startsWith('.') && !x.name.startsWith('_'))
      .map(x => path.join(dir, x.name)).sort((a, b) => path.basename(a).toLowerCase().localeCompare(path.basename(b).toLowerCase()));
  } catch { return []; }
}
const label = t => ({ OFFICIAL: 'Launcher oficial', MODRINTH: 'Modrinth · ' + t.name, PRISM: 'Prism · ' + t.name, CUSTOM: 'Carpeta · ' + path.basename(t.dir) }[t.kind]);
const mk = (kind, name, dir, instanceId = null) => { const t = { kind, name, dir, instanceId }; t.label = label(t); return t; };

async function detectTargets() {
  const t = [mk('OFFICIAL', 'Launcher oficial', defaultGameDir())];
  for (const app of ['ModrinthApp', 'com.modrinth.theseus'])
    for (const p of await subdirs(path.join(appData(), app, 'profiles'))) t.push(mk('MODRINTH', path.basename(p), p));
  const roots = [path.join(appData(), 'PrismLauncher', 'instances')];
  if (!isWin && !isMac) roots.push(path.join(home(), '.var', 'app', 'org.prismlauncher.PrismLauncher', 'data', 'PrismLauncher', 'instances'));
  for (const root of roots)
    for (const p of await subdirs(root)) {
      if (!(await exists(path.join(p, 'instance.cfg')))) continue;
      const mc = (await exists(path.join(p, 'minecraft'))) ? path.join(p, 'minecraft') : path.join(p, '.minecraft');
      t.push(mk('PRISM', path.basename(p), mc, path.basename(p)));
    }
  return t;
}
function targetFromSettings(s, detected) {
  const { targetKind: kind, targetDir: dir } = s;
  if (kind && dir) {
    const f = detected.find(t => t.kind === kind && t.dir === dir);
    if (f) return f;
    if (kind === 'CUSTOM') return mk('CUSTOM', dir, dir);
  }
  const f = detected.find(t => t.kind !== 'OFFICIAL' && t.name.toLowerCase().includes(PACK_NAME.toLowerCase()));
  return f || detected[0];
}
const modrinthInstalled = async () => (await exists(path.join(appData(), 'ModrinthApp'))) || exists(path.join(appData(), 'com.modrinth.theseus'));
const prismInstalled = async () => (await exists(path.join(appData(), 'PrismLauncher')))
  || exists(path.join(home(), '.var', 'app', 'org.prismlauncher.PrismLauncher'));
const STORE_PACKAGE = 'Microsoft.4297127D64EC6_8wekyb3d8bbwe';
async function legacyLauncherExe() {
  for (const env of ['ProgramFiles(x86)', 'ProgramFiles']) {
    const pf = process.env[env];
    if (pf && await exists(path.join(pf, 'Minecraft Launcher', 'MinecraftLauncher.exe'))) return path.join(pf, 'Minecraft Launcher', 'MinecraftLauncher.exe');
  }
  return null;
}
async function officialInstalled() {
  if (await exists(path.join(minecraftDir(), 'launcher_profiles.json'))) return true;
  if (isWin) return (process.env.LOCALAPPDATA && await exists(path.join(process.env.LOCALAPPDATA, 'Packages', STORE_PACKAGE))) || !!(await legacyLauncherExe());
  if (isMac) return exists('/Applications/Minecraft.app');
  return false;
}

// ---------- Abrir programas ----------
async function tryStart(cmd, args = []) {
  if (cmd.includes(path.sep) && !(await exists(cmd))) return false;
  return new Promise(res => {
    try {
      const c = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
      c.once('error', () => res(false));
      c.once('spawn', () => { c.unref(); res(true); });
    } catch { res(false); }
  });
}
async function openModrinth(extra = []) {
  if (isWin) {
    const L = process.env.LOCALAPPDATA, P = process.env.ProgramFiles;
    for (const exe of [L && path.join(L, 'Modrinth App', 'Modrinth App.exe'), L && path.join(L, 'Programs', 'Modrinth App', 'Modrinth App.exe'), P && path.join(P, 'Modrinth App', 'Modrinth App.exe')])
      if (exe && await tryStart(exe, extra)) return true;
    return false;
  }
  if (isMac) return tryStart('open', ['-a', 'Modrinth App', ...extra]);
  return (await tryStart('ModrinthApp', extra)) || tryStart('modrinth-app', extra);
}
async function prismCmd(args) {
  if (isWin) {
    const L = process.env.LOCALAPPDATA, P = process.env.ProgramFiles;
    return (L && await tryStart(path.join(L, 'Programs', 'PrismLauncher', 'prismlauncher.exe'), args))
      || (P && await tryStart(path.join(P, 'PrismLauncher', 'prismlauncher.exe'), args)) || false;
  }
  if (isMac) return tryStart('/Applications/Prism Launcher.app/Contents/MacOS/prismlauncher', args);
  return (await tryStart('prismlauncher', args)) || tryStart('flatpak', ['run', 'org.prismlauncher.PrismLauncher', ...args]);
}
async function openOfficialLauncher() {
  if (isWin) {
    const exe = await legacyLauncherExe();
    const store = process.env.LOCALAPPDATA && await exists(path.join(process.env.LOCALAPPDATA, 'Packages', STORE_PACKAGE));
    if (exe && !store) return tryStart(exe);
    return tryStart('explorer.exe', [`shell:AppsFolder\\${STORE_PACKAGE}!Minecraft`]);
  }
  if (isMac) return tryStart('open', ['-a', 'Minecraft']);
  return tryStart('minecraft-launcher');
}

/** Id interno de un perfil de Modrinth App (app.db; "local:<uuid>" desde 2026, antes el nombre de la carpeta). */
async function modrinthInstanceId(profileDir) {
  const folder = path.basename(profileDir);
  const appDir = path.dirname(path.dirname(profileDir));
  const db = path.join(appDir, 'app.db');
  if (!(await exists(db))) return folder;
  let tmp;
  try {
    const { DatabaseSync } = require('node:sqlite');
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'mrdb'));   // copia: no molesta a Modrinth aunque esté abierto
    await fsp.copyFile(db, path.join(tmp, 'app.db'));
    if (await exists(db + '-wal')) await fsp.copyFile(db + '-wal', path.join(tmp, 'app.db-wal'));
    const c = new DatabaseSync(path.join(tmp, 'app.db'));
    try {
      const has = c.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='instances'").get();
      if (!has) return folder;
      for (const row of c.prepare('SELECT id, path FROM instances').all()) {
        const p = String(row.path).replace(/\\/g, '/');
        if (p === folder || p.endsWith('/' + folder)) return String(row.id);
      }
      return null;
    } finally { c.close(); }
  } catch { return null; }
  finally { if (tmp) fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}

// ---------- Crear instancias (.mrpack) ----------
/** Zip mínimo (sin comprimir), suficiente para el .mrpack. */
function zipStore(entries) {
  const zlib = require('zlib');
  const crc = b => {
    if (zlib.crc32) return zlib.crc32(b) >>> 0;
    let c, t = crc.t || (crc.t = Array.from({ length: 256 }, (_, n) => { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }));
    let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0;
  };
  const parts = [], central = []; let off = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name, 'utf8'), c = crc(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
    h.writeUInt32LE(0, 10); h.writeUInt32LE(c, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26); h.writeUInt16LE(0, 28);
    const ce = Buffer.alloc(46); ce.writeUInt32LE(0x02014b50, 0); ce.writeUInt16LE(20, 4); ce.writeUInt16LE(20, 6); ce.writeUInt16LE(0x0800, 8); ce.writeUInt16LE(0, 10);
    ce.writeUInt32LE(0, 12); ce.writeUInt32LE(c, 16); ce.writeUInt32LE(data.length, 20); ce.writeUInt32LE(data.length, 24); ce.writeUInt16LE(n.length, 28);
    ce.writeUInt32LE(off, 42);
    parts.push(h, n, data); central.push(ce, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

async function buildMrpack(m) {
  const idx = {
    formatVersion: 1, game: 'minecraft', versionId: m.version, name: PACK_NAME,
    summary: `Instancia del modpack ${PACK_NAME}. Los mods los instala ${PACK_NAME} Launcher.`,
    files: [], dependencies: { minecraft: m.minecraft, neoforge: m.neoforge },
  };
  const out = path.join(await cacheDir(), PACK_NAME + '.mrpack');
  await fsp.writeFile(out, zipStore([['modrinth.index.json', Buffer.from(JSON.stringify(idx, null, 2), 'utf8')]]));
  return out;
}

// ---------- NeoForge (launcher oficial) ----------
async function findNeoForge(mcVersion) {
  const prefix = 'neoforge-' + mcVersion.replace(/^1\./, '') + '.';
  const v = path.join(minecraftDir(), 'versions');
  let best = null;
  for (const d of await subdirs(v)) {
    const n = path.basename(d);
    if (n.startsWith(prefix) && await exists(path.join(d, n + '.json')) && (!best || compareVersions(n, best) > 0)) best = n;
  }
  return best;
}
function compareVersions(a, b) {
  const x = String(a).replace(/[^0-9.]/g, '').split('.'), y = String(b).replace(/[^0-9.]/g, '').split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const u = parseInt(x[i] || '0', 10) || 0, v = parseInt(y[i] || '0', 10) || 0;
    if (u !== v) return u < v ? -1 : 1;
  }
  return 0;
}
async function download(url, to, onProgress) {
  const r = await fetch(url, { headers: UA });
  if (r.status !== 200) throw new Error(`HTTP ${r.status} al descargar ${url}`);
  const total = Number(r.headers.get('content-length')) || 0; let n = 0;
  const counter = new (require('stream').Transform)({ transform(c, _e, cb) { n += c.length; if (total && onProgress) onProgress(n / total); cb(null, c); } });
  await pipeline(Readable.fromWeb(r.body), counter, fs.createWriteStream(to + '.part'));
  await fsp.rename(to + '.part', to);
}
/** Java para ejecutar el instalador de NeoForge: se descarga una vez (Temurin 21) a la caché del launcher. */
async function ensureJava(progress) {
  const dir = path.join(await cacheDir(), 'java21');
  const exeName = isWin ? 'java.exe' : 'java';
  const find = async () => {
    for (const d of await subdirs(dir)) {
      const c = isMac ? path.join(d, 'Contents', 'Home', 'bin', exeName) : path.join(d, 'bin', exeName);
      if (await exists(c)) return c;
    }
    return null;
  };
  let j = await find();
  if (j) return j;
  const osName = isWin ? 'windows' : isMac ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const url = `https://api.adoptium.net/v3/binary/latest/21/ga/${osName}/${arch}/jre/hotspot/normal/eclipse`;
  const archive = path.join(await cacheDir(), isWin ? 'java21.zip' : 'java21.tar.gz');
  await download(url, archive, f => progress('Descargando Java para instalar NeoForge…', 0.05 + f * 0.25));
  progress('Preparando Java…', 0.3);
  await fsp.mkdir(dir, { recursive: true });
  // tar viene con Windows 10/11 y también abre .zip
  await new Promise((res, rej) => spawn('tar', ['-xf', archive, '-C', dir], { windowsHide: true })
    .on('exit', c => c === 0 ? res() : rej(new Error('No se pudo descomprimir Java (tar ' + c + ')'))).on('error', rej));
  await fsp.rm(archive, { force: true });
  j = await find();
  if (!j) throw new Error('No se pudo preparar Java para instalar NeoForge.');
  return j;
}
async function installNeoForge(version, progress) {
  const mc = minecraftDir();
  const lp = path.join(mc, 'launcher_profiles.json');
  if (!(await exists(lp))) {   // launcher oficial instalado pero nunca abierto
    await fsp.mkdir(mc, { recursive: true });
    await fsp.writeFile(lp, '{\n  "profiles" : {},\n  "settings" : {},\n  "version" : 3\n}\n');
  }
  const java = await ensureJava(progress);
  const jar = path.join(await cacheDir(), `neoforge-${version}-installer.jar`);
  await download(`https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`, jar,
    f => progress(`Descargando NeoForge ${version}…`, 0.3 + f * 0.1));
  progress(`Instalando NeoForge ${version} (puede tardar un par de minutos)…`, 0.4);
  const log = fs.createWriteStream(path.join(await cacheDir(), 'neoforge-install.log'));
  const code = await new Promise(res => {
    const c = spawn(java, ['-jar', jar, '--install-client', mc], { cwd: path.dirname(jar), windowsHide: true });
    c.stdout.pipe(log); c.stderr.pipe(log);
    let f = 0.4; const tick = setInterval(() => { f = Math.min(0.95, f + 0.004); progress(`Instalando NeoForge ${version} (puede tardar un par de minutos)…`, f); }, 500);
    c.on('exit', x => { clearInterval(tick); res(x); });
    c.on('error', () => { clearInterval(tick); res(-1); });
  });
  if (code !== 0 || !(await findNeoForge('1.' + version.slice(0, version.lastIndexOf('.')))))
    throw new Error('La instalación de NeoForge falló. Mira el registro en:\n' + path.join(await cacheDir(), 'neoforge-install.log'));
  progress('NeoForge instalado', 1);
}
/** Crea o actualiza el perfil del modpack en el launcher oficial. null = bien; 'NEOFORGE' = falta; otro = motivo. */
async function ensureProfile(gameDir, mcVersion) {
  const neo = await findNeoForge(mcVersion);
  if (!neo) return 'NEOFORGE';
  const file = path.join(minecraftDir(), 'launcher_profiles.json');
  if (!(await exists(file))) return 'No se encontró el launcher oficial de Minecraft (' + file + ').';
  try {
    const root = JSON.parse(await fsp.readFile(file, 'utf8'));
    root.profiles = root.profiles || {};
    const now = new Date().toISOString();
    let p = root.profiles[PROFILE_ID];
    if (!p) { p = { created: now, icon: 'Furnace', javaArgs: RAM + ' -XX:+UseG1GC' }; root.profiles[PROFILE_ID] = p; }
    Object.assign(p, { name: PACK_NAME, type: 'custom', lastVersionId: neo, gameDir: path.resolve(gameDir), lastUsed: now });
    await fsp.copyFile(file, file + '.bak');
    await fsp.writeFile(file, JSON.stringify(root, null, 2) + '\n');
    return null;
  } catch (e) { return 'No se pudo crear el perfil: ' + e.message; }
}

module.exports = {
  zipStore,
  PACK_NAME, REPO, BRANCH, PROFILE_ID, isWin, isMac,
  appData, minecraftDir, defaultGameDir, settingsFile, cacheDir,
  parseProps, writeProps, loadSettings, saveSettings, loadState,
  fetchManifest, fetchNews, plan, apply, upToDate, sha1File, compareVersions,
  detectTargets, targetFromSettings, modrinthInstalled, prismInstalled, officialInstalled,
  openModrinth, prismCmd, openOfficialLauncher, modrinthInstanceId,
  buildMrpack, installNeoForge, ensureProfile, findNeoForge, tryStart, exists,
};
