// El rey del tablero (dibujo del usuario, de transicion/rey2.html) en vivo, con su ciclo:
// estrella (pieza blanca, borde y brillo azul) ↔ agujero negro (pieza negra con tonos rgb claro, borde y brillo arcoíris).
// Intermedia aprobada "d": primero cambian los brillos (0–35 %) y luego la pieza desde el centro (35–100 %); al volver, al revés.
// Las coordenadas son las de la ventana de 1880x1040 con el parallax en reposo; el lienzo va en la capa del tablero
// (data-d="34") para moverse con ella.
(function () {
  const cv = document.getElementById('rey');
  const ctx = cv.getContext('2d');
  const K = .85, CX = 945, BY = 831, TOP = 580, LX = 945, LY = BY - (BY - 660) * K, SX = 945, SY = 592;
  const STAR = 20, CHANGE = 3;                      // segundos en cada estado y en cada cambio (propuesta, no decidido)
  const cl = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)), ss = (a, b, v) => { const t = cl((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const pool = {};
  const mk = key => { let c = pool[key]; if (!c) { c = pool[key] = document.createElement('canvas'); c.width = 1880; c.height = 1040; }
    const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.filter = 'none'; g.clearRect(0, 0, 1880, 1040); return c; };
  let TT = 0, x = null;
  function rgbConic(c, cx, cy, a = 1, l = 80) { const g = c.createConicGradient(TT * .35, cx, cy); for (let i = 0; i <= 12; i++) g.addColorStop(i / 12, `hsla(${i * 30 + 200},100%,${l}%,${a})`); return g; }
  function glow(t) {
    x.save(); x.globalCompositeOperation = 'lighter'; const s = 2.6, Rr = 170 * s; const o = mk('glow'), g2 = o.getContext('2d');
    let g = g2.createRadialGradient(LX, LY, 0, LX, LY, Rr); g.addColorStop(0, 'rgba(140,190,255,.85)'); g.addColorStop(.12, 'rgba(80,140,255,.5)'); g.addColorStop(.4, 'rgba(40,90,230,.18)'); g.addColorStop(1, 'rgba(20,50,200,0)');
    if (t) { g2.fillStyle = rgbConic(g2, LX, LY, 1, 82); g2.fillRect(0, 0, 1880, 1040); const m = g2.createRadialGradient(LX, LY, 0, LX, LY, Rr); m.addColorStop(0, 'rgba(0,0,0,.9)'); m.addColorStop(.12, 'rgba(0,0,0,.5)'); m.addColorStop(.4, 'rgba(0,0,0,.16)'); m.addColorStop(1, 'rgba(0,0,0,0)'); g2.globalCompositeOperation = 'destination-in'; g2.fillStyle = m; g2.fillRect(0, 0, 1880, 1040); }
    else { g2.fillStyle = g; g2.fillRect(0, 0, 1880, 1040); }
    x.drawImage(o, 0, 0);
    for (const [ang, L, w] of [[0, 190, 4], [Math.PI / 2, 140, 4], [Math.PI / 4, 55, 2.5], [-Math.PI / 4, 55, 2.5]]) {
      x.save(); x.translate(LX, LY); x.rotate(ang); const gl = x.createLinearGradient(-L * s, 0, L * s, 0);
      if (t) { for (let i = 0; i <= 10; i++) { const u = i / 10; gl.addColorStop(u, `hsla(${u * 300 + 200},100%,86%,${Math.pow(Math.sin(Math.PI * u), 3)})`); } }
      else { gl.addColorStop(0, 'rgba(140,190,255,0)'); gl.addColorStop(.5, 'rgba(245,250,255,1)'); gl.addColorStop(1, 'rgba(140,190,255,0)'); }
      x.fillStyle = gl; x.fillRect(-L * s, -w * s / 2, 2 * L * s, w * s); x.restore();
    }
    g = x.createRadialGradient(LX, LY, 0, LX, LY, 52); g.addColorStop(0, '#fff'); g.addColorStop(.3, t ? 'rgba(245,235,255,.95)' : 'rgba(230,242,255,.95)'); g.addColorStop(1, 'rgba(200,190,255,0)');
    x.fillStyle = g; x.fillRect(LX - 110, LY - 110, 220, 220); x.restore();
  }
  function star4(px, py, s, col, core, dark) {
    const rgb = col === 'rgb'; x.save();
    if (dark) { const d = x.createRadialGradient(px, py, 0, px, py, 26 * s); d.addColorStop(0, dark); d.addColorStop(1, 'rgba(20,60,220,0)'); x.fillStyle = d; x.fillRect(px - 26 * s, py - 26 * s, 52 * s, 52 * s); }
    x.globalCompositeOperation = 'lighter';
    if (rgb) { const o = mk('star'), c = o.getContext('2d'); c.fillStyle = rgbConic(c, px, py, 1, 80); c.fillRect(px - 32 * s, py - 32 * s, 64 * s, 64 * s); const m = c.createRadialGradient(px, py, 0, px, py, 30 * s); m.addColorStop(0, 'rgba(0,0,0,.85)'); m.addColorStop(1, 'rgba(0,0,0,0)'); c.globalCompositeOperation = 'destination-in'; c.fillStyle = m; c.fillRect(0, 0, 1880, 1040); x.drawImage(o, 0, 0); }
    else { const g = x.createRadialGradient(px, py, 0, px, py, 30 * s); g.addColorStop(0, col(.7)); g.addColorStop(1, col(0)); x.fillStyle = g; x.fillRect(px - 30 * s, py - 30 * s, 60 * s, 60 * s); }
    x.fillStyle = core; x.beginPath(); const V = 20 * s, H = 13 * s, w = 2.6 * s;
    x.moveTo(px, py - V); x.lineTo(px + w, py - w); x.lineTo(px + H, py); x.lineTo(px + w, py + w); x.lineTo(px, py + V * .8); x.lineTo(px - w, py + w); x.lineTo(px - H, py); x.lineTo(px - w, py - w); x.closePath();
    x.shadowColor = rgb ? 'rgba(0,0,0,0)' : col(1); x.shadowBlur = 10 * s; x.fill(); x.shadowBlur = 0; x.globalCompositeOperation = 'source-over';
    x.lineWidth = rgb ? 2.2 : 1.2; x.strokeStyle = rgb ? rgbConic(x, px, py, 1, 70) : (dark ? 'rgba(30,90,255,.9)' : col(1)); x.stroke(); x.restore();
  }
  const blueStar = a => `rgba(120,175,255,${a})`;
  // un estado entero (brillo + pieza) en el lienzo c; part = 'glow' | 'piece' | undefined (los dos)
  function state(c, hole, IMG, part, nostar) {
    const [WH, AL, BO] = IMG; const X = x; x = c;
    if (part != 'piece') glow(hole);
    if (part != 'glow') {
      x.save(); x.setTransform(x.getTransform().multiply(new DOMMatrix([K, 0, 0, K, CX * (1 - K), BY * (1 - K)])));
      if (!hole) { x.drawImage(WH, 0, 0); if (!nostar) star4(SX, SY - 2, 1.7, blueStar, '#ffffff', 'rgba(10,40,190,.95)'); }
      else {
        const P = mk('P'), p = P.getContext('2d'); p.fillStyle = '#010103'; p.fillRect(0, 0, 1880, 1040); p.globalCompositeOperation = 'lighter';
        for (let k = 0; k < 2; k++) { const off = (TT * .15 + k * .5) % 1; const g = p.createLinearGradient(CX - 60, BY, CX + 60, TOP); for (let i = 0; i <= 8; i++) { const u = i / 8; g.addColorStop(u, `hsla(${((u + off) * 360 + 200) % 360},85%,78%,${.05 * Math.pow(Math.sin(Math.PI * u), 2)})`); } p.fillStyle = g; p.fillRect(0, 0, 1880, 1040); }
        p.globalCompositeOperation = 'destination-in'; p.drawImage(AL, 0, 0); x.drawImage(P, 0, 0);
        const F = mk('F'), f = F.getContext('2d'); f.fillStyle = rgbConic(f, CX, (TOP + BY) / 2, 1, 76); f.fillRect(0, 0, 1880, 1040); f.globalCompositeOperation = 'destination-in'; f.drawImage(BO, 0, 0);
        x.save(); x.globalCompositeOperation = 'lighter'; x.drawImage(F, 0, 0); x.filter = 'blur(4px)'; x.globalAlpha = .5; x.drawImage(F, 0, 0); x.restore();
        if (!nostar) star4(SX, SY - 2, 1.7, 'rgb', '#020205', 'rgba(0,0,0,.9)');
      }
      x.restore();
    }
    x = X;
  }

  // Del espacio de la ventana (parallax en reposo) al del lienzo dentro de la capa del tablero:
  // la capa mide 1880x1058, está 9 px más arriba y en reposo tiene scale(1.0586) y translate(0, -3.7).
  const S = 1.045 + 34 * .0004, OY = -9, TY = -.18 * 34 * .6;
  const toLayer = new DOMMatrix([1 / S, 0, 0, 1 / S, 940 - 940 / S, 529 - (529 + OY + TY) / S]);

  let IMG = null, start = null, lastDraw = 0, lastM = -1;
  const load = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = s; });
  Promise.all(['rey_blanco.png', 'rey_alfa.png', 'rey_borde.png'].map(load)).then(a => { IMG = a; });

  /** Fase del ciclo: 0 = estrella, 1 = agujero negro. Empieza en estrella cuando se revela el launcher. */
  function phase(t) {
    const T = 2 * (STAR + CHANGE), u = ((t % T) + T) % T;
    if (u < STAR) return 0;
    if (u < STAR + CHANGE) return (u - STAR) / CHANGE;
    if (u < 2 * STAR + CHANGE) return 1;
    return 1 - (u - 2 * STAR - CHANGE) / CHANGE;
  }

  function draw(m) {
    x = ctx; x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height);
    x.setTransform(toLayer);
    if (m <= 0 || m >= 1) { state(x, m >= 1, IMG); return; }
    const gm = ss(0, .35, m), pm = cl((m - .35) / .65);
    // lo de la estrella no cambia con el tiempo: se dibuja una vez y se guarda
    if (!pool.G0ok) { state(mk('G0').getContext('2d'), false, IMG, 'glow'); state(mk('A').getContext('2d'), false, IMG, 'piece', true); pool.G0ok = true; }
    const G0 = pool.G0, A = pool.A, G1 = mk('G1');
    state(G1.getContext('2d'), true, IMG, 'glow');
    x.save(); x.globalAlpha = 1 - gm; x.drawImage(G0, 0, 0); x.globalAlpha = gm; x.drawImage(G1, 0, 0); x.restore();
    const B = mk('B'), O = mk('O');
    state(B.getContext('2d'), true, IMG, 'piece', true);
    const X0 = 840, Y0 = 540, WW = 210, HH = 300;
    const a = pool.Adata || (pool.Adata = A.getContext('2d').getImageData(X0, Y0, WW, HH)), b = B.getContext('2d').getImageData(X0, Y0, WW, HH), oc = O.getContext('2d'), o = oc.createImageData(WW, HH);
    for (let j = 0; j < HH; j++) for (let i = 0; i < WW; i++) {
      const q = (j * WW + i) * 4;
      const val = Math.min(1, Math.hypot((i - (CX - X0)) * 1.5, (j - (BY - (BY - TOP) * K * .5 - Y0))) / 150);
      const wB = ss(val - .04, val + .04, pm), e = pm > 0 && pm < 1 ? Math.exp(-Math.pow((val - pm) / .04, 2)) : 0;
      const aa = a.data[q + 3] / 255, ab = b.data[q + 3] / 255, al = aa * (1 - wB) + ab * wB;
      for (let k = 0; k < 3; k++) {
        let v = a.data[q + k] * aa * (1 - wB) + b.data[q + k] * ab * wB;
        if (e > 0 && Math.max(aa, ab) > 0) v += [220, 235, 255][k] * e * Math.max(aa, ab) * 1.1;
        o.data[q + k] = al > 0 ? Math.min(255, v / al) : 0;
      }
      o.data[q + 3] = Math.round(Math.min(1, al + (e > 0 ? e * Math.max(aa, ab) * .5 : 0)) * 255);
    }
    oc.putImageData(o, X0, Y0); x.drawImage(O, X0, Y0, WW, HH, X0, Y0, WW, HH);
    // la estrellita de la corona cambia con los brillos (primero)
    x.save(); x.setTransform(toLayer.multiply(new DOMMatrix([K, 0, 0, K, CX * (1 - K), BY * (1 - K)])));
    x.globalAlpha = 1 - gm; star4(SX, SY - 2, 1.7, blueStar, '#ffffff', 'rgba(10,40,190,.95)');
    x.globalAlpha = gm; star4(SX, SY - 2, 1.7, 'rgb', '#020205', 'rgba(0,0,0,.9)'); x.restore();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!IMG) return;
    const t = start == null ? 0 : (now - start) / 1000;
    TT = t;
    const m = window.REY_M != null ? window.REY_M : phase(t);
    // la estrella es fija: solo se redibuja al cambiar; el agujero y los cambios, a ~30 fps
    if (m === lastM && m === 0) return;
    if (now - lastDraw < 33) return;
    lastDraw = now; lastM = m;
    draw(m);
  }
  requestAnimationFrame(frame);
  window.reyStart = () => { start = performance.now(); lastM = -1; };   // al revelarse el launcher: arranca en estrella
})();
