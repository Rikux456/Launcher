// Interfaz del launcher: conecta la página animada con el launcher (window.launcher, ver preload.js).
'use strict';
(function () {
  const L = window.launcher;
  const $ = id => document.getElementById(id);
  const statusEl = $('status'), bar = $('bar'), bUpdate = $('bupdate'), bPlay = $('bplay'), bCheck = $('bcheck');
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let info = {}, plan = null, busy = false, checking = false, revealed = false;

  // ---------- pequeñas piezas de la interfaz ----------
  const setStatus = t => { statusEl.textContent = t; };
  function setBar(p, mode) {
    bar.style.setProperty('--p', Math.max(0, Math.min(1, p)));
    bar.classList.toggle('zero', p <= 0);
    bar.classList.toggle('busy', mode === 'busy');
  }
  const btn = (b, on) => { b.classList.toggle('off', !on); b.disabled = !on; };
  function setTargetLabel(t) {
    if (!t) return;
    $('tname').textContent = { OFFICIAL: 'el launcher oficial', MODRINTH: 'Modrinth · ' + t.name, PRISM: 'Prism · ' + t.name, CUSTOM: 'una carpeta' }[t.kind] || t.label;
  }
  function dialog(title, text, buttons) {
    return new Promise(res => {
      const m = document.createElement('div'); m.className = 'modal';
      m.innerHTML = `<div class="dlg"><h3>${esc(title)}</h3><p>${esc(text)}</p><div class="row"></div></div>`;
      const row = m.querySelector('.row');
      buttons.forEach((b, i) => {
        const e = document.createElement('button'); e.textContent = b.label; if (b.main) e.className = 'main';
        e.onclick = () => { m.remove(); res(b.value ?? i); }; row.appendChild(e);
      });
      $('layer').appendChild(m);
      (row.querySelector('.main') || row.firstChild).focus();
    });
  }
  const alertBox = (title, text) => dialog(title, text, [{ label: 'Aceptar', main: true }]);
  function closeMenus() { document.querySelectorAll('.menu,.pop').forEach(e => e.remove()); }
  addEventListener('mousedown', e => { if (!e.target.closest('.menu,.pop,#open,#bprefs')) closeMenus(); });

  // ---------- noticias ----------
  function renderNews(list) {
    const box = $('news');
    if (!Array.isArray(list) || !list.length) { box.innerHTML = '<div class="empty">No se pudieron cargar las novedades.</div>'; return; }
    box.innerHTML = list.map(n => {
      const t = String(n.titulo || ''), mm = t.match(/^(.*\S)\s+([0-9][0-9.]*)$/);
      const title = mm ? `${esc(mm[1])} <i>${esc(mm[2])}</i>` : esc(t);
      return `<div class="item"><div class="t"><div>${title}</div><span>${esc(n.fecha)}</span></div><p>${esc(n.texto).replace(/\n/g, '<br>')}</p></div>`;
    }).join('');
  }

  // ---------- comprobar / actualizar / jugar ----------
  async function check(quiet) {
    if (checking || busy) return;
    checking = true; btn(bCheck, false);
    if (!quiet) { plan = null; btn(bUpdate, false); btn(bPlay, false); bUpdate.classList.remove('on'); setStatus('Comprobando actualizaciones…'); setBar(1, 'busy'); }
    try {
      const r = await L.check();
      if (r.busy) return;
      if (quiet && plan && plan.upToDate === r.upToDate && plan.version === r.version) { renderNews(r.news); return; }
      plan = r; renderNews(r.news);
      if (r.upToDate) { setStatus('Todo al día · versión ' + r.version); setBar(1); btn(bPlay, true); btn(bUpdate, false); bUpdate.classList.remove('on'); }
      else {
        setStatus(`Actualización disponible · ${r.files} archivo(s), ${r.size}` + (r.deletions.length ? `, ${r.deletions.length} a quitar` : ''));
        setBar(0); btn(bUpdate, true); bUpdate.classList.add('on'); btn(bPlay, false);
      }
    } catch (e) {
      if (!quiet) { setStatus('No se pudo comprobar. ¿Tienes internet?'); setBar(0); btn(bUpdate, false); }
    } finally { checking = false; btn(bCheck, !busy); }
  }

  async function update() {
    if (!plan || busy) return;
    if (plan.deletions.length) {
      const names = plan.deletions.slice(0, 8).map(n => '  • ' + n).join('\n') + (plan.deletions.length > 8 ? `\n  … y ${plan.deletions.length - 8} más` : '');
      const ok = await dialog('Mods que se quitan', `En esta instancia hay ${plan.deletions.length} mod(s) que no son del modpack y se quitarán:\n${names}`,
        [{ label: 'Cancelar', value: false }, { label: 'Continuar', value: true, main: true }]);
      if (!ok) return;
    }
    busy = true; btn(bUpdate, false); btn(bCheck, false); btn(bPlay, false); bUpdate.classList.remove('on'); setBar(0);
    const r = await L.update();
    busy = false; btn(bCheck, true);
    if (r.ok) { plan = { ...plan, upToDate: true, deletions: [] }; setStatus('Todo al día · versión ' + r.version); setBar(1); btn(bPlay, true); }
    else { setStatus('Error al actualizar'); await alertBox('No se pudo actualizar', r.error || 'Error desconocido'); btn(bUpdate, true); bUpdate.classList.add('on'); }
  }
  L.onProgress(p => { if (busy || p.neoforge) { setStatus(p.text); setBar(p.frac); } });

  async function play() {
    btn(bPlay, false);
    const r = await L.play();
    btn(bPlay, true);
    if (r.status) setStatus(r.status);
    if (r.status && /NeoForge/.test(r.status)) setBar(0);
    if (r.error) await alertBox(info.pack || 'Derisomod', r.error);
    if (r.info) await alertBox(info.pack || 'Derisomod', r.info);
    if (r.noLauncher) noLauncher();
    if (!r.error && !r.info && !r.noLauncher && plan && plan.upToDate) setBar(1);
  }

  // ---------- dónde se instala (Se abre con…) ----------
  async function targetMenu() {
    if (document.querySelector('.menu')) { closeMenus(); return; }
    const t = await L.targets();
    const m = document.createElement('div'); m.className = 'menu';
    const item = (text, fn, cls) => { const d = document.createElement('div'); d.textContent = text; if (cls) d.className = cls; if (fn) d.onclick = () => { closeMenus(); fn(); }; m.appendChild(d); };
    for (const x of t.list) item(x.label, async () => { setTargetLabel(await L.chooseTarget(x)); check(); }, x.current ? 'cur' : '');
    m.appendChild(document.createElement('hr'));
    if (t.modrinth) item('＋ Crear perfil en Modrinth', () => createInstance('MODRINTH'));
    if (t.prism) item('＋ Crear instancia en Prism', () => createInstance('PRISM'));
    item('Otra carpeta…', async () => { const r = await L.chooseFolder(); if (r) { setTargetLabel(r); check(); } });
    document.body.appendChild(m);
  }
  async function createInstance(kind) {
    const app = kind === 'MODRINTH' ? 'Modrinth' : 'Prism';
    btn(bUpdate, false); btn(bPlay, false);
    setStatus(`Preparando la instancia para ${app}…`); setBar(1, 'busy');
    const r = await L.createInstance(kind);
    if (!r.ok) { setBar(0); await alertBox(app, `No se pudo abrir ${app}. Comprueba que está instalado.`); check(); return; }
    setStatus(`Confirma la instalación en ${app}… este launcher la detectará solo.`);
  }
  L.onInstanceCreated(t => { setTargetLabel(t); check(); });
  L.onInstanceTimeout(() => { setBar(0); setStatus('No apareció la instancia. Elígela en "Se abre con" cuando esté creada.'); });
  L.onTarget(setTargetLabel);

  // ---------- primera vez ----------
  async function noLauncher() {
    const r = await dialog('Falta un launcher de Minecraft',
      'Para jugar necesitas un launcher de Minecraft y no hay ninguno en este PC.\n\nInstala uno (y entra con tu cuenta de Microsoft). Cuando termine, este launcher seguirá solo.',
      [{ label: 'Cancelar', value: 0 }, { label: 'Launcher oficial', value: 2 }, { label: 'Instalar Modrinth (recomendado)', value: 1, main: true }]);
    if (r === 1) L.openExternal('https://modrinth.com/app');
    if (r === 2) L.openExternal('https://www.minecraft.net/download');
    setStatus('Esperando a que instales un launcher de Minecraft…');
    L.waitForLauncher();
  }
  L.onLauncherInstalled(async a => { info.apps = a; await firstRun(true); });
  async function firstRun(force) {
    const a = info.apps || {};
    if (!(force || info.firstTime) || (info.target && info.target.kind !== 'OFFICIAL')) return false;
    if (!a.modrinth && !a.prism && !a.official) { noLauncher(); return true; }
    if (!a.modrinth && !a.prism) return false;
    const opts = [];
    if (a.modrinth) opts.push({ label: 'Modrinth', value: 'MODRINTH', main: true });
    if (a.prism) opts.push({ label: 'Prism', value: 'PRISM', main: !a.modrinth });
    opts.push({ label: 'Launcher oficial', value: 'OFFICIAL' });
    const r = await dialog('¿Con qué launcher juegas?', `Se creará la instancia de ${info.pack} con NeoForge ya instalado; no tienes que configurar nada.`, opts.reverse());
    if (r === 'OFFICIAL') { await L.keepOfficial(); return false; }
    createInstance(r); return true;
  }

  // ---------- música del menú (bucle sin cortes) ----------
  const MUSIC = 'media/musica_menu_bucle.ogg', MUSIC_AT = 52.6;
  let actx, gain, musicVol = 1, muted = false;
  async function startMusic(fadeIn) {
    try {
      actx = actx || new AudioContext();
      const buf = await actx.decodeAudioData(await (await fetch(MUSIC)).arrayBuffer());
      const src = actx.createBufferSource(); src.buffer = buf; src.loop = true;
      gain = actx.createGain(); src.connect(gain).connect(actx.destination);
      const v = muted ? 0 : musicVol;
      if (fadeIn) { gain.gain.setValueAtTime(0, actx.currentTime); gain.gain.linearRampToValueAtTime(v, actx.currentTime + 1.5); } else gain.gain.value = v;
      src.start(0, MUSIC_AT % buf.duration);
    } catch { /* sin música (p. ej. si falta el archivo) */ }
  }
  function applyVolume() { if (gain && actx) gain.gain.setTargetAtTime(muted ? 0 : musicVol, actx.currentTime, .15); $('bmute').style.opacity = muted ? .45 : 1; }
  $('bmute').onclick = () => { muted = !muted; L.setPref('musicMuted', muted); applyVolume(); };

  // ---------- ajustes ----------
  $('bprefs').onclick = () => {
    if (document.querySelector('.pop')) { closeMenus(); return; }
    const p = document.createElement('div'); p.className = 'pop';
    p.innerHTML = `<label><input type="checkbox" id="pintro"> Ver la intro cada vez que abro el launcher</label>
      <label>Volumen <input type="range" id="pvol" min="0" max="1" step="0.05" style="width:200px;height:auto"></label>
      <a id="preplay">Ver la intro ahora</a>`;
    document.body.appendChild(p);
    const ci = p.querySelector('#pintro'), pv = p.querySelector('#pvol');
    ci.checked = !!info.introAlways; pv.value = musicVol;
    ci.onchange = () => { info.introAlways = ci.checked; L.setPref('introAlways', ci.checked); };
    pv.oninput = () => { musicVol = +pv.value; L.setPref('volume', musicVol); applyVolume(); };
    p.querySelector('#preplay').onclick = () => { closeMenus(); sessionStorage.setItem('forceIntro', '1'); location.reload(); };
  };

  // ---------- intro ----------
  const INTRO = 'media/intro_launcher.webm';
  function reveal(skipped) {
    if (revealed) return; revealed = true;
    window.sceneStart && window.sceneStart(); window.reyStart && window.reyStart();
    startMusic(skipped);
    const intro = $('intro'), fade = $('fade');
    if (!intro.classList.contains('hide')) {
      const v = $('introv');
      if (skipped) {   // fundido a negro de 0,4 s y luego el launcher
        v.style.opacity = 0;
        setTimeout(() => { v.pause(); intro.style.opacity = 0; setTimeout(() => intro.classList.add('hide'), 350); }, 400);
      } else { intro.style.opacity = 0; setTimeout(() => { v.pause(); intro.classList.add('hide'); }, 350); }
    }
    fade.style.opacity = 0;
    afterReveal();
  }
  function playIntro() {
    const intro = $('intro'), v = $('introv');
    intro.classList.remove('hide'); $('fade').style.opacity = 0;
    v.src = INTRO; v.volume = muted ? 0 : musicVol;
    v.onended = () => reveal(false);
    v.onerror = () => reveal(true);
    v.play().catch(() => reveal(true));
    intro.onclick = () => reveal(true);
    addEventListener('keydown', e => { if (e.key === 'Escape' && !revealed) reveal(true); });
    L.setPref('introSeenVersion', info.version);
  }
  async function afterReveal() {
    await new Promise(r => setTimeout(r, 600));
    const started = await firstRun(false);
    if (!started) check();
    if (info.updateReady) launcherReady(info.updateReady);
  }

  // ---------- launcher nuevo descargado ----------
  async function launcherReady(version) {
    const b = $('banner'); b.textContent = `Launcher ${version} listo · reiniciar para usarlo`; b.classList.remove('hide');
    b.onclick = () => L.restartToUpdate();
    if (busy) return;
    const r = await dialog('Launcher nuevo', `Se ha descargado el launcher ${version}.\n¿Reiniciar ahora para usarlo?`,
      [{ label: 'Más tarde', value: false }, { label: 'Reiniciar', value: true, main: true }]);
    if (r) L.restartToUpdate();
  }
  L.onLauncherUpdate(u => { info.updateReady = u.version; if (revealed) launcherReady(u.version); });

  // ---------- botones ----------
  bCheck.onclick = () => check(false);
  bUpdate.onclick = update;
  bPlay.onclick = play;
  $('bfolder').onclick = () => L.openFolder();
  $('open').onclick = targetMenu;
  $('wmin').onclick = () => L.minimize();
  $('wclose').onclick = () => L.close();
  setInterval(() => { if (revealed && !busy && !checking && plan) check(true); }, 10 * 60000);

  // ---------- arranque ----------
  (async () => {
    info = await L.init();
    $('ver').textContent = 'launcher ' + info.version;
    setTargetLabel(info.target);
    muted = !!info.musicMuted; musicVol = isFinite(info.volume) ? info.volume : 1; applyVolume();
    btn(bCheck, false);
    const force = sessionStorage.getItem('forceIntro'); sessionStorage.removeItem('forceIntro');
    const sel = new URLSearchParams(location.search).get('selftest');
    if (!sel && (force || info.introAlways || !info.introSeen)) playIntro(); else reveal(true);
  })();

  // ganchos para la prueba automática (solo con --selftest)
  window.__ui = { reveal, check: () => check(false), status: () => statusEl.textContent, playIntro, dialog };
})();
