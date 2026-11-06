// Animated clock: the neon face (numerals + rings) turns slowly, with neon hands, in perspective.
(function(){
const T0 = Number(new URLSearchParams(location.search).get('t') || 0);
const cv = document.getElementById('clock');
const gl = cv.getContext('webgl', {premultipliedAlpha: true, preserveDrawingBuffer: true});
const HI = CLOCK_HINV;
const FS = `
precision highp float;
uniform float T; uniform mat3 Hi; uniform vec2 R; uniform sampler2D face;
float seg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba)/dot(ba, ba), 0., 1.); return length(pa - ba*h); }
vec2 rot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }
float hand(vec2 p, float ang, float len, float back, float w){
  vec2 d = vec2(sin(ang), -cos(ang));            // 0 = 12 o'clock, clockwise
  float l = seg(p, -d*back, d*len);
  // arrow tip
  vec2 tip = d*len; vec2 n = vec2(-d.y, d.x);
  float t1 = seg(p, tip + d*26., tip - d*6. + n*16.), t2 = seg(p, tip + d*26., tip - d*6. - n*16.), t3 = seg(p, tip - d*6. + n*16., tip - d*6. - n*16.);
  return min(l, min(t1, min(t2, t3)));
}
void main(){
  vec2 sp = vec2(gl_FragCoord.x, R.y - gl_FragCoord.y);
  vec3 q = Hi * vec3(sp, 1.); vec2 p = q.xy/q.z - 500.;
  // face, turning slowly (one turn every 4 minutes)
  vec2 fp = rot(p, T*6.28318/240.) + 500.;
  vec4 f = (fp.x < 0. || fp.y < 0. || fp.x > 1000. || fp.y > 1000.) ? vec4(0.) : texture2D(face, fp/1000.);
  // el brillo de la esfera se apaga suave cerca del borde del cuadrado de la textura (antes se veía un corte recto)
  f *= smoothstep(0., 70., min(min(fp.x, fp.y), min(1000. - fp.x, 1000. - fp.y)));
  float pulse = .94 + .06*sin(T*1.6);
  vec3 col = f.rgb*f.a*pulse; float al = f.a;
  // hands: hour, minute, second (decorative speeds)
  float hA = T*6.28318/7200. + 1.2;
  float sec = floor(T), fr = fract(T);
  float stepA = sec + smoothstep(0., .12, fr) + .08*sin(clamp((fr-.12)/.25,0.,1.)*3.14159)*step(.12,fr);   // tick + tiny bounce
  float mA = stepA*6.28318/120. + 4.1;          // arrow hand: one tick per second, one turn every 2 minutes
  float sA = T*6.28318/60.;                     // thin hand: smooth, one turn per minute
  float dh = hand(p, hA, 255., 30., 9.), dm = hand(p, mA, 318., 40., 7.), ds = seg(p, -vec2(sin(sA), -cos(sA))*60., vec2(sin(sA), -cos(sA))*325.);
  float d = min(min(dh - 4.5, dm - 3.5), ds - 1.5);
  d = min(d, length(p) - 14.);
  float core = smoothstep(1.5, -.5, d);
  float g1 = exp(-max(d, 0.)/7.), g2 = exp(-max(d, 0.)/26.);
  float g3 = exp(-max(d, 0.)/60.);
  vec3 hc = vec3(.92, .97, 1.)*core + vec3(.3, .62, 1.)*g1*1.1 + vec3(.12, .35, 1.)*g2*.8 + vec3(.1,.3,1.)*g3*.35;
  float ha = clamp(core + g1*.9 + g2*.6 + g3*.3, 0., 1.);
  col = hc*pulse + col*(1. - core); al = clamp(al + ha*(1. - al), 0., 1.);
  gl_FragColor = vec4(col, al);
}`;
const VS = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }';
function S(t, s){ const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if(!gl.getShaderParameter(x, gl.COMPILE_STATUS)) console.log(gl.getShaderInfoLog(x)); return x; }
const pr = gl.createProgram(); gl.attachShader(pr, S(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, S(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
const al = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(al); gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);
gl.uniformMatrix3fv(gl.getUniformLocation(pr, 'Hi'), false, new Float32Array([HI[0][0],HI[1][0],HI[2][0], HI[0][1],HI[1][1],HI[2][1], HI[0][2],HI[1][2],HI[2][2]]));
gl.uniform2f(gl.getUniformLocation(pr, 'R'), cv.width, cv.height);
const uT = gl.getUniformLocation(pr, 'T');
let ready = false; const img = new Image(); img.src = 'clock_flat.png';
img.onload = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(gl.getUniformLocation(pr, 'face'), 0); ready = true; if (T0) draw(T0); };
function draw(t){ if(!ready) return; gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); gl.uniform1f(uT, t); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
const st = performance.now();
function frame(now){ draw(T0 || (now - st)/1000); if(!T0) requestAnimationFrame(frame); }
requestAnimationFrame(frame);
})();
