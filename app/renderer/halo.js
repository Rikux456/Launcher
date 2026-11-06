// Animated halo: same field as rings.py (strands = contour lines of a flowing field),
// so when two strands touch they merge. Drawn in the flat halo space, mapped by an inverse homography.
(function(){
const T0 = Number(new URLSearchParams(location.search).get('t') || 0);
const cv = document.getElementById('halo');
const gl = cv.getContext('webgl', {premultipliedAlpha: true, preserveDrawingBuffer: true});
const HI = HALO_HINV; // 3x3, screen(art px) -> flat px
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float T; uniform mat3 Hi; uniform vec2 R;
float h(vec2 p){ p = mod(p, 1024.); vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p, float s){ float v = 0., a = .5, t = 0.; for(int i = 0; i < 3; i++){ v += a*n(p + s); t += a; p = p*2. + vec2(7.,3.); a *= .5; } return v/t; }
float ss(float a, float b, float x){ return smoothstep(a, b, x); }
vec3 hsv(float h, float s, float v){ vec3 p = abs(fract(h + vec3(0., 2./3., 1./3.))*6. - 3.); return v*mix(vec3(1.), clamp(p - 1., 0., 1.), s); }
void main(){
  vec2 sp = vec2(gl_FragCoord.x, R.y - gl_FragCoord.y);
  vec3 q = Hi * vec3(sp, 1.); vec2 p = q.xy / q.z - 500.;
  float r = length(p), a = atan(p.y, p.x);
  float da = mod(a - 1.5708 + 3.14159, 6.28318) - 3.14159;
  float sq = pow(pow(abs(cos(a)), 4.) + pow(abs(sin(a)), 4.), -.25);
  float wob = 1. + .045*sin(3.*a + 1.1) + .03*sin(5.*a + 2.3) + .02*sin(9.*a + .5);
  float Rout = 420.*(.84 + .16*sq)*wob;
  float bw = 125.*(1. + .18*sin(4.*a + .7) + .1*sin(7.*a));
  float v = (Rout - r)/bw;
  float gap = ss(.42, .62, abs(da));
  float band = ss(-.2, -.1, v) * ss(1.2, 1.1, v) * gap;
  if(gap < .001 || v < -1. || v > 2.){ gl_FragColor = vec4(0.); return; }
  float along = (a + 3.14159 - T*.035)*420./190.;   // pattern turns around the ring
  // flowing field: slow drift along the ring + a looping evolution
  float th = T*.06;
  vec2 fl = vec2(cos(th), sin(th))*.6;
  float f = .55*v + .85*fbm(vec2(along*1.15, v*1.6) + fl, 11.) + .16*fbm(vec2(along*2.2, v*3.) - fl*1.5, 31.);
  float L = abs(fract(f*5.) - .5);
  float brk = fbm(vec2(along*1.6 + 40., .5), 51.);
  float keep = ss(-.12, .02, v + (brk - .5)*.25) * ss(1.12, .98, v - (brk - .5)*.25);
  float ink = ss(.15, .10, L)*keep;
  float outl = ss(.2, .15, L)*(1. - ink/max(keep,1e-3))*keep;
  float ang = fract(a/6.28318);
  float hue;
  if(ang < .1) hue = mix(.52, .38, ang/.1);
  else if(ang < .2) hue = mix(.38, .13, (ang-.1)/.1);
  else if(ang < .3) hue = mix(.13, .02, (ang-.2)/.1);
  else if(ang < .45) hue = mix(1.02, .93, (ang-.3)/.15);
  else if(ang < .6) hue = mix(.93, .85, (ang-.45)/.15);
  else if(ang < .75) hue = mix(.85, .76, (ang-.6)/.15);
  else if(ang < .9) hue = mix(.76, .62, (ang-.75)/.15);
  else hue = mix(.62, .52, (ang-.9)/.1);
  hue += .04*sin(T*.3);
  vec3 col = hsv(hue, .55, 1.);
  // glow around the strands (wide falloff of the same contour distance) + soft band glow
  float g = (ss(.3, .15, L) * .6 + ss(.45, .2, L) * .2) * keep * band;
  float soft = (exp(-pow(v/.35, 2.)) + exp(-pow((v - 1.)/.35, 2.))) * gap * .12;
  vec3 rgb = outl*(col*.3 + .8) + ink*col*.05;
  float al = clamp((outl + ink*.95)*band, 0., 1.);
  vec3 glow = col*(g + soft);
  // premultiplied output
  gl_FragColor = vec4(rgb*al + glow*(1. - al), clamp(al + (g + soft)*.9*(1. - al), 0., 1.));
}`;
const VS = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }';
function S(t, s){ const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if(!gl.getShaderParameter(x, gl.COMPILE_STATUS)) console.log(gl.getShaderInfoLog(x)); return x; }
const pr = gl.createProgram(); gl.attachShader(pr, S(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, S(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
const al = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(al); gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);
// mat3 is column-major
gl.uniformMatrix3fv(gl.getUniformLocation(pr, 'Hi'), false, new Float32Array([HI[0][0],HI[1][0],HI[2][0], HI[0][1],HI[1][1],HI[2][1], HI[0][2],HI[1][2],HI[2][2]]));
gl.uniform2f(gl.getUniformLocation(pr, 'R'), cv.width, cv.height);
const uT = gl.getUniformLocation(pr, 'T');
function draw(t){ gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); gl.uniform1f(uT, t); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
const st = performance.now();
function frame(now){ draw(T0 || (now - st)/1000); if(!T0) requestAnimationFrame(frame); }
requestAnimationFrame(frame);
})();
