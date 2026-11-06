// La transición intro → launcher, en directo (de transicion/transicion.html de la pestaña de la intro, aprobada):
// la estrella cae al tablero, la luz sube por las formas y se forma el rey. Antes era vídeo de 720p; aquí se dibuja
// a 1880x1040 y la parte pesada (la luz que recorre cada píxel) la hace la tarjeta gráfica con el mismo cálculo.
// La interfaz del final ya no es una imagen: al acabar aparece la interfaz real.
(function () {
  const W = 1880, H = 1040, DUR = 5.4, TI = 1.25;
  const S0 = [940, 520], IMP = [945, 831], CROWN = [945, 614];   // CROWN: la estrella acaba dentro de la corona del rey nuevo
  const cl = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)), ss = (a, b, v) => { const t = cl((v - a) / (b - a)); return t * t * (3 - 2 * t); }, ease = t => t * t * (3 - 2 * t);
  const front = t => t < TI ? -1 : 1.18 * (1 - Math.exp(-(t - TI) * 1.6)) / (1 - Math.exp(-1.6 * 1.7));
  const frontR = t => t < TI + .1 ? -1 : 1.1 * ease(cl((t - TI - .1) / .9));
  const NAMES = ['intro_final', 'capa_cielo', 'capa_seres', 'capa_bordes', 'capa_rey', 'capa_rey_brillo', 'capa_neb', 'dist_seres', 'dist_rey', 'bordes_rey', 'ruido'];
  const IM = {};
  const load = n => new Promise((r, j) => { const i = new Image(); i.onload = () => { IM[n] = i; r(); }; i.onerror = j; i.src = 'transicion/' + n + '.png'; });
  let ready = null;

  // ----- la parte por píxel, en la tarjeta gráfica -----
  const FS = `precision highp float;
  uniform sampler2D C, S, N, B, D, RU, R, DR, BR;
  uniform float f, fr, Lc, Ls, Lr, on;
  float ss(float a, float b, float v){ float t = clamp((v - a) / (b - a), 0., 1.); return t*t*(3. - 2.*t); }
  void main(){
    vec2 px = vec2(gl_FragCoord.x - .5, ${H}. - gl_FragCoord.y - .5);   // coordenadas de arriba abajo, como en el canvas
    vec2 uv = (px + .5) / vec2(${W}., ${H}.);
    if (on < .5) { gl_FragColor = vec4(0., 0., 0., 1.); return; }
    vec3 col = texture2D(C, uv).rgb * Lc;                                 // cielo
    vec4 s = texture2D(S, uv);
    float dv = texture2D(D, uv).r * 1.2 + (texture2D(RU, uv).r - .5) * .16;
    float rev = ss(0., .16, f - dv), sa = s.a * rev;
    if (sa > 0.) {                                                         // seres y tablero
      float k = .07 + .93 * Ls; col = col * (1. - sa) + s.rgb * k * sa;
      float nk = Ls * rev; if (nk > 0.) { vec3 n = texture2D(N, uv).rgb; col = 1. - (1. - col) * (1. - n * nk); }
    }
    vec3 tint;                                                             // color del contorno: arcoíris a la izquierda, azul a la derecha
    if (px.x < 836.) {
      float hh = fract(atan(px.y - 1500., px.x - 330.) / 6.2831853 * 5. + length(px - vec2(330., 1500.)) / 1400.);
      vec3 c = clamp(abs(fract(vec3(hh) + vec3(0., 2./3., 1./3.)) * 6. - 3.) - 1., 0., 1.);
      tint = .55 + .45 * c;
    } else { float k = .5 + .5 * sin(px.y / 90. + px.x / 140.); tint = vec3(.45 + .25*k, .65 + .25*k, 1.); }
    float e = texture2D(B, uv).a;
    if (e > 0. && dv < f + .03) { float fg = exp(-pow((f - dv) / .045, 2.)); float ec = e * (fg * 1.7 + rev * (.5 * (1. - Ls) + .12)); col += tint * ec; }
    vec4 r = texture2D(R, uv); float br = texture2D(BR, uv).a;
    if (r.a > 0. || br > 0.) {                                             // el rey: contorno que sube y se llena de blanco
      float dr = texture2D(DR, uv).r * 1.2, rr = clamp((fr - dr) / .04, 0., 1.), aa = r.a * rr;
      col = col * (1. - aa) + r.rgb * Lr * aa + vec3(8., 14., 40.) / 255. * aa * (1. - Lr);
      if (br > 0. && dr < fr + .03) { float fg = exp(-pow((fr - dr) / .05, 2.)); float ec = br * (fg * 1.8 + rr * .7 * (1. - Lr)); col += vec3(150., 200., 255.) / 255. * ec; }
    }
    gl_FragColor = vec4(min(col, 1.), 1.);
  }`;
  let gl, glcv, U = {};
  function setupGL() {
    glcv = document.createElement('canvas'); glcv.width = W; glcv.height = H;
    gl = glcv.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }'));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const al = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(al); gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const tex = { C: 'capa_cielo', S: 'capa_seres', N: 'capa_neb', B: 'capa_bordes', D: 'dist_seres', RU: 'ruido', R: 'capa_rey', DR: 'dist_rey', BR: 'bordes_rey' };
    Object.entries(tex).forEach(([u, n], i) => {
      const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, IM[n]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(pr, u), i);
    });
    for (const u of ['f', 'fr', 'Lc', 'Ls', 'Lr', 'on']) U[u] = gl.getUniformLocation(pr, u);
    gl.viewport(0, 0, W, H);
  }

  // ----- lo demás (estrella, destello, brillo, rey), igual que en transicion.html -----
  let cv, x;
  function star(px, py, s, a) {
    x.save(); x.globalCompositeOperation = 'lighter'; x.globalAlpha = a;
    let g = x.createRadialGradient(px, py, 0, px, py, 120 * s); g.addColorStop(0, 'rgba(120,170,255,.6)'); g.addColorStop(.3, 'rgba(50,110,240,.2)'); g.addColorStop(1, 'rgba(20,50,200,0)'); x.fillStyle = g; x.fillRect(px - 120 * s, py - 120 * s, 240 * s, 240 * s);
    for (const [an, L, w] of [[0, 150, 2.4], [Math.PI / 2, 105, 2.4], [Math.PI / 4, 26, 1.4], [-Math.PI / 4, 26, 1.4]]) {
      x.save(); x.translate(px, py); x.rotate(an); const gl2 = x.createLinearGradient(-L * s, 0, L * s, 0); gl2.addColorStop(0, 'rgba(140,190,255,0)'); gl2.addColorStop(.5, 'rgba(245,250,255,1)'); gl2.addColorStop(1, 'rgba(140,190,255,0)'); x.fillStyle = gl2; x.fillRect(-L * s, -w * s / 2, 2 * L * s, w * s); x.restore();
    }
    g = x.createRadialGradient(px, py, 0, px, py, 12 * s); g.addColorStop(0, '#fff'); g.addColorStop(.35, 'rgba(225,240,255,.95)'); g.addColorStop(1, 'rgba(140,190,255,0)'); x.fillStyle = g; x.fillRect(px - 14 * s, py - 14 * s, 28 * s, 28 * s); x.restore();
  }
  function frame(t) {
    const f = front(t), fr = frontR(t), Ls = ss(TI + .9, TI + 2.1, t), Lc = ss(TI + .5, TI + 2.1, t), Lr = ss(TI + .85, TI + 1.5, t);
    gl.uniform1f(U.f, f); gl.uniform1f(U.fr, fr); gl.uniform1f(U.Ls, Ls); gl.uniform1f(U.Lc, Lc); gl.uniform1f(U.Lr, Lr); gl.uniform1f(U.on, t >= TI ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    x.drawImage(glcv, 0, 0);
    // 1) el final de la intro se apaga mientras la estrella empieza a caer
    const fa = 1 - ss(.15, .9, t); if (fa > 0) { x.globalAlpha = fa; x.drawImage(IM.intro_final, 0, 0, W, H); x.globalAlpha = 1; }
    // 2) el impacto: destello que se aplasta contra el tablero
    const fl = t > TI ? Math.exp(-(t - TI) * 5) : 0;
    if (fl > .01) { x.save(); x.globalCompositeOperation = 'lighter'; x.translate(IMP[0], IMP[1]); x.scale(1, .35); const g = x.createRadialGradient(0, 0, 0, 0, 0, 600); g.addColorStop(0, `rgba(235,245,255,${fl})`); g.addColorStop(.25, `rgba(120,170,255,${.45 * fl})`); g.addColorStop(1, 'rgba(40,90,255,0)'); x.fillStyle = g; x.fillRect(-600, -600, 1200, 1200); x.restore(); }
    // 3) detrás del rey se abre el brillo; el rey va delante
    const kb = ss(TI + .8, TI + 1.8, t);
    if (kb > 0) {
      x.save(); x.globalCompositeOperation = 'lighter'; x.globalAlpha = kb; const s = .6 + .4 * ease(kb); x.translate(945, 660); x.scale(s, s); x.translate(-945, -660); x.drawImage(IM.capa_rey_brillo, 0, 0); x.restore();
      if (t >= TI) { x.save(); x.globalAlpha = Lr; x.drawImage(IM.capa_rey, 0, 0); x.restore(); }
    }
    // 4) la estrella: cae, toca, sube con el contorno del rey y se queda en la corona
    let px, py;
    if (t < TI) { const k = ss(.3, TI, t), k2 = Math.pow(cl((t - .3) / (TI - .3)), 2.2); px = S0[0] + (IMP[0] - S0[0]) * k; py = S0[1] + (IMP[1] - S0[1]) * k2; }
    else { const k = cl(fr / 1.0); px = IMP[0] + (CROWN[0] - IMP[0]) * k; py = IMP[1] + (CROWN[1] - IMP[1]) * k; }
    const sz = t < TI ? 1.1 : 1.1 - .55 * cl(fr), sa = 1 - ss(TI + 1.1, TI + 1.5, t);
    if (t < TI) {
      x.save(); x.globalCompositeOperation = 'lighter';
      for (let i = 1; i < 14; i++) { const tt = Math.max(0, t - i * .025), k = ss(.3, TI, tt), k2 = Math.pow(cl((tt - .3) / (TI - .3)), 2.2); const qx = S0[0] + (IMP[0] - S0[0]) * k, qy = S0[1] + (IMP[1] - S0[1]) * k2;
        x.globalAlpha = (1 - i / 14) * .35 * ss(.4, .8, t); const g = x.createRadialGradient(qx, qy, 0, qx, qy, 18); g.addColorStop(0, 'rgba(200,225,255,1)'); g.addColorStop(1, 'rgba(80,140,255,0)'); x.fillStyle = g; x.fillRect(qx - 18, qy - 18, 36, 36); }
      x.restore();
    }
    if (sa > 0) star(px, py, sz * (t >= TI && t < TI + .12 ? 1 + .6 * Math.exp(-(t - TI) * 20) : 1), sa);
  }

  /** Prepara las capas (se llama al abrir). */
  window.transPrepare = () => ready || (ready = Promise.all(NAMES.map(load)).then(() => {
    cv = document.getElementById('trans'); x = cv.getContext('2d'); setupGL(); frame(0);
  }));
  /**
   * Reproduce la transición. speed: 1 = como en la intro, 1,4 = la versión corta.
   * onUi(): cuando debe empezar a salir la interfaz real; onEnd(): al acabar.
   */
  window.transPlay = async (speed, onUi, onEnd, start = 0) => {
    await window.transPrepare();
    cv.classList.remove('hide'); cv.style.opacity = 1;
    // el tiempo avanza por fotogramas (como mucho 1/20 s cada uno): en un PC lento va más despacio en vez de saltarse trozos
    let last = null, tt = start, uiDone = false; skip = false;
    const step = now => {
      if (last !== null) tt += Math.min(.05, (now - last) / 1000) * speed; last = now;
      const t = skip ? DUR : Math.min(DUR, tt);
      frame(t);
      if (!uiDone && t >= TI + 2.3) { uiDone = true; onUi && onUi(skip); }   // la interfaz tarda 1 s (de transición) en salir
      if (t < DUR) requestAnimationFrame(step);
      else { cv.style.opacity = 0; setTimeout(() => cv.classList.add('hide'), 400); onEnd && onEnd(); }
    };
    requestAnimationFrame(step);
  };
  let skip = false;
  /** Salta al final (clic o Esc). */
  window.transSkip = () => { skip = true; };
  window.transFrame = t => { frame(t); };   // para las pruebas
  window.TRANS_DUR = DUR;
})();
