// Prueba automática (Action "Probar launcher"): arranca la app de verdad, saca capturas y prueba la lógica.
// electron . --selftest   (SELFTEST_OUT = carpeta de resultados)
'use strict';
const { app } = require('electron');
const path = require('path');
const fsp = require('fs/promises');
const os = require('os');

module.exports = async function selftest(win, { core, ipc }) {
  const out = process.env.SELFTEST_OUT || path.join(os.tmpdir(), 'selftest');
  await fsp.mkdir(out, { recursive: true });
  const log = [];
  const say = (...a) => { const s = a.join(' '); log.push(s); console.log(s); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const js = code => win.webContents.executeJavaScript(code, true);
  const shot = async name => { const img = await win.webContents.capturePage(); await fsp.writeFile(path.join(out, name + '.png'), img.toPNG()); say('captura', name); };
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) say('[pagina]', msg); });
  win.webContents.on('render-process-gone', (_e, d) => say('RENDER CAIDO', JSON.stringify(d)));
  let ok = true;
  const step = async (name, fn) => { try { await fn(); say('OK   ', name); } catch (e) { ok = false; say('FALLO', name, '-', e && e.stack || e); } };
  try {
    say('versiones', JSON.stringify({ electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome }));
    await new Promise(r => win.webContents.once('did-finish-load', r));
    win.setSize(1880, 1040); win.center();
    await wait(8000);
    // el PC de pruebas no tiene launcher de Minecraft: fuera el aviso de primera vez para las capturas
    await shot('0_primera_vez'); await js("document.querySelectorAll('.modal').forEach(m=>m.remove())"); await wait(500);
    await step('interfaz', async () => { await shot('1_launcher'); say('estado:', await js('window.__ui.status()')); });
    await step('rey agujero negro', async () => { await js('window.REY_M=1'); await wait(2500); await shot('2_rey_agujero'); await js('window.REY_M=0.6'); await wait(2500); await shot('3_rey_cambio'); await js('window.REY_M=null'); });
    await step('menu se abre con', async () => { await js("document.getElementById('open').click()"); await wait(1500); await shot('4_menu'); await js("document.querySelector('.menu')&&document.querySelector('.menu').remove()"); });
    await step('aviso', async () => { js("window.__ui.dialog('¿Con qué launcher juegas?','Se creará la instancia de Derisomod con NeoForge ya instalado; no tienes que configurar nada.',[{label:'Launcher oficial'},{label:'Modrinth',main:true}])"); await wait(1200); await shot('5_aviso'); await js("document.querySelector('.modal')&&document.querySelector('.modal').remove()"); });
    await step('archivos de la intro', async () => { const d = path.join(__dirname, 'renderer', 'media'); for (const f of await fsp.readdir(d)) say('  media:', f, (await fsp.stat(path.join(d, f))).size); });
    await step('intro', async () => {
      await js("{document.getElementById('intro').classList.remove('hide');document.getElementById('intro').style.opacity=1;const v=document.getElementById('introv');v.style.opacity=1;v.src='media/intro_launcher.webm';v.play().then(()=>{v.currentTime=20})}");
      await wait(3000); await shot('6_intro');
      const diag = await js(`(async()=>{const v=document.getElementById('introv');const out=[];
        const meas=()=>{const c=document.createElement('canvas');c.width=160;c.height=90;const g=c.getContext('2d');g.drawImage(v,0,0,160,90);const d=g.getImageData(0,0,160,90).data;let s=0;for(let i=0;i<d.length;i+=4)s+=(d[i]+d[i+1]+d[i+2])/3;return Math.round(s/(d.length/4));};
        for(const t of [10,30,55]){v.currentTime=t;await new Promise(r=>{v.onseeked=r;setTimeout(r,4000)});await new Promise(r=>setTimeout(r,400));
          const q=v.getVideoPlaybackQuality();out.push({t:+v.currentTime.toFixed(1),lum:meas(),rs:v.readyState,w:v.videoWidth,dec:q.totalVideoFrames,err:v.error&&v.error.message});}
        return out;})()`);
      say('fotogramas (original: 10 s ~23, 30 s ~45, 55 s ~40):', JSON.stringify(diag));
      if (!diag.some(d => d.lum > 5)) throw new Error('el vídeo no se ve (fotogramas negros)');
      await js("{const v=document.getElementById('introv');v.currentTime=30}"); await wait(1500); await shot('6b_intro_30s'); say('intro reproduciendo:', await js("!document.getElementById('introv').paused && document.getElementById('introv').currentTime"));
      await js("{const v=document.getElementById('introv');v.currentTime=55.3;}"); await wait(1500); await shot('7_intro_final');
      say('salto al final:', await js("document.getElementById('introv').currentTime")); await js("{const v=document.getElementById('introv');v.pause();document.getElementById('intro').classList.add('hide')}");
    });
    await step('musica', async () => { const d = await js("fetch('media/musica_menu_bucle.ogg').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.arrayBuffer()}).then(b=>new AudioContext().decodeAudioData(b)).then(a=>a.duration).catch(e=>'ERROR '+e.message)"); say('musica decodificada (s):', d); if (typeof d !== 'number') throw new Error(String(d)); });
    await step('node:sqlite', async () => { const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(':memory:'); say('sqlite', d.prepare('select sqlite_version() v').get().v); d.close(); });
    await step('mrpack', async () => { say(await core.buildMrpack({ version: 't', minecraft: '1.21.1', neoforge: '21.1.262' })); });
    await step('modpack real (comprobar + descargar + volver a comprobar)', async () => {
      const dir = path.join(os.tmpdir(), 'derisomod-selftest-game');
      await fsp.rm(dir, { recursive: true, force: true });
      const m = await core.fetchManifest(); say('manifest', m.version, 'commit', m.commit);
      let p = await core.plan(dir, m); say('plan', p.downloads.length, 'archivos', (p.bytes / 1048576).toFixed(1), 'MB');
      await core.apply(dir, p, () => {});
      p = await core.plan(dir, m); if (!core.upToDate(p)) throw new Error('tras descargar no está al día');
    });
    await step('comprobar desde la interfaz', async () => { await js('window.__ui.check()'); await wait(4000); say('estado:', await js('window.__ui.status()')); await shot('8_comprobado'); });
  } catch (e) { ok = false; say('FALLO GENERAL', e && e.stack || e); }
  say(ok ? 'RESULTADO: OK' : 'RESULTADO: FALLOS');
  await fsp.writeFile(path.join(out, 'resultado.txt'), log.join('\n') + '\n');
  app.exit(ok ? 0 : 1);
};
