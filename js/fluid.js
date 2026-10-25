/* =========================================================
   RESONANCE — «Жидкий свет»: визуализатор на симуляции жидкости.
   Обложка излучает светящийся дым. Каждая сторона — своя полоса
   спектра: сверху бас, по бокам середина, снизу верха; левая половина —
   левый канал, правая — правый. Удары баса выбрасывают клубы, вихри
   закручивают их, яркие места мягко светятся.
   Решатель — классические stable fluids (Stam): силы -> завихрённость ->
   проекция давлением (итерации Якоби) -> адвекция. Скорость и краска
   хранятся в half-float, свечение — в обычных 8-битных буферах.
   ========================================================= */
(function () {
  'use strict';
  const RSN = window.RSN, U = RSN.util;

  const VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

  /* обложка — скруглённый прямоугольник; единица длины — высота экрана, y вверх */
  const SHAPE = `
uniform vec2 uCenter;
uniform vec3 uBox;
uniform float uAspect;
uniform vec3 uAway;
uniform sampler2D uSpec;
#define TAU 6.2831853
float sdBox(vec2 p) {
  vec2 q = abs(p) - uBox.xy + uBox.z;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uBox.z;
}
vec3 spec(float u) { return texture2D(uSpec, vec2(clamp(u, 0.0, 1.0), 0.5)).rgb; }
/* сторона, обращённая к тексту плеера, дымит слабее */
float sideWeight(vec2 d) { return 1.0 - uAway.z * smoothstep(0.15, 0.85, dot(normalize(d + 1e-6), uAway.xy)); }
/* сочный цвет одинаковой яркости: тёмные обложки тоже дают светящийся дым */
vec3 vivid(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, 1.3), 0.0);
  float m = max(max(c.r, c.g), c.b);
  return c / max(m, 0.06) * mix(0.5, 1.0, smoothstep(0.02, 0.25, m));
}`;

  const HASH = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`;

  /* Силы. Струи бьют из точек по контуру обложки (их NS, кольцо медленно вращается):
     тонкие непрерывные нити, сила каждой — громкость полосы спектра под её углом.
     На сильных ударах — ещё до NB крупных выбросов. Локальная струя в жидкости рождает
     вихревую пару: она сама улетает наружу и закручивается «грибом».
     Плюс закрутка вдоль краёв и курсор */
  const NS = 24, NB = 8, NJ = NS + NB;
  const FS_FORCE = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uVel;
uniform float uDt;
uniform float uSimH;
uniform vec4 uJet[${NJ}];   // xy — точка, zw — ускорение (экранов/с²)
uniform vec4 uJetP[${NJ}];  // x — 1/радиус² силы, y — 1/радиус² краски, z — краски в секунду
uniform float uSwirl;
uniform vec4 uMouse;        // xy — курсор, zw — его скорость (экранов/с)
uniform vec2 uMouseP;       // x: радиус, y: доля подмешивания за кадр
${SHAPE}
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  vec2 d = p - uCenter;
  vec2 vel = texture2D(uVel, vUv).xy;
  vec2 f = vec2(0.0);
  for (int i = 0; i < ${NJ}; i++) {
    vec2 q = p - uJet[i].xy;
    f += uJet[i].zw * exp(-dot(q, q) * uJetP[i].x);
  }
  float sd = sdBox(d);
  vec2 rad = normalize(d + 1e-6);
  f += vec2(-rad.y, rad.x) * uSwirl * smoothstep(0.0, 0.01, sd) * exp(-max(sd, 0.0) / 0.06);
  vel += f * uDt * uSimH;
  vec2 md = p - uMouse.xy;
  vel = mix(vel, uMouse.zw * uSimH, exp(-dot(md, md) / (uMouseP.x * uMouseP.x)) * uMouseP.y);
  vel *= smoothstep(-0.012, 0.0, sd);   // обложка — твёрдое тело
  gl_FragColor = vec4(vel, 0.0, 1.0);
}`;

  /* краска выходит из тех же струй: цвет края обложки рядом со струёй + палитра */
  const FS_DYE = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uDye;
uniform float uDt;
uniform vec4 uJet[${NJ}];
uniform vec4 uJetP[${NJ}];
uniform vec3 uJetC[${NJ}];  // цвет краски
uniform vec4 uMouse;
uniform vec3 uMouseD;       // x: радиус, y: количество, z: -
uniform vec3 uMouseC;
${SHAPE}
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  vec3 dye = texture2D(uDye, vUv).rgb;
  vec3 add = vec3(0.0);
  for (int i = 0; i < ${NJ}; i++) {
    vec2 q = p - uJet[i].xy;
    add += uJetC[i] * (uJetP[i].z * exp(-dot(q, q) * uJetP[i].y));
  }
  dye += add * uDt;
  vec2 md = p - uMouse.xy;
  dye += uMouseC * exp(-dot(md, md) / (uMouseD.x * uMouseD.x)) * uMouseD.y;
  dye *= smoothstep(-0.03, -0.006, sdBox(p - uCenter));   // под обложкой краску не копим
  gl_FragColor = vec4(dye, 1.0);
}`;

  /* перенос; для краски — ещё и «старение»: дым по дороге уходит во второй цвет палитры */
  const FS_ADVECT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uVel;
uniform sampler2D uSrc;
uniform vec2 uVelTexel;
uniform float uDt;
uniform float uDiss;
uniform vec4 uAge;     // rgb — цвет старого дыма, a — скорость старения (0 — для скорости)
void main() {
  vec2 c = vUv - uDt * texture2D(uVel, vUv).xy * uVelTexel;
  vec4 r = texture2D(uSrc, c);
  r *= step(0.0, c.x) * step(c.x, 1.0) * step(0.0, c.y) * step(c.y, 1.0);   // из-за края экрана приходит пустота
  float m = max(max(r.r, r.g), r.b);
  r.rgb = mix(r.rgb, uAge.rgb * m, clamp(uAge.a * uDt, 0.0, 1.0));
  gl_FragColor = r / (1.0 + uDiss * uDt);
}`;

  const FS_CURL = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uVel;
uniform vec2 uTexel;
void main() {
  float L = texture2D(uVel, vUv - vec2(uTexel.x, 0.0)).y;
  float R = texture2D(uVel, vUv + vec2(uTexel.x, 0.0)).y;
  float T = texture2D(uVel, vUv + vec2(0.0, uTexel.y)).x;
  float B = texture2D(uVel, vUv - vec2(0.0, uTexel.y)).x;
  gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`;

  /* vorticity confinement: возвращаем мелкие вихри, которые съедает численная вязкость */
  const FS_VORT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uVel;
uniform sampler2D uCurl;
uniform vec2 uTexel;
uniform float uCurlK;
uniform float uDt;
void main() {
  float L = texture2D(uCurl, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture2D(uCurl, vUv + vec2(uTexel.x, 0.0)).x;
  float T = texture2D(uCurl, vUv + vec2(0.0, uTexel.y)).x;
  float B = texture2D(uCurl, vUv - vec2(0.0, uTexel.y)).x;
  float C = texture2D(uCurl, vUv).x;
  vec2 f = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  f /= length(f) + 1e-4;
  f *= uCurlK * C;
  f.y = -f.y;
  vec2 v = texture2D(uVel, vUv).xy + f * uDt;
  gl_FragColor = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
}`;

  const FS_DIV = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uVel;
uniform vec2 uTexel;
void main() {
  float L = texture2D(uVel, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture2D(uVel, vUv + vec2(uTexel.x, 0.0)).x;
  float T = texture2D(uVel, vUv + vec2(0.0, uTexel.y)).y;
  float B = texture2D(uVel, vUv - vec2(0.0, uTexel.y)).y;
  gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;

  const FS_SCALE = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSrc;
uniform float uK;
void main() { gl_FragColor = texture2D(uSrc, vUv) * uK; }`;

  /* давление: за краем экрана ноль — дым свободно уходит за границу */
  const PRESS = `
uniform sampler2D uP;
uniform vec2 uTexel;
float P(vec2 c) { return (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0) ? 0.0 : texture2D(uP, c).x; }`;

  const FS_PRESSURE = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uDiv;
${PRESS}
void main() {
  float L = P(vUv - vec2(uTexel.x, 0.0)), R = P(vUv + vec2(uTexel.x, 0.0));
  float T = P(vUv + vec2(0.0, uTexel.y)), B = P(vUv - vec2(0.0, uTexel.y));
  gl_FragColor = vec4((L + R + B + T - texture2D(uDiv, vUv).x) * 0.25, 0.0, 0.0, 1.0);
}`;

  const FS_GRAD = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uVel;
${PRESS}
${SHAPE}
void main() {
  float L = P(vUv - vec2(uTexel.x, 0.0)), R = P(vUv + vec2(uTexel.x, 0.0));
  float T = P(vUv + vec2(0.0, uTexel.y)), B = P(vUv - vec2(0.0, uTexel.y));
  vec2 v = texture2D(uVel, vUv).xy - 0.5 * vec2(R - L, T - B);
  v *= smoothstep(-0.012, 0.0, sdBox((vUv - 0.5) * vec2(uAspect, 1.0) - uCenter));   // сквозь обложку не течёт
  gl_FragColor = vec4(v, 0.0, 1.0);
}`;

  /* свечение: яркие места дыма -> пирамида размытий */
  const FS_BLOOM_PRE = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSrc;
uniform float uExp;
uniform vec3 uCurve;
uniform float uThreshold;
void main() {
  vec3 c = 1.0 - exp(-texture2D(uSrc, vUv).rgb * uExp);
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - uCurve.x, 0.0, uCurve.y);
  rq = uCurve.z * rq * rq;
  c *= max(rq, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(c, 1.0);
}`;

  const FS_BLUR = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
void main() {
  vec3 s = texture2D(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(uSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
         + texture2D(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(uSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(s * 0.25, 1.0);
}`;

  const BLOOM_LEVELS = 5;
  const TAU = Math.PI * 2;
  const smooth = (a, b, x) => { const t = U.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  /* сочный цвет одинаковой яркости (как vivid в шейдере), вход и выход 0..1 */
  function vivid(r, g, b, out, o) {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = Math.max(l + (r - l) * 1.3, 0); g = Math.max(l + (g - l) * 1.3, 0); b = Math.max(l + (b - l) * 1.3, 0);
    const m = Math.max(r, g, b);
    const k = (0.5 + 0.5 * smooth(0.02, 0.25, m)) / Math.max(m, 0.06);
    out[o] = r * k; out[o + 1] = g * k; out[o + 2] = b * k;
  }

  class Fluid {
    constructor(renderer) {
      this.r = renderer;
      this.ok = false;
      this.time = Math.random() * 100;
      this.rot = Math.random() * TAU;
      this.sizes = '';
      this.mouse = { x: 0, y: 0, vx: 0, vy: 0, moved: -1, init: false };
      this.jet = new Float32Array(NJ * 4);
      this.jetP = new Float32Array(NJ * 4);
      this.jetC = new Float32Array(NJ * 3);
      this.mouseC = new Float32Array(3);
      this.ageC = new Float32Array(3);
      this.tmp = new Float32Array(3);
      this.bursts = [];
      this.pending = 0;
      this.exposure = 0.9;
    }

    /* сильная доля: выбросы в 2–5 сторонах, где сейчас громче */
    beat(strength) {
      if (strength > this.pending) this.pending = Math.min(1.4, strength);
    }

    /* SDF обложки в JS — те же формулы, что в шейдере */
    sd(x, y) {
      const g = this.g;
      const qx = Math.abs(x - g.cx) - g.bx + g.br, qy = Math.abs(y - g.cy) - g.by + g.br;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - g.br;
    }

    /* точка на контуре под углом th (0 — вверх, по часовой) и направление струи оттуда */
    edge(th, off, out) {
      const g = this.g, dx = Math.sin(th), dy = Math.cos(th);
      let t = 0;
      for (let n = 0; n < 12; n++) {   // от центра по лучу до края, шагами по расстоянию до контура
        const s = this.sd(g.cx + dx * t, g.cy + dy * t);
        t -= s;
        if (Math.abs(s) < 1e-4) break;
      }
      const px = g.cx + dx * (t + off), py = g.cy + dy * (t + off), e = 0.002;
      const nx = this.sd(px + e, py) - this.sd(px - e, py), ny = this.sd(px, py + e) - this.sd(px, py - e);
      const nl = Math.hypot(nx, ny) || 1;
      let jx = nx / nl + dx * 0.8, jy = ny / nl + dy * 0.8;
      const jl = Math.hypot(jx, jy) || 1;
      out[0] = px; out[1] = py; out[2] = jx / jl; out[3] = jy / jl;
    }

    /* полоса спектра под углом: сверху бас, по бокам середина, снизу верха; слева левый канал */
    band(th) {
      let a = th % TAU;
      if (a < 0) a += TAU;
      if (a > Math.PI) a -= TAU;
      return 0.5 + a / TAU;
    }

    /* цвет краски: край обложки возле точки пополам с палитрой полосы */
    color(px, py, u, st, mixE, o3) {
      const g = this.g, pal = st.pal, tmp = this.tmp, cA = this.r.coverA, cB = this.r.coverB;
      const k = Math.abs(u - 0.5) * 2, k1 = smooth(0, 0.75, k), k2 = smooth(0.7, 1, k);
      for (let c = 0; c < 3; c++) tmp[c] = ((pal.c1[c] + (pal.c2[c] - pal.c1[c]) * k1) * (1 - k2) + pal.c3[c] * k2) / 255;
      if (cA && cB) {
        const ex = U.clamp((px - g.cx) / g.bx, -1, 1), ey = U.clamp((py - g.cy) / g.by, -1, 1);
        const p = (Math.round((0.5 - 0.5 * ey) * 127) * 128 + Math.round((0.5 + 0.5 * ex) * 127)) * 4;
        for (let c = 0; c < 3; c++) tmp[c] = (tmp[c] + (cA[p + c] + (cB[p + c] - cA[p + c]) * mixE) / 255) * 0.5;
      }
      vivid(tmp[0], tmp[1], tmp[2], this.jetC, o3);
    }

    jets(st, dt, vis) {
      const g = this.g, disp = st.audio.disp, pal = st.pal;
      const mixE = U.easeInOutCubic(U.clamp(this.r.mix, 0, 1));
      const side = th => 1 - g.az * smooth(0.15, 0.85, Math.sin(th) * g.ax + Math.cos(th) * g.ay);
      const e = this.e4 || (this.e4 = new Float32Array(4));
      this.rot = (this.rot + dt * 0.05) % TAU;
      const thin = 1 / (0.02 * 0.02), thinDye = 1 / (0.012 * 0.012);
      /* непрерывные нити */
      for (let i = 0; i < NS; i++) {
        const th = this.rot + i * (TAU / NS);
        this.edge(th, 0.014, e);
        const u = this.band(th);
        const v = disp[Math.min(255, Math.max(0, Math.round(u * 255)))];
        const w = side(th) * vis;
        const amb = 0.5 + 0.5 * Math.sin(th * 3 + this.time * 0.6);
        const f = (v * v * 18 + 0.7 * amb) * w * st.motion;
        const o4 = i * 4;
        this.jet[o4] = e[0]; this.jet[o4 + 1] = e[1]; this.jet[o4 + 2] = e[2] * f; this.jet[o4 + 3] = e[3] * f;
        this.jetP[o4] = thin; this.jetP[o4 + 1] = thinDye;
        this.jetP[o4 + 2] = (Math.pow(v, 1.5) * 12 + 0.6 * amb) * w;
        this.color(e[0], e[1], u, st, mixE, i * 3);
      }
      /* выбросы на ударах: стороны выбираем по громкости, к тексту — реже */
      if (this.pending > 0) {
        const s = this.pending, n = 2 + Math.round(s * 2.5);
        this.pending = 0;
        for (let b = 0; b < n; b++) {
          let best = 0, bestV = -1;
          for (let c = 0; c < 4; c++) {
            const th = Math.random() * TAU, u = this.band(th);
            const sw = side(th);
            const val = sw < 0.5 ? -1 : (disp[Math.min(255, Math.max(0, Math.round(u * 255)))] + 0.25 * Math.random()) * sw;
            if (val > bestV) { bestV = val; best = th; }
          }
          this.bursts.push({ th: best, t0: this.time, life: 0.16, s: s * (0.75 + 0.5 * Math.random()) });
        }
        while (this.bursts.length > NB) this.bursts.shift();
      }
      this.bursts = this.bursts.filter(b => this.time - b.t0 < b.life);
      const big = 1 / (0.04 * 0.04), bigDye = 1 / (0.03 * 0.03);
      for (let b = 0; b < NB; b++) {
        const o4 = (NS + b) * 4, B = this.bursts[b];
        if (!B) { this.jet[o4 + 2] = this.jet[o4 + 3] = 0; this.jetP[o4 + 2] = 0; this.jetP[o4] = this.jetP[o4 + 1] = 1; continue; }
        const env = Math.sin(Math.PI * U.clamp((this.time - B.t0) / B.life, 0, 1));
        this.edge(B.th, 0.02, e);
        const f = B.s * env * 75 * vis * st.motion;
        this.jet[o4] = e[0]; this.jet[o4 + 1] = e[1]; this.jet[o4 + 2] = e[2] * f; this.jet[o4 + 3] = e[3] * f;
        this.jetP[o4] = big; this.jetP[o4 + 1] = bigDye;
        this.jetP[o4 + 2] = B.s * env * 34 * vis;
        this.color(e[0], e[1], this.band(B.th), st, mixE, (NS + b) * 3);
      }
      vivid((pal.c1[0] * 0.7 + pal.c2[0] * 0.3) / 255, (pal.c1[1] * 0.7 + pal.c2[1] * 0.3) / 255, (pal.c1[2] * 0.7 + pal.c2[2] * 0.3) / 255, this.mouseC, 0);
      /* «старый» дым уходит в цвет палитры, самый далёкий по оттенку от основного */
      const L1 = U.rgbToOklab(pal.c1[0], pal.c1[1], pal.c1[2]);
      const L2 = U.rgbToOklab(pal.c2[0], pal.c2[1], pal.c2[2]), L3 = U.rgbToOklab(pal.c3[0], pal.c3[1], pal.c3[2]);
      const d2 = (L2[1] - L1[1]) ** 2 + (L2[2] - L1[2]) ** 2, d3 = (L3[1] - L1[1]) ** 2 + (L3[2] - L1[2]) ** 2;
      const far = d3 > d2 ? pal.c3 : pal.c2;
      vivid(far[0] / 255, far[1] / 255, far[2] / 255, this.ageC, 0);
    }

    init() {
      const r = this.r, gl = r.gl;
      this.ok = false;
      this.sizes = '';
      this.bufs = null;
      const hf = gl.getExtension('OES_texture_half_float');
      const lin = gl.getExtension('OES_texture_half_float_linear');
      gl.getExtension('EXT_color_buffer_half_float');
      if (!hf || !lin) return;
      this.half = hf.HALF_FLOAT_OES;
      const mk = fs => r.program(VS, fs, '', ['aPos']);
      try {
        this.p = {
          force: mk(FS_FORCE), dye: mk(FS_DYE), advect: mk(FS_ADVECT), curl: mk(FS_CURL), vort: mk(FS_VORT),
          div: mk(FS_DIV), scale: mk(FS_SCALE), pressure: mk(FS_PRESSURE), grad: mk(FS_GRAD),
          pre: mk(FS_BLOOM_PRE), blur: mk(FS_BLUR)
        };
      } catch (e) {
        if (window.RSN_ERR) window.RSN_ERR('fluid: ' + e.message);
        return;
      }
      /* можно ли рисовать в half-float на этой видеокарте */
      const t = this.target(4, 4, this.half);
      if (!t) return;
      this.drop(t);
      this.ok = true;
    }

    target(w, h, type) {
      const gl = this.r.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, type, null);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      if (ok) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) { gl.deleteFramebuffer(f); gl.deleteTexture(t); return null; }
      return { t, f, w, h };
    }

    drop(x) {
      if (!x) return;
      const gl = this.r.gl;
      if (x.a) { this.drop(x.a); this.drop(x.b); return; }
      gl.deleteFramebuffer(x.f);
      gl.deleteTexture(x.t);
    }

    pair(w, h, type) {
      const a = this.target(w, h, type), b = a && this.target(w, h, type);
      if (!b) { this.drop(a); return null; }
      return { a, b, get read() { return this.a; }, get write() { return this.b; }, swap() { const t = this.a; this.a = this.b; this.b = t; } };
    }

    release() {
      if (!this.bufs) return;
      const B = this.bufs;
      ['vel', 'pres', 'dye', 'div', 'curl'].forEach(k => this.drop(B[k]));
      (B.bloom || []).forEach(x => this.drop(x));
      this.bufs = null;
    }

    ensure(W, H, q) {
      const aspect = W / H;
      const simH = q.sim, simW = Math.max(8, Math.round(simH * aspect));
      const dyeH = Math.max(64, Math.min(1080, Math.round(H * q.dye))), dyeW = Math.max(64, Math.round(dyeH * aspect));
      const gH = Math.max(48, Math.min(420, Math.round(H * q.glow))), gW = Math.max(48, Math.round(gH * aspect));
      const key = [simW, simH, dyeW, dyeH, gW, gH].join('x');
      if (key === this.sizes && this.bufs) return true;
      this.release();
      const gl = this.r.gl, hf = this.half, u8 = gl.UNSIGNED_BYTE;
      const B = {
        vel: this.pair(simW, simH, hf), pres: this.pair(simW, simH, hf), dye: this.pair(dyeW, dyeH, hf),
        div: this.target(simW, simH, hf), curl: this.target(simW, simH, hf), bloom: []
      };
      let bw = gW, bh = gH;
      for (let i = 0; i < BLOOM_LEVELS && bh >= 8; i++) {
        const t = this.target(bw, bh, u8);
        if (!t) break;
        B.bloom.push(t);
        bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      }
      this.bufs = B;
      if (!B.vel || !B.pres || !B.dye || !B.div || !B.curl || !B.bloom.length) {
        this.release();
        this.ok = false;   // видеокарта не тянет — main откатится на «Аврору»
        return false;
      }
      this.sizes = key;
      this.simW = simW; this.simH = simH;
      return true;
    }

    /* один проход: цель, программа, текстуры по слотам, униформы */
    run(P, target, tex, set) {
      const gl = this.r.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.f);
      gl.viewport(0, 0, target.w, target.h);
      gl.useProgram(P.p);
      this.r.bindQuad();
      let unit = 0;
      for (const name in tex) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex[name]);
        gl.uniform1i(P.u[name], unit);
        unit++;
      }
      if (set) set(P.u);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    shape(u) {
      const gl = this.r.gl, g = this.g;
      gl.uniform2f(u.uCenter, g.cx, g.cy);
      gl.uniform3f(u.uBox, g.bx, g.by, g.br);
      gl.uniform1f(u.uAspect, g.aspect);
      gl.uniform3f(u.uAway, g.ax, g.ay, g.az);
    }

    /* Кадр: геометрия и курсор, затем шаги симуляции с фиксированным dt = 1/60 с
       (численная вязкость переноса зависит от частоты шагов — без этого при 30 и при
       180 кадрах/с дым вёл бы себя по-разному), затем лучи и свечение */
    step(dt, st, W, H, k, q) {
      if (!this.ok || !this.ensure(W, H, q)) return false;
      const S = st.S;
      dt = Math.min(dt, 0.1);
      const aspect = W / H, cssW = W / k, cssH = H / k, sh = st.shape;
      const bx = Math.max(0.004, sh.hw / cssH), by = Math.max(0.004, sh.hh / cssH);
      const away = S.layout === 'left' ? [1, 0] : S.layout === 'right' ? [-1, 0] : [0, -1];
      this.g = {
        cx: (sh.cx / cssW - 0.5) * aspect, cy: 0.5 - sh.cy / cssH,
        bx, by, br: Math.min(sh.r / cssH, bx, by), aspect,
        ax: away[0], ay: away[1], az: 0.85
      };

      /* курсор размешивает дым */
      const m = this.mouse, mxp = st.mouse.tx * 0.5 * aspect, myp = -st.mouse.ty * 0.5;
      this.clock = (this.clock || 0) + dt;
      if (m.init) {
        const dx = mxp - m.x, dy = myp - m.y, jump = Math.hypot(dx, dy);
        if (jump > 1e-5 && jump < 0.25) {
          const sp = Math.min(1, 3.5 / (jump / dt));
          m.vx = dx / dt * sp; m.vy = dy / dt * sp; m.moved = this.clock;
        }
      }
      m.x = mxp; m.y = myp; m.init = true;
      m.stir = !!S.fluidMouse && this.clock - m.moved < 0.06;

      /* число шагов округляем: при 60 кадрах/с длина кадра «гуляет» вокруг 1/60,
         и пороговый счётчик давал бы 0 и 2 шага через кадр — дым дёргался бы */
      const h = 1 / 60;
      this.acc = Math.min((this.acc || 0) + dt, 3 * h);
      const steps = Math.min(3, Math.round(this.acc / h));
      this.acc -= steps * h;
      for (let i = 0; i < steps; i++) this.sim(h, st, q);
      if (steps) this.post();
      return true;
    }

    sim(dt, st, q) {
      const r = this.r, gl = r.gl, B = this.bufs, S = st.S, L = st.audio.levels, m = this.mouse;
      this.time += dt;
      const vis = st.visAlpha, motion = st.motion;
      const spin = Math.sin(this.time * 0.035);   // закрутка медленно меняет направление (период ~3 мин)
      const simTex = [1 / this.simW, 1 / this.simH];
      const mixK = m.stir ? 1 - Math.exp(-dt * 14) : 0;
      const mSpeed = m.stir ? Math.hypot(m.vx, m.vy) : 0;

      /* 1. силы: струи, закрутка, курсор */
      this.jets(st, dt, vis);
      this.run(this.p.force, B.vel.write, { uVel: B.vel.read.t }, u => {
        this.shape(u);
        gl.uniform1f(u.uDt, dt);
        gl.uniform1f(u.uSimH, this.simH);
        gl.uniform4fv(u.uJet, this.jet);
        gl.uniform4fv(u.uJetP, this.jetP);
        gl.uniform1f(u.uSwirl, (0.4 + 1.4 * L.mid) * spin * vis * motion);
        gl.uniform4f(u.uMouse, m.x, m.y, m.vx, m.vy);
        gl.uniform2f(u.uMouseP, 0.06, mixK * 0.6);
      });
      B.vel.swap();

      /* 2. завихрённость */
      this.run(this.p.curl, B.curl, { uVel: B.vel.read.t }, u => gl.uniform2f(u.uTexel, simTex[0], simTex[1]));
      this.run(this.p.vort, B.vel.write, { uVel: B.vel.read.t, uCurl: B.curl.t }, u => {
        gl.uniform2f(u.uTexel, simTex[0], simTex[1]);
        gl.uniform1f(u.uCurlK, 7);
        gl.uniform1f(u.uDt, dt);
      });
      B.vel.swap();

      /* 3. проекция: убираем сжимаемость, чтобы дым закручивался, а не растекался */
      this.run(this.p.div, B.div, { uVel: B.vel.read.t }, u => gl.uniform2f(u.uTexel, simTex[0], simTex[1]));
      this.run(this.p.scale, B.pres.write, { uSrc: B.pres.read.t }, u => gl.uniform1f(u.uK, 0.8));
      B.pres.swap();
      for (let i = 0; i < q.iters; i++) {
        this.run(this.p.pressure, B.pres.write, { uP: B.pres.read.t, uDiv: B.div.t }, u => gl.uniform2f(u.uTexel, simTex[0], simTex[1]));
        B.pres.swap();
      }
      this.run(this.p.grad, B.vel.write, { uP: B.pres.read.t, uVel: B.vel.read.t }, u => {
        this.shape(u);
        gl.uniform2f(u.uTexel, simTex[0], simTex[1]);
      });
      B.vel.swap();

      /* 4. перенос скорости */
      this.run(this.p.advect, B.vel.write, { uVel: B.vel.read.t, uSrc: B.vel.read.t }, u => {
        gl.uniform2f(u.uVelTexel, simTex[0], simTex[1]);
        gl.uniform1f(u.uDt, dt);
        gl.uniform1f(u.uDiss, 0.35);
        gl.uniform4f(u.uAge, 0, 0, 0, 0);
      });
      B.vel.swap();

      /* 5. краска: выпуск + перенос */
      this.run(this.p.dye, B.dye.write, { uDye: B.dye.read.t }, u => {
        this.shape(u);
        gl.uniform1f(u.uDt, dt);
        gl.uniform4fv(u.uJet, this.jet);
        gl.uniform4fv(u.uJetP, this.jetP);
        gl.uniform3fv(u.uJetC, this.jetC);
        gl.uniform4f(u.uMouse, m.x, m.y, 0, 0);
        gl.uniform3f(u.uMouseD, 0.035, m.stir ? Math.min(0.35, mSpeed * 0.08) * mixK : 0, 0);
        gl.uniform3f(u.uMouseC, this.mouseC[0], this.mouseC[1], this.mouseC[2]);
      });
      B.dye.swap();
      const trail = U.clamp(S.fluidTrail, 0, 1);
      this.run(this.p.advect, B.dye.write, { uVel: B.vel.read.t, uSrc: B.dye.read.t }, u => {
        gl.uniform2f(u.uVelTexel, simTex[0], simTex[1]);
        gl.uniform1f(u.uDt, dt);
        gl.uniform1f(u.uDiss, 1.3 - trail * 0.9);
        const a = this.ageC;
        gl.uniform4f(u.uAge, a[0], a[1], a[2], 0.45);
      });
      B.dye.swap();
    }

    /* свечение ярких мест — раз в кадр, если дым сдвинулся */
    post() {
      const gl = this.r.gl, B = this.bufs;
      const exposure = 0.9;
      const bl = B.bloom;
      this.run(this.p.pre, bl[0], { uSrc: B.dye.read.t }, u => {
        const thr = 0.55, knee = 0.35;
        gl.uniform1f(u.uExp, exposure);
        gl.uniform3f(u.uCurve, thr - knee, knee * 2, 0.25 / knee);
        gl.uniform1f(u.uThreshold, thr);
      });
      for (let i = 1; i < bl.length; i++) {
        const src = bl[i - 1];
        this.run(this.p.blur, bl[i], { uSrc: src.t }, u => gl.uniform2f(u.uTexel, 1 / src.w, 1 / src.h));
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = bl.length - 1; i > 0; i--) {
        const src = bl[i];
        this.run(this.p.blur, bl[i - 1], { uSrc: src.t }, u => gl.uniform2f(u.uTexel, 1 / src.w, 1 / src.h));
      }
      gl.disable(gl.BLEND);
      this.exposure = exposure;
    }

    get dyeTex() { return this.bufs.dye.read.t; }
    get dyeTexel() { const d = this.bufs.dye.read; return [1 / d.w, 1 / d.h]; }
    get bloomTex() { return this.bufs.bloom[0].t; }
  }

  RSN.Fluid = Fluid;
})();
