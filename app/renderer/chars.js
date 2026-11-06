(function(){
const T0=Number(new URLSearchParams(location.search).get('t')||0);
const nebCanvas = document.getElementById('neb');
const gl = nebCanvas.getContext('webgl', {premultipliedAlpha: false, preserveDrawingBuffer: true});
const VS = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }`;
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 R; uniform float MODE; uniform float TH2; uniform float th; uniform sampler2D zones;
// value noise + fbm
// hash without sin(): sin() of big numbers loses precision on many GPUs and draws horizontal bands
float h(vec2 p){ p = mod(p, 4096.); vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0., a = .5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for(int i = 0; i < 6; i++){ v += a*n(p); p = m*p + vec2(17.3, 9.1); a *= .5; } return v; }
float ridge(vec2 p){ float v = 0., a = .5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for(int i = 0; i < 5; i++){ float r = 1. - abs(2.*n(p) - 1.); v += a*r*r; p = m*p + vec2(17.3, 9.1); a *= .5; } return v; }

vec3 cyc(float x, vec3 a, vec3 b, vec3 c, vec3 d){ float f = fract(x) * 4.;
  if(f < 1.) return mix(a, b, smoothstep(0.,1.,f)); if(f < 2.) return mix(b, c, smoothstep(0.,1.,f-1.));
  if(f < 3.) return mix(c, d, smoothstep(0.,1.,f-2.)); return mix(d, a, smoothstep(0.,1.,f-3.)); }
vec3 nebula(vec2 p, float side, vec3 cDeep, vec3 cMid, vec3 cHot, vec3 cAcc){
  // every time term is cos/sin of th (and its harmonics), so the loop closes perfectly
  vec2 o1 = vec2(cos(th), sin(th)) * .45;
  vec2 o2 = vec2(sin(th + side), cos(th + side)) * .3;
  vec2 q = p * 2.2 + side * 7.;
  vec2 w = vec2(fbm(q + o1), fbm(q + vec2(5.2, 1.3) - o1));
  vec2 v = vec2(fbm(q + 3.*w + o2 + vec2(1.7, 9.2)), fbm(q + 3.*w - o2 + vec2(8.3, 2.8)));
  float d = fbm(q + 1.5*v);                 // gas density
  float fil = ridge(q*1.6 + 2.*v + o1*.4);  // bright filaments
  float dust = fbm(q*3. + 4.*w - o2);       // dark dust lanes
  float dens = smoothstep(.3, .8, d);
  vec3 col = mix(cDeep, cMid, smoothstep(.3, .75, d));
  col = mix(col, cHot, smoothstep(.52, .82, d) * .85);
  col *= .25 + 1.5*dens;
  col += cAcc * pow(fil, 4.) * .45 * dens;
  col *= mix(.45, 1., smoothstep(.35, .6, dust));
  if(side < .5){
    // left character: light iridescent RGB (halo, black hole fringes); hue drifts with the gas and over the loop
    float b = dot(col, vec3(.3, .5, .2)) * 1.6;
    float hue = d * 1.3 + fil * .35 + v.x * .6 + th / 6.2831853;
    // base: light blue / cyan / white
    vec3 base = cyc(hue * .5, vec3(.55,.76,1.), vec3(.45,.95,1.), vec3(.93,.96,1.), vec3(.50,.85,1.));
    // accents in patches: green, yellow, magenta, red
    vec3 acc = cyc(hue * .35 + .13, vec3(.40,1.,.60), vec3(1.,.90,.42), vec3(1.,.42,.90), vec3(1.,.45,.40));
    float am = smoothstep(.58, .78, fbm(q * .8 + vec2(3.1, 7.7) + o2)) * .85;
    vec3 irid = mix(base, acc, am);
    col = irid * pow(clamp(b, 0., 1.), 1.4) * (.2 + .9 * dens);
  }
  return col;
}

void main(){
  vec2 uv = gl_FragCoord.xy / R;           // 0..1, y up
  vec2 tuv = vec2(uv.x, 1. - uv.y);
  vec4 z = texture2D(zones, tuv);
  // holes: let the drawing breathe through the gas
  { vec2 hp = vec2(uv.x * R.x / R.y, uv.y) * 4.5 + vec2(cos(th), sin(th)) * .35;
    float holes = smoothstep(.3, .55, fbm(hp + 13.7));
    z.rg *= holes; }
  vec2 p = vec2(uv.x * R.x / R.y, uv.y);
  vec3 col = vec3(0.); float al = 0.;
  if(z.r > .003) col += z.r * 1.35 * nebula(p, 0.,
      vec3(.04, .06, .20), vec3(.16, .26, .58), vec3(.95, .45, .20), vec3(.85, .30, .55));
  if(z.g > .003) col += z.g * 1.35 * nebula(p, 3.,
      vec3(.04, .10, .40), vec3(.20, .50, 1.), vec3(.80, .95, 1.), vec3(.45, .85, 1.));
  // twinkling stars inside the nebula (integer harmonics of th -> loops)
  float zz = max(z.r, z.g);
  vec2 g = gl_FragCoord.xy / 3.; vec2 id = floor(g);
  float r = h(id);
  if(r > .985){
    vec2 c = fract(g) - .5; float k = floor(h(id + 3.) * 4.) + 1.;
    float tw = .5 + .5 * sin(k * th + h(id + 7.) * 6.28);
    col += vec3(.9, .92, 1.) * smoothstep(.45, 0., length(c)) * tw * zz * 1.2;
  }
  float lum = max(max(col.r, col.g), col.b);
  al = clamp(zz * (0.35 + 1.2 * lum), 0., 1.);
  // true overlay: 0.5 grey = no change; the colour tints and lifts the drawing following its own shading
  // light only where there is gas: dark parts add nothing (no grey veil), structure stays visible
  // follow the same colour wheel as the characters (same centre, bands and timing)
  vec2 px = vec2(gl_FragCoord.x, R.y - gl_FragCoord.y);
  float nlum = dot(col, vec3(.3, .5, .2));
  vec3 tgt;
  if(px.x < 836.){
    vec2 d = px - vec2(330., 1500.); float ang = atan(d.y, d.x)/6.2831853;
    float wav = .04*sin(px.y/140. + TH2) + .03*sin(px.x/190. - TH2);
    float hue = fract(ang*5. + length(d)/1400. + wav - TH2/6.2831853);
    tgt = clamp(abs(fract(hue + vec3(0., 2./3., 1./3.))*6. - 3.) - 1., 0., 1.);
    tgt = 1. - (1. - tgt)*(1. - vec3(.55, .8, 1.)*.35);
  } else {
    vec2 d = px - vec2(1400., 1500.); float ang = atan(d.y, d.x)/6.2831853;
    float wav = .04*sin(px.y/150. - TH2) + .03*sin(px.x/170. + TH2);
    float k = pow(.5 + .5*cos(6.2831853*(ang*5. + length(d)/1400. + wav) - TH2), 2.);
    float b2 = .5 + .5*cos(6.2831853*(ang*3. - length(d)/1100.) + TH2);
    tgt = mix(mix(vec3(.15, .3, 1.), vec3(.4, .7, 1.), b2), vec3(.45, .85, 1.), k*.6);   // blues only, no white
  }
  vec3 lit = tgt * (.3 + nlum * 1.1) * (px.x < 836. ? 1.25 : .7);
  if(MODE < .5)      gl_FragColor = vec4(clamp(lit * zz * .45, 0., 1.), 1.);                 // screen, soft
  else if(MODE < 1.5) gl_FragColor = vec4(mix(vec3(.5), clamp(.5 + lit * 1.4, 0., 1.), zz), 1.); // soft-light
  else if(MODE < 2.5) gl_FragColor = vec4(mix(vec3(.5), clamp(.5 + lit * .8, 0., 1.), zz), 1.);  // overlay
  else               gl_FragColor = vec4(mix(vec3(1.), clamp(1. - lit * .5, 0., 1.), zz), 1.);   // colour (multiply-tint)
}`;
function sh(type, src){ const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.log(gl.getShaderInfoLog(s)); return s; }
const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog); gl.useProgram(prog);
const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
const al = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(al); gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);
const zimg = new Image(); let zready = false; zimg.src = 'nebzones.png';
zimg.onload = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, zimg);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  zready = true; };
const LOOP = 80; // seconds per full loop
window.NEBMODE=0;
function drawNeb(t){
  gl.uniform1f(gl.getUniformLocation(prog, 'MODE'), window.NEBMODE);
  gl.uniform1f(gl.getUniformLocation(prog, 'TH2'), (t % 40)/40*6.2831853);
  if(!zready) return;
  gl.viewport(0, 0, nebCanvas.width, nebCanvas.height);
  gl.uniform2f(gl.getUniformLocation(prog, 'R'), nebCanvas.width, nebCanvas.height);
  gl.uniform1f(gl.getUniformLocation(prog, 'th'), (t % LOOP) / LOOP * 6.2831853);
  gl.uniform1i(gl.getUniformLocation(prog, 'zones'), 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}


// ---------- silhouettes: several tones at once, rotating in a circle ----------
(function(){
const cv=document.getElementById('silc'); const g=cv.getContext('webgl',{premultipliedAlpha:false,preserveDrawingBuffer:true});
const FS=`precision highp float; uniform sampler2D tex; uniform sampler2D stm; uniform float th; uniform float TT; uniform vec2 R;
vec3 rgb2hsv(vec3 c){vec4 K=vec4(0.,-1./3.,2./3.,-1.);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));
 vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y);return vec3(abs(q.z+(q.w-q.y)/(6.*d+1e-10)),d/(q.x+1e-10),q.x);}
vec3 hsv2rgb(vec3 c){vec3 p=abs(fract(c.xxx+vec3(0.,2./3.,1./3.))*6.-3.);return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y);}
void main(){ vec2 px=vec2(gl_FragCoord.x, R.y-gl_FragCoord.y); vec4 c=texture2D(tex, px/R);
 // constellation stars: each one fades in and out on its own rhythm
 vec4 sm=texture2D(stm, px/R);
 float tw=.5+.5*sin(TT*(.5+sm.g*.9)+sm.g*40.);
 tw=smoothstep(.15,.95,tw);
 c.rgb*=1.-sm.r*(1.-tw)*.92;
 // faint stars popping in other places on the robes
 { vec2 g=floor(px/9.); float r=fract(sin(dot(g,vec2(12.9898,78.233)))*43758.5453);
   float inR=texture2D(stm, (g*9.+4.5)/R).b;
   if(r>.985 && inR>.5){ float ph=fract(r*91.7); float a=max(0.,sin(TT*(.35+ph*.6)+ph*60.)); a=a*a*a;
     float d=length(fract(px/9.)-.5); c.rgb+=vec3(.85,.9,1.)*smoothstep(.35,0.,d)*a*.8; } }
 vec3 hsv=rgb2hsv(c.rgb); float colored=smoothstep(.08,.25,hsv.y)*smoothstep(.03,.12,hsv.z);
 float side=step(836.,px.x); vec3 o;
 // the eyes keep their own colour (never cycled)
 { float e=1.; vec2 E[4]; E[0]=vec2(459.,248.); E[1]=vec2(499.,297.); E[2]=vec2(1267.,250.); E[3]=vec2(1218.,298.);
   for(int i=0;i<4;i++){ vec2 q=(px-E[i])/vec2(26.,18.); e=min(e,smoothstep(.6,1.,length(q))); }
   colored*=e; }
 colored*=smoothstep(side>.5?.06:.32, side>.5?.3:.62, hsv.z);   // only the lit/glowing parts (lines, constellations, rim light), not skin or cloth
 if(side<.5){ // left: his RGB tones, all at once, turning around his figure
   // centre of the wheel far below the picture, so it is never seen; soft wavy bands
   vec2 d=px-vec2(330.,1500.); float ang=atan(d.y,d.x)/6.2831853;
   float wav=.04*sin(px.y/140.+th)+.03*sin(px.x/190.-th);
   float hue=fract(ang*5. + length(d)/1400. + wav - th/6.2831853);
   o=hsv2rgb(vec3(hue, hsv.y*.85, hsv.z));
   o=1.-(1.-o)*(1.-vec3(.55,.8,1.)*.28*hsv.z);   // subtle light-blue screen
 } else {    // right: blue / light blue / white bands turning around him
   vec2 d=px-vec2(1400.,1500.); float ang=atan(d.y,d.x)/6.2831853;
   float wav=.04*sin(px.y/150.-th)+.03*sin(px.x/170.+th);
   float u=fract(ang*5. + length(d)/1400. + wav - th/6.2831853)*5.;
   // his palette in a loop: deep blue -> blue -> cyan -> light blue -> gold -> back
   vec3 c0=hsv2rgb(vec3(.66,hsv.y,hsv.z*.8)), c1=hsv2rgb(vec3(.61,hsv.y,hsv.z*1.1)), c2=hsv2rgb(vec3(.53,hsv.y*.9,hsv.z*1.3)),
        c3=hsv2rgb(vec3(.58,hsv.y*.6,hsv.z*1.25)), c4=hsv2rgb(vec3(.12,max(hsv.y,.55)*.85,hsv.z*1.25));
   o = u<1. ? mix(c0,c1,smoothstep(0.,1.,u)) : u<2. ? mix(c1,c2,smoothstep(0.,1.,u-1.)) : u<3. ? mix(c2,c3,smoothstep(0.,1.,u-2.))
     : u<4. ? mix(c3,c4,smoothstep(0.,1.,u-3.)) : mix(c4,c0,smoothstep(0.,1.,u-4.));
   o=min(o,vec3(1.));
 }
 gl_FragColor=vec4(mix(c.rgb,o,colored), c.a); }`;
const VS='attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
function S(t,s){const x=g.createShader(t);g.shaderSource(x,s);g.compileShader(x);if(!g.getShaderParameter(x,g.COMPILE_STATUS))console.log(g.getShaderInfoLog(x));return x;}
const pr=g.createProgram();g.attachShader(pr,S(g.VERTEX_SHADER,VS));g.attachShader(pr,S(g.FRAGMENT_SHADER,FS));g.linkProgram(pr);g.useProgram(pr);
const bf=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,bf);g.bufferData(g.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),g.STATIC_DRAW);
const al=g.getAttribLocation(pr,'a');g.enableVertexAttribArray(al);g.vertexAttribPointer(al,2,g.FLOAT,false,0,0);
g.enable(g.BLEND); g.blendFunc(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA);
let ok2=false; const sim=new Image(); sim.src='stars_mask.png'; sim.onload=()=>{g.activeTexture(g.TEXTURE1);const t2=g.createTexture();g.bindTexture(g.TEXTURE_2D,t2);
 g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,sim);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.NEAREST);
 g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);g.activeTexture(g.TEXTURE0);ok2=true;};
let ok=false; const im=new Image(); im.src='fg_old.png'; im.onload=()=>{const t=g.createTexture();g.bindTexture(g.TEXTURE_2D,t);
 g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,im);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);
 g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);ok=true; if(T0) drawSil(T0);};
window.drawSil=function(t){ if(!ok||!ok2) return; g.uniform1i(g.getUniformLocation(pr,'stm'),1); g.uniform1f(g.getUniformLocation(pr,'TT'),t); g.viewport(0,0,1672,941); g.clearColor(0,0,0,0); g.clear(g.COLOR_BUFFER_BIT);
 g.uniform1f(g.getUniformLocation(pr,'th'),(t%40)/40*6.2831853); g.uniform2f(g.getUniformLocation(pr,'R'),1672,941);
 g.uniform1i(g.getUniformLocation(pr,'tex'),0); g.drawArrays(g.TRIANGLE_STRIP,0,4); };
})();
const st=performance.now();
function frame(now){ const t=T0||(now-st)/1000; drawNeb(t); drawSil(t); if(!T0) requestAnimationFrame(frame); }
requestAnimationFrame(frame); setTimeout(()=>{ if(T0){ drawNeb(T0); drawSil(T0);} },1500);
})();