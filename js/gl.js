/* =========================================================
   RESONANCE — WebGL-рендер
   Проход 1: «жидкий» фон из цветов обложки (низкое разрешение)
   Проход 2: композит — свечение вокруг обложки, ударные волны,
             визуализатор, виньетка, зерно
   Проход 3: частицы-боке (аддитивно)
   ========================================================= */
(function () {
  'use strict';
  const RSN = window.RSN, U = RSN.util;

  const TW = 256, HROWS = 128, BG_N = 128;
  const STYLE_ID = { none: 0, aurora: 1, ring: 2, bars: 3, ridge: 4, fluid: 5, ridge2: 7, ridge3: 8, wall: 9 };
  const RIDGES = { ridge: 1, ridge2: 1, ridge3: 1, wall: 1 };   // режимы на истории спектра
  const PLUS = { ridge2: 1, ridge3: 1, wall: 1 };                // …с битами, туманом и искрами
  /* sim/dye/glow — сетка жидкости (строк), краска и свечение (доля высоты кадра) */
  const QUALITY = {
    high:   { main: 1.0,  bg: 0.5,  parts: 1.0,  sim: 144, dye: 0.6,  iters: 22, glow: 0.3 },
    medium: { main: 0.78, bg: 0.36, parts: 0.65, sim: 120, dye: 0.55, iters: 18, glow: 0.28 },
    low:    { main: 0.56, bg: 0.26, parts: 0.4,  sim: 96,  dye: 0.5,  iters: 14, glow: 0.26 }
  };

  const VS_QUAD = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

  /* 2D simplex noise — Ashima Arts / Stefan Gustavson (MIT) */
  const NOISE = `
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}`;

  const HASH = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`;

  /* ---------- проход 1: жидкий фон ---------- */
  const FS_BG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform float uMix;
uniform float uTime;
uniform float uAspect;
uniform float uBass;
uniform float uKick;
uniform float uEnergy;
uniform float uSat;
uniform float uBright;
uniform vec2 uParallax;
uniform vec3 uTint;
uniform float uRotA;
uniform float uRotB;
${NOISE}
${HASH}
vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
vec3 cover(vec2 uv) { return mix(texture2D(uTexA, uv).rgb, texture2D(uTexB, uv).rgb, uMix); }

void main() {
  float t = uTime;
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  p *= 1.0 - 0.03 * uBass - 0.05 * uKick;
  p += uParallax;
  vec2 pr = rot2(p, uRotA);
  vec2 q = vec2(snoise(pr * 0.7 + vec2(0.0, t * 0.055)),
                snoise(pr * 0.7 + vec2(5.2, 1.3) - vec2(t * 0.047, 0.0)));
  vec2 r = vec2(snoise(pr * 1.1 + q * 1.2 + vec2(1.7, 9.2) + t * 0.071),
                snoise(pr * 1.1 + q * 1.2 + vec2(8.3, 2.8) - t * 0.063));
  vec2 w = pr + q * 0.32 + r * (0.2 + 0.1 * uEnergy);
  vec3 c1 = cover(w * 0.74 + 0.5);
  vec3 c2 = cover(rot2(p, uRotB) * 0.4 + r * 0.12 + 0.5);
  vec3 col = mix(c1, c2, 0.4);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(l), col, uSat), 0.0);
  float lp = snoise(pr * 0.5 + vec2(-t * 0.03, t * 0.02)) * 0.5 + 0.5;
  col *= 0.48 + 0.6 * lp;
  col += uTint * (0.012 + 0.03 * lp);
  col *= 0.8 * uBright * (1.0 + 0.16 * uKick + 0.05 * uBass);
  /* мягкая компрессия светов с сохранением оттенка */
  float mx = max(col.r, max(col.g, col.b));
  col /= 1.0 + mx * 0.55;
  col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

  /* ---------- проход 2: композит + визуализаторы ---------- */
  const FS_COMP = `
precision highp float;
uniform sampler2D uBg;
uniform sampler2D uHist;
uniform sampler2D uSpec;
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform float uMix;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec4 uShape;
uniform float uShapeR;
uniform float uGlow;
uniform float uVis;
uniform vec4 uGeo;
uniform vec4 uWaves[4];
uniform float uGrain;
uniform float uSeed;
uniform float uS;
uniform float uCA;
uniform float uHistHead;
uniform float uHistPhase;
uniform float uVignette;
uniform float uLevel;

#define PI 3.14159265
#define ROWS ${HROWS.toFixed(1)}
${HASH}
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
  return length(pa - ba * h);
}
vec3 spec(float u) { return texture2D(uSpec, vec2(clamp(u, 0.0, 1.0), 0.5)).rgb; }
float band(float d, float w) { return 1.0 - smoothstep(w - 0.7, w + 0.7, d); }
vec2 gBuv;   // координаты с учётом ударных волн — для визуализаторов, которым нужна та же рябь

#if STYLE == 1
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float n1(float x) { float i = floor(x), f = fract(x); return mix(hash11(i), hash11(i + 1.0), f * f * (3.0 - 2.0 * f)); }
/* «Аврора»: зеркальная волна, над ней — лучи северного сияния, под ней — отражение в «воде» */
vec3 visual(vec3 col, vec2 px) {
  float base = uGeo.x, H = uGeo.y;
  float u = px.x / uRes.x;
  float edge = smoothstep(0.0, 0.14, u) * (1.0 - smoothstep(0.86, 1.0, u));
  float k = abs(u - 0.5) * 2.0;
  vec3 cA = mix(uC1, uC2, smoothstep(0.0, 1.0, k));
  vec3 cB = mix(uC2, uC3, k);
  float y = px.y;
  vec3 add = vec3(0.0);
  float lw = 1.1 * uS;
  float live = smoothstep(0.01, 0.1, uLevel);
  if (y >= base - 1.0) {
    if (y > base + H * 3.2) return col;
    vec3 s = spec(u) * edge;
    float du = 2.0 / uRes.x;
    float sl = spec(u - du).r * edge, sr = spec(u + du).r * edge;
    float slope = (sr - sl) * H / 4.0;
    float yr = base + s.r * H;
    float yb = base + s.b * H * 1.35;
    float hb = clamp((y - base) / max(yb - base, 1.0), 0.0, 1.0);
    float inB = 1.0 - smoothstep(yb - 2.0, yb + 2.0, y);
    add += cB * inB * (0.05 + 0.12 * hb) * smoothstep(0.0, 0.05, s.b);
    float hr = clamp((y - base) / max(yr - base, 1.0), 0.0, 1.0);
    float inR = 1.0 - smoothstep(yr - 1.0, yr + 1.0, y);
    add += cA * inR * (0.05 + 0.34 * hr * hr * hr);
    float d = abs(y - yr) / sqrt(1.0 + slope * slope);
    float act = smoothstep(0.0, 0.06, s.r);
    add += mix(cA, vec3(1.0), 0.4) * band(d, lw) * (0.2 + 0.8 * act) * (0.35 + 0.65 * live);
    add += cA * (exp(-d / (7.0 * uS)) * 0.45 + exp(-d / (34.0 * uS)) * 0.16) * (0.15 + 0.85 * act);
    float up = y - yr;
    if (up > 0.0) {
      float rays = n1(u * 95.0 + uTime * 0.12) * 0.62 + n1(u * 270.0 - uTime * 0.21) * 0.38;
      rays = rays * rays * (3.0 - 2.0 * rays);
      float hgt = H * (0.35 + 2.2 * s.b);
      float cur = exp(-up / hgt) * (1.0 - exp(-up / (5.0 * uS)));
      vec3 cc = mix(cA, cB, clamp(up / (H * 1.8), 0.0, 1.0));
      add += cc * cur * (0.25 + 0.75 * rays) * (0.03 + 0.55 * s.b * s.b + 0.25 * s.r) * edge
           * (1.0 - smoothstep(base + H * 2.1, base + H * 3.1, y));
    }
  } else {
    float depth = base - y;
    if (depth > H * 1.6) return col;
    float ripple = sin(depth * 0.09 / uS - uTime * 2.4) * (1.6 * uS) * smoothstep(0.0, 40.0 * uS, depth);
    float uu = u + ripple / uRes.x;
    float e2 = smoothstep(0.0, 0.14, uu) * (1.0 - smoothstep(0.86, 1.0, uu));
    vec3 s = spec(uu) * e2;
    float my = base + depth;
    float yr = base + s.r * H;
    float fade = exp(-depth / (H * 0.32 + 1.0));
    float hr = clamp(depth / max(yr - base, 1.0), 0.0, 1.0);
    float inR = 1.0 - smoothstep(yr - 1.5, yr + 1.5, my);
    add += cA * inR * (0.03 + 0.14 * hr * hr) * fade;
    float d = abs(my - yr);
    add += cA * exp(-d / (5.0 * uS)) * 0.22 * fade;
  }
  float db = abs(y - base);
  add += mix(cA, vec3(1.0), 0.4) * (exp(-db / (1.2 * uS)) * 0.2 + exp(-db / (14.0 * uS)) * 0.05) * edge * edge;
  return col + add * uVis * smoothstep(0.004, 0.06, uLevel);
}
#endif

#if STYLE == 2
/* «Кольцо»: контур вокруг обложки (скруглённый квадрат или круг) */
vec3 visual(vec3 col, vec2 px) {
  vec2 sp = px - uShape.xy;
  float sd = sdRoundBox(sp, uShape.zw, uShapeR);
  float gap = uGeo.x, A = uGeo.y;
  if (sd < gap * 0.5 || sd > gap + A * 1.6 + 60.0 * uS) return col;
  float ang = atan(sp.x, sp.y);
  float u = 0.5 + ang / (2.0 * PI);
  float k = abs(u - 0.5) * 2.0;
  vec3 s = spec(u) * (1.0 - smoothstep(0.78, 1.0, k));
  vec3 cA = mix(uC1, uC2, smoothstep(0.0, 1.0, k));
  float rr = gap + s.r * A;
  float rg = gap + s.g * A;
  float rb = gap + s.b * A * 1.3;
  vec3 add = vec3(0.0);
  float startF = smoothstep(gap - 1.0, gap + 1.0, sd);
  float hr = clamp((sd - gap) / max(rr - gap, 1.0), 0.0, 1.0);
  float inR = startF * (1.0 - smoothstep(rr - 1.0, rr + 1.0, sd));
  add += cA * inR * (0.04 + 0.3 * hr * hr * hr);
  float inB = startF * (1.0 - smoothstep(rb - 2.0, rb + 2.0, sd));
  add += mix(uC2, uC3, k) * inB * 0.06 * smoothstep(0.0, 0.05, s.b);
  float d = abs(sd - rr);
  float act = smoothstep(0.0, 0.06, s.r);
  add += mix(cA, vec3(1.0), 0.35) * band(d, 1.1 * uS) * (0.4 + 0.6 * act);
  add += cA * (exp(-d / (7.0 * uS)) * 0.45 + exp(-d / (30.0 * uS)) * 0.15) * (0.3 + 0.7 * act);
  float dg = abs(sd - rg);
  add += mix(cA, vec3(1.0), 0.6) * band(dg, 0.6 * uS) * 0.4 * step(0.02, s.g);
  return col + add * uVis;
}
#endif

#if STYLE == 3
/* «Столбики»: капсулы с пиками и отражением */
vec3 visual(vec3 col, vec2 px) {
  float base = uGeo.x, H = uGeo.y, W = uGeo.z, N = uGeo.w;
  float left = (uRes.x - W) * 0.5;
  float bw = W / N;
  float fx = (px.x - left) / bw;
  if (fx < -1.0 || fx > N + 1.0) return col;
  float y = px.y - base;
  bool refl = y < 0.0;
  if (refl) y = -y;
  if (y > H * 1.25 + 40.0 * uS) return col;
  float hw = bw * 0.3;
  vec3 add = vec3(0.0);
  float i0 = floor(fx);
  for (int j = -1; j <= 1; j++) {
    float idx = i0 + float(j);
    if (idx < 0.0 || idx > N - 1.0) continue;
    float u = (idx + 0.5) / N;
    vec3 s = spec(u);
    float k = abs(u - 0.5) * 2.0;
    vec3 c = mix(uC1, uC2, smoothstep(0.0, 1.0, k));
    float cx = left + (idx + 0.5) * bw;
    float h = s.r * H + 2.0 * hw;
    float d = sdSeg(vec2(px.x - cx, y), vec2(0.0, hw), vec2(0.0, max(h - hw, hw))) - hw;
    float g = clamp(y / max(h, 1.0), 0.0, 1.0);
    float fill = 1.0 - smoothstep(-0.7, 0.7, d);
    if (!refl) {
      add += mix(c * 0.55, mix(c, vec3(1.0), 0.3), g) * fill * 0.9;
      add += c * exp(-max(d, 0.0) / (6.0 * uS)) * 0.16;
      float ph = s.g * H + 3.0 * hw + 3.0 * uS;
      float dp = length(vec2(px.x - cx, y - ph)) - hw * 0.85;
      add += mix(c, vec3(1.0), 0.55) * (1.0 - smoothstep(-0.7, 0.7, dp)) * 0.85 * step(0.015, s.g);
    } else {
      float fade = exp(-y / (H * 0.28 + 1.0));
      add += c * fill * 0.2 * fade * (1.0 - g * 0.5);
    }
  }
  return col + add * uVis;
}
#endif

#if STYLE == 4 || STYLE >= 7
/* «Горизонт»: история спектра в перспективе (в духе Unknown Pleasures)
   + раскалённые пики, ретро-солнце за рельефом, вариант с каркасной сеткой.
   STYLE 7 — «Горизонт+»: тот же рельеф и то же движение, плюс: удары записываются
   в строки истории и уходят вдаль световыми полосами, в низинах стелется туман,
   склоны — твёрдый подсвеченный камень, над гребнями ореол; искры с пиков — частицами.
   STYLE 8 — «Горизонт+ широкий»: хребты по всей ширине (спектр повторяется зеркально,
   боковые копии чуть старше — без швов), строк больше — рельеф уходит дальше.
   STYLE 9 — «Стена»: те же строки стоят стеной перед зрителем: свежая внизу,
   история поднимается вверх, стена отклонена назад — верхние строки дальше, теснее и мельче.
   В обоих новых режимах сдвиг камеры даёт параллакс: ближние строки смещаются сильнее дальних */
uniform vec4 uRidge;   // x: 1 — сетка, y: солнце, z: сдвиг камеры (px), w: бас
uniform vec4 uMeta;    // прямоугольник текста плеера (px): солнце под ним приглушаем
uniform vec2 uSun;     // сдвиг солнца от точки схода (px) и радиус (доля высоты)
#if STYLE == 9
uniform vec4 uMeta2;   // часы (px): стена под ними и под текстом гаснет
#define WALL_Z 2.3     // во сколько раз верхняя строка дальше нижней
#endif
#if STYLE >= 7
uniform vec4 uPlus;    // x: удар сейчас, y: сила реакции на бит
uniform sampler2D uKickH;   // удар, пришедшийся на строку истории (ROWS × 1)
float kickRow(float fi) {
  float rA = mod(uHistHead - fi + ROWS, ROWS);
  float rB = mod(uHistHead - fi - 1.0 + ROWS, ROWS);
  return mix(texture2D(uKickH, vec2((rB + 0.5) / ROWS, 0.5)).r, texture2D(uKickH, vec2((rA + 0.5) / ROWS, 0.5)).r, uHistPhase) * uPlus.y;
}
#endif
#if STYLE == 8
#define RIDGE_N 88
#elif STYLE == 9
#define RIDGE_N 64
#else
#define RIDGE_N 56
#endif
float rectMask(vec2 px, vec4 r, float soft) {
  vec2 c = (r.xy + r.zw) * 0.5, h = max((r.zw - r.xy) * 0.5, 0.0);
  vec2 d = abs(px - c) - h;
  return 1.0 - smoothstep(0.0, soft, length(max(d, 0.0)) + min(max(d.x, d.y), 0.0));
}
vec3 heat(float a, float k) {
  vec3 base = mix(uC1, uC2, smoothstep(0.0, 1.0, k));
  return mix(base, mix(uC1, vec3(1.0), 0.6), smoothstep(0.35, 0.95, a));
}
/* высота строки i в точке u: строки стоят на месте, форма перетекает между строками истории */
float rowA(float u, float fi) {
#if STYLE >= 8
  /* по всей ширине: копии спектра зеркальные (на стыках совпадают), чем дальше от центра —
     тем старше строка (плавно, без швов), чтобы повтор не бросался в глаза */
  float n = floor(u);
  float t = u - n;
  float uu = mod(n, 2.0) < 0.5 ? t : 1.0 - t;
  float x = min(fi + abs(u - 0.5) * 2.5, ROWS - 3.0) + 1.0 - uHistPhase;
  float x0 = floor(x), fr = x - x0;
  float r0 = mod(uHistHead - x0 + ROWS, ROWS), r1 = mod(uHistHead - x0 - 1.0 + ROWS, ROWS);
  float aw = mix(texture2D(uHist, vec2(uu, (r0 + 0.5) / ROWS)).r, texture2D(uHist, vec2(uu, (r1 + 0.5) / ROWS)).r, fr);
  return aw * (1.0 - 0.05 * min(abs(u - 0.5), 4.0));
#endif
  float a = 0.0;
  if (u > 0.0 && u < 1.0) {
    float rA = mod(uHistHead - fi + ROWS, ROWS);
    float rB = mod(uHistHead - fi - 1.0 + ROWS, ROWS);
    a = mix(texture2D(uHist, vec2(u, (rB + 0.5) / ROWS)).r, texture2D(uHist, vec2(u, (rA + 0.5) / ROWS)).r, uHistPhase);
  }
  return a * smoothstep(0.0, 0.14, u) * (1.0 - smoothstep(0.86, 1.0, u));
}
vec3 visual(vec3 col, vec2 px) {
  float horizon = uGeo.x, front = uGeo.y, Hf = uGeo.z, Wf = uGeo.w;
  float cx = uRes.x * 0.5 + uRidge.z;
#if STYLE == 8
  float sunX = uRes.x * 0.5;                   // солнце бесконечно далеко — от камеры не сдвигается
#else
  float sunX = cx;
#endif
#if STYLE == 9
  float clear = 1.0 - 0.9 * max(rectMask(px, uMeta, 150.0 * uS), rectMask(px, uMeta2, 100.0 * uS));
  float vanish = front + (horizon - front) / (1.0 - 1.0 / WALL_Z);   // линия схода — выше экрана
#else
  float clear = 1.0;
#endif
#if STYLE != 9
  if (uRidge.y > 0.001) {
    float R = uRes.y * uSun.y * (1.0 + 0.05 * uRidge.w);
    vec2 sd = px - vec2(sunX + uSun.x, horizon + R * 0.22);
    float rr = length(sd);
    float yy = sd.y / R;
    float disc = 1.0 - smoothstep(R - 1.5 * uS, R + 1.5 * uS, rr);
    float bandY = (0.25 - yy) / 1.25;
    float gap = step(0.0, bandY) * step(fract(yy * 5.5 + uTime * 0.25), 0.18 + 0.5 * clamp(bandY, 0.0, 1.0));
    vec3 sunC = mix(mix(uC2, uC3, 0.3), mix(uC1, vec3(1.0, 0.95, 0.85), 0.45), smoothstep(-0.9, 0.9, yy));
    float shield = 1.0 - 0.8 * rectMask(px, uMeta, 60.0 * uS);
    col = mix(col, sunC * 1.15, disc * (1.0 - gap) * uRidge.y * shield);
    col += mix(uC1, sunC, 0.5) * exp(-max(rr - R, 0.0) / (R * 0.55)) * 0.22 * uRidge.y * (0.8 + 0.4 * uRidge.w) * shield;
  }
#endif
#if STYLE >= 7
#if STYLE != 9
  if (px.y > horizon + 40.0 * uS) return col;
#endif
  vec3 glow = vec3(0.0);                       // ореол строк впереди: их линии ниже пикселя и его не закрывают
  vec3 hazeC = mix(uC2, uC3, 0.5) * 0.85 + 0.08;
#else
  if (px.y > horizon + 3.0 * uS) return col;
#endif
  float prevY = -1.0, prevZ = 0.8;
  for (int i = 0; i < RIDGE_N; i++) {
    float fi = float(i);
#if STYLE == 9
    /* стена: строки от низа экрана до верха в перспективе, выше — дальше (теснее, мельче, темнее) */
    float tw = fi / float(RIDGE_N - 1);
    float z = 1.0 + tw * (WALL_Z - 1.0);
    float iz = 1.0 / z;
    float yb = vanish - (vanish - front) * iz;
    float fog = exp(-1.5 * tw) * (1.0 - 0.5 * smoothstep(0.7, 1.0, tw));
#else
    float z = 1.0 + fi * 0.15;
    float iz = 1.0 / z;
    float yb = horizon - (horizon - front) * iz;
#if STYLE == 8
    float fog = exp(-fi * 0.042) * smoothstep(0.0, 0.5, 1.0 - fi / float(RIDGE_N));
#else
    float fog = exp(-fi * 0.06) * smoothstep(0.0, 0.62, 1.0 - fi / float(RIDGE_N));
#endif
#endif
#if STYLE >= 8
    /* строки, чей гребень заведомо ниже пикселя и ореол уже не достаёт, пропускаем без выборок */
    if (yb + Hf * iz + 90.0 * uS < px.y) { prevY = yb; prevZ = z; continue; }
    float u = 0.5 + ((px.x - uRes.x * 0.5) * z - uRidge.z) / Wf;
#else
    float u = 0.5 + (px.x - cx) * z / Wf;
#endif
    float a = rowA(u, fi);
    float yr = yb + a * Hf * iz;
    float lw = (0.55 + 0.85 * iz) * uS;
    float k = clamp(abs(u - 0.5) * 2.0, 0.0, 1.0);
#if STYLE >= 7
    float pulse = uPlus.x * 0.35 * exp(-fi * 0.5);           // передние строки чуть вспыхивают на ударе
    float depth = 1.0 - fog;
    float kr = kickRow(fi);                                  // бит, записанный в эту строку, уходит с ней вдаль
#endif
    if (px.y <= yr + lw + 1.0) {
      vec3 c = heat(a, k);
      float d = abs(px.y - yr);
      float below = 1.0 - smoothstep(yr - 2.0, yr, px.y);
#if STYLE == 9
      below *= uVis;                                               // стена гаснет целиком, без «тетрадных» полос
      vec3 res = mix(col, col * 0.3, below * (0.7 * fog + 0.1));   // стена закрывает весь экран — фон не гасим целиком
      res *= 1.0 - 0.15 * (1.0 - clear);                           // под текстом темнее — он читается
#else
      vec3 res = mix(col, col * 0.14, below * (0.9 * fog + 0.08));
#endif
#if STYLE >= 7
      /* твёрдый склон: тёмный цветной камень, светлее к вершинам, свет у гребня и светотень по наклону */
      float hRel = clamp((px.y - yb) / max(Hf * iz, 1.0), 0.0, 1.0);   // высота точки склона над подножием (0..1)
      float dB = max(yr - px.y, 0.0);
      float rim = exp(-dB / ((8.0 + 26.0 * iz) * uS));
      float du = 2.5 * uS * z / Wf;
      float slope = (rowA(u + du, fi) - rowA(u - du, fi)) * Hf * iz / (5.0 * uS);
      float lit = 0.5 + 0.5 * clamp(slope * 1.4, -1.0, 1.0);
      vec3 rock = mix(uC2, uC3, 0.4) * (0.03 + 0.07 * hRel);
      res = mix(res, res * 0.55 + rock, below * fog * 0.85);
      res += mix(c, uC2, 0.35) * rim * (0.07 + 0.5 * a) * lit * below * fog * uVis * clear;
      /* туман в низинах: стелется у подножий и медленно колышется, вершины торчат над ним */
      float mist = exp(-hRel * 4.5) * (0.3 + 0.7 * smoothstep(0.0, 0.6, fi / float(RIDGE_N)));
      mist *= 0.65 + 0.35 * sin(u * 21.0 + uTime * 0.23 + fi * 0.9) * sin(u * 8.0 - uTime * 0.15 + fi * 0.4);
      res = mix(res, hazeC * (0.22 + 0.08 * uRidge.w), clamp(mist, 0.0, 1.0) * below * 0.6 * (0.35 + 0.65 * fog));
      /* вспышка бита: вся строка светится и уходит с рельефом к горизонту */
      res += c * kr * (0.05 + 0.25 * rim) * below * fog * uVis * clear;
      c = mix(c, hazeC, depth * 0.4);
      c = mix(c, mix(c, vec3(1.0), 0.6), clamp(kr, 0.0, 1.0));
#endif
#if STYLE != 9
      if (uRidge.x > 0.5) {
        /* продольные линии по поверхности между соседними рядами */
        float tt = clamp((px.y - prevY) / max(yr - prevY, 1.0), 0.0, 1.0);
        float zz = mix(prevZ, z, tt);
#if STYLE == 8
        float uu = 0.5 + ((px.x - uRes.x * 0.5) * zz - uRidge.z) / Wf;
#else
        float uu = 0.5 + (px.x - cx) * zz / Wf;
#endif
        float gpx = abs(fract(uu * 36.0 + 0.5) - 0.5) / 36.0 * Wf / zz;
        float gf = exp(-fi * 0.05);
        res += mix(c, uC2, 0.35) * band(gpx, 0.5 * uS) * 0.55 * gf * below
             * smoothstep(0.0, 0.08, uu) * (1.0 - smoothstep(0.92, 1.0, uu));
        res += c * 0.035 * gf * below * (0.4 + a);
      }
#endif
#if STYLE == 9
      float act = (0.22 + 0.78 * smoothstep(0.02, 0.3, a)) * 0.8 * clear;   // стена во весь экран: ровные места тише
#else
      float act = 0.3 + 0.7 * smoothstep(0.0, 0.12, a);
#endif
#if STYLE >= 7
      float soft = 0.7 + 1.4 * depth;                        // дальние линии мягче — как не в фокусе
      float line = 1.0 - smoothstep(lw - soft, lw + soft, d);
      float boost = 1.0 + 0.45 * exp(-fi * 0.9) + pulse + kr * 2.2;   // свежая строка — «перо»; строка с битом горит
      res += mix(c, vec3(1.0), 0.2 * iz) * (line * (0.3 + 0.7 * fog) + exp(-d / (5.0 * uS)) * (0.18 + 0.35 * a) * fog) * act * boost * uVis;
      return res + glow * uVis * clear;
#else
      res += mix(c, vec3(1.0), 0.2 * iz) * (band(d, lw) * (0.3 + 0.7 * fog) + exp(-d / (5.0 * uS)) * (0.18 + 0.35 * a) * fog) * act * uVis;
      return res;
#endif
    }
#if STYLE >= 7
    /* строка ниже пикселя: её линия светит вверх мягким ореолом */
    float up = px.y - yr;
    glow += mix(heat(a, k), hazeC, depth * 0.4) * exp(-up / ((3.0 + 9.0 * iz) * uS)) * (0.035 + 0.4 * a * a) * fog * (1.0 + pulse + kr * 1.6);
#endif
    prevY = yr; prevZ = z;
  }
#if STYLE >= 7
  return col + glow * uVis * clear;
#else
  return col;
#endif
}
#endif

#if STYLE == 5
/* «Жидкий свет»: дым из симуляции жидкости с объёмной подсветкой и свечением */
uniform sampler2D uFluid;
uniform sampler2D uBloomT;
uniform vec2 uFluidTexel;
uniform vec4 uFluidK;   // x: экспозиция дыма, z: свечение
uniform vec4 uMeta;
float rectMask(vec2 px, vec4 r, float soft) {
  vec2 c = (r.xy + r.zw) * 0.5, h = max((r.zw - r.xy) * 0.5, 0.0);
  vec2 d = abs(px - c) - h;
  return 1.0 - smoothstep(0.0, soft, length(max(d, 0.0)) + min(max(d.x, d.y), 0.0));
}
/* тональная кривая с сохранением оттенка: густой дым остаётся цветным, лишь ядро чуть белеет */
vec3 tone(vec3 c) {
  float m = max(max(c.r, c.g), c.b);
  vec3 keep = c * ((1.0 - exp(-m * uFluidK.x)) / max(m, 1e-4));
  return mix(keep, vec3(1.0) - exp(-c * uFluidK.x), 0.1);
}
vec3 visual(vec3 col, vec2 px) {
  vec2 uv = gBuv;
  vec3 c = tone(texture2D(uFluid, uv).rgb);
  /* рельеф по яркости дыма — объём и мягкий блик, как у густого тумана */
  float l = length(tone(texture2D(uFluid, uv - vec2(uFluidTexel.x, 0.0)).rgb));
  float r = length(tone(texture2D(uFluid, uv + vec2(uFluidTexel.x, 0.0)).rgb));
  float t = length(tone(texture2D(uFluid, uv + vec2(0.0, uFluidTexel.y)).rgb));
  float b = length(tone(texture2D(uFluid, uv - vec2(0.0, uFluidTexel.y)).rgb));
  vec3 n = normalize(vec3(r - l, t - b, 0.16));
  float lit = clamp(dot(n, vec3(-0.38, 0.52, 0.76)) * 0.55 + 0.55, 0.42, 1.18);
  vec3 smoke = c * lit;
  float shield = 1.0 - 0.72 * rectMask(px, uMeta, 90.0 * uS);   // под текстом дым тише
  smoke *= shield;
  float a = clamp(max(smoke.r, max(smoke.g, smoke.b)), 0.0, 1.0);
  col = col * (1.0 - 0.55 * a) + smoke;
  col += texture2D(uBloomT, uv).rgb * uFluidK.z * (0.5 + 0.5 * shield);
  return col;
}
#endif


void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 uv = px / uRes;

  vec2 disp = vec2(0.0);
  float wl = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 w = uWaves[i];
    if (w.w > 0.001) {
      vec2 d = px - w.xy;
      float dist = length(d);
      float x = (dist - w.z) / (50.0 * uS);
      float e = exp(-x * x);
      disp += (d / max(dist, 1.0)) * (-x * e) * w.w * 16.0 * uS;
      wl += e * w.w;
    }
  }
  vec2 buv = (px + disp) / uRes;
  gBuv = buv;
  vec2 cd = uv - 0.5;
  vec3 col;
  if (uCA > 0.0004) {
    col = vec3(texture2D(uBg, buv + cd * uCA).r, texture2D(uBg, buv).g, texture2D(uBg, buv - cd * uCA).b);
  } else {
    col = texture2D(uBg, buv).rgb;
  }

  if (uGlow > 0.001) {
    vec2 sp = px - uShape.xy;
    float sd = sdRoundBox(sp, uShape.zw, uShapeR);
    vec2 guv = clamp(vec2(0.5 + sp.x / (2.0 * uShape.z), 0.5 - sp.y / (2.0 * uShape.w)), 0.0, 1.0);
    vec3 g = mix(texture2D(uTexA, guv).rgb, texture2D(uTexB, guv).rgb, uMix);
    vec3 gg = g * g;
    gg = max(mix(vec3(dot(gg, vec3(0.299, 0.587, 0.114))), gg, 1.3), 0.0);
    float fall = exp(-max(sd, 0.0) / (min(uShape.z, uShape.w) * 0.45));
    col += gg * 1.5 * fall * uGlow;
  }

  /* низ темнее — визуализатору нужен контраст; верх чуть темнее — для часов */
  col *= 1.0 - 0.38 * (1.0 - smoothstep(0.0, 0.34, uv.y));
  col *= 1.0 - 0.16 * smoothstep(0.72, 1.0, uv.y);

#if STYLE > 0
  col = visual(col, px);
#endif

  col += mix(uC1, vec3(1.0), 0.25) * wl * 0.09;
  vec2 vq = cd * vec2(uRes.x / uRes.y, 1.0);
  col *= 1.0 - uVignette * smoothstep(0.38, 1.2, length(vq));
  float n = hash12(px + uSeed * 1731.0) - 0.5;
  col += n * (uGrain * 0.09 + 0.006);
  gl_FragColor = vec4(col, 1.0);
}`;

  /* ---------- частицы ---------- */
  const VS_PART = `
attribute vec4 aPos;
attribute vec4 aCol;
uniform vec2 uRes;
varying vec3 vCol;
varying float vSoft;
void main() {
  vec2 c = aPos.xy / uRes * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
  gl_PointSize = aPos.z;
  vCol = aCol.rgb;
  vSoft = aPos.w;
}`;
  const FS_PART = `
precision mediump float;
varying vec3 vCol;
varying float vSoft;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = length(q);
  if (d > 1.0) discard;
  float edge = mix(0.3, 0.9, vSoft);
  float a = 1.0 - smoothstep(1.0 - edge, 1.0, d);
  a *= mix(1.0, 0.6 + 0.4 * smoothstep(0.2, 0.92, d), vSoft * 0.85);
  gl_FragColor = vec4(vCol * a, 1.0);
}`;

  class Particles {
    constructor() { this.list = []; this.data = new Float32Array(0); this.impulse = 0; }
    ensure(n, W, H) {
      while (this.list.length < n) this.list.push(this.spawn(W, H));
      if (this.list.length > n) this.list.length = n;
      if (this.data.length < n * 8) this.data = new Float32Array(Math.ceil(n * 1.25) * 8);
    }
    spawn(W, H) {
      const r = Math.random();
      return {
        x: Math.random() * W, y: Math.random() * H,
        z: Math.pow(Math.random(), 1.7),
        ph: Math.random() * 6.2832, sw: 0.4 + Math.random() * 0.9, tw: 0.5 + Math.random() * 1.6,
        slot: r < 0.36 ? 0 : r < 0.6 ? 1 : r < 0.74 ? 2 : 3,
        vx: 0, vy: 0
      };
    }
    update(dt, t, W, H, s, en, cx, cy, pulse) {
      const imp = this.impulse * pulse;
      this.impulse = 0;
      const m = 80 * s;
      const kv = Math.min(1, dt * 1.4), kx = Math.min(1, dt * 0.7);
      for (let i = 0; i < this.list.length; i++) {
        const p = this.list[i];
        const depth = 0.25 + 0.75 * p.z;
        const rise = (6 + 24 * depth) * s * (0.5 + 1.4 * en);
        p.vy += (-rise - p.vy) * kv;
        p.vx += (Math.sin(t * 0.3 * p.sw + p.ph) * 10 * depth * s - p.vx) * kx;
        if (imp > 0) {
          const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) + 1;
          const f = (imp * 300 * depth * s) / (1 + d / (420 * s));
          p.vx += (dx / d) * f; p.vy += (dy / d) * f;
        }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.y < -m) { p.y = H + m * Math.random(); p.x = Math.random() * W; }
        else if (p.y > H + m) p.y = -m;
        if (p.x < -m) p.x += W + 2 * m; else if (p.x > W + m) p.x -= W + 2 * m;
      }
    }
    fill(t, s, pal, high, maxPoint, alphaMul, mx, my) {
      const d = this.data;
      const cols = [pal.c1, pal.c2, pal.c3, [236, 238, 255]];
      let o = 0;
      for (let i = 0; i < this.list.length; i++) {
        const p = this.list[i];
        const depth = 0.25 + 0.75 * p.z;
        const size = Math.min(maxPoint, (1.6 + Math.pow(p.z, 2.2) * 36) * s);
        const tw = 0.62 + 0.38 * Math.sin(t * p.tw + p.ph);
        const a = (0.62 - 0.5 * p.z) * tw * (0.7 + 0.7 * high) * alphaMul;
        const c = cols[p.slot];
        d[o] = p.x + mx * 36 * depth * s;
        d[o + 1] = p.y + my * 22 * depth * s;
        d[o + 2] = size;
        d[o + 3] = Math.min(1, p.z * 1.3);
        d[o + 4] = (c[0] / 255) * a;
        d[o + 5] = (c[1] / 255) * a;
        d[o + 6] = (c[2] / 255) * a;
        d[o + 7] = 0;
        o += 8;
      }
      return d.subarray(0, o);
    }
  }

  /* «Горизонт+»: искры поднимаются с самых громких пиков свежей строки, на ударах — гуще */
  const smooth = (a, b, x) => { const t = U.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  class Sparks {
    constructor() { this.list = []; this.data = new Float32Array(0); }
    /* g: геометрия передней строки в пикселях кадра (y — от низа) */
    update(dt, disp, g, s, kick, vis) {
      /* порог относительный: искры летят с самых высоких пиков, как бы тихо ни звучал трек */
      let mx = 0;
      for (let j = 6; j < 250; j++) if (disp[j] > mx) mx = disp[j];
      const thr = Math.max(0.12, mx * 0.7), rate = (1.2 + 6 * kick) * vis;
      for (let j = 6; mx > 0.12 && j < 250; j += 5) {
        const a = disp[j];
        if (a < thr || a < disp[j - 5] || a < disp[j + 5]) continue;   // только локальные пики
        if (Math.random() > (0.25 + (a - thr) / (mx - thr + 0.05)) * rate * dt) continue;
        /* у широких режимов края не гаснут — гребни по всей ширине */
        const u = (j + 0.5) / 256, env = g.wide ? 1 - 0.05 * Math.abs(u - 0.5) : smooth(0, 0.14, u) * (1 - smooth(0.86, 1, u));
        if (env < 0.2) continue;
        this.list.push({
          x: g.cx + (u - 0.5) * g.Wf, y: g.front + a * env * g.Hf,
          vx: (Math.random() - 0.5) * 16 * s, vy: (22 + 46 * Math.random() + 70 * kick) * s,
          life: 0, max: 1.1 + Math.random() * 1.5, size: (1.3 + Math.random() * 2.3) * s,
          a: Math.max(a, 0.5), k: Math.abs(u - 0.5) * 2
        });
      }
      if (this.list.length > 360) this.list.splice(0, this.list.length - 360);
      for (let i = 0; i < this.list.length; i++) {
        const p = this.list[i];
        p.life += dt;
        p.vx += (Math.random() - 0.5) * 30 * s * dt;
        p.vy *= Math.exp(-dt * 0.7);
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      this.list = this.list.filter(p => p.life < p.max);
    }
    fill(H, pal) {
      const n = this.list.length;
      if (this.data.length < n * 8) this.data = new Float32Array(Math.ceil(n * 1.5 + 8) * 8);
      const d = this.data, c1 = pal.c1, c2 = pal.c2;
      let o = 0;
      for (let i = 0; i < n; i++) {
        const p = this.list[i];
        const t = p.life / p.max, fade = Math.sin(Math.PI * Math.min(1, t * 1.6)) * (1 - t * 0.4);
        const h = smooth(0.35, 0.95, p.a), k = smooth(0, 1, p.k);
        const alpha = fade * 0.9;
        for (let c = 0; c < 3; c++) {
          const base = c1[c] + (c2[c] - c1[c]) * k, hot = c1[c] + (255 - c1[c]) * 0.6;
          d[o + 4 + c] = (base + (hot - base) * h) / 255 * alpha;
        }
        d[o] = p.x; d[o + 1] = H - p.y; d[o + 2] = p.size * (1 - t * 0.5); d[o + 3] = 0.35; d[o + 7] = 0;
        o += 8;
      }
      return d.subarray(0, o);
    }
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ok = false;
      this.lost = false;
      this.coverA = null;
      this.coverB = null;
      this.mix = 1;
      this.flow = Math.random() * 60;
      this.time = 0;
      this.waves = [];
      this.waveData = new Float32Array(16);
      this.quality = 'high';
      this.parts = new Particles();
      this.sparks = new Sparks();
      this.seed = 0;
      this.seedT = 0;
      canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; this.ok = false; }, false);
      canvas.addEventListener('webglcontextrestored', () => {
        this.lost = false;
        try { this.init(); } catch (err) { console.error(err); if (window.RSN_ERR) window.RSN_ERR('WebGL restore: ' + err.message); }
      }, false);
      this.init();
    }

    init() {
      const attrs = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false };
      const gl = this.canvas.getContext('webgl', attrs) || this.canvas.getContext('experimental-webgl', attrs);
      if (!gl) throw new Error('WebGL недоступен');
      this.gl = gl;
      const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
      this.maxPoint = range && range[1] ? range[1] : 64;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);

      this.quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

      this.pBg = this.program(VS_QUAD, FS_BG, '', ['aPos']);
      this.pPart = this.program(VS_PART, FS_PART, '', ['aPos', 'aCol']);
      this.comp = {};

      this.texA = this.texture(BG_N, BG_N, gl.RGBA, gl.MIRRORED_REPEAT, this.coverA);
      this.texB = this.texture(BG_N, BG_N, gl.RGBA, gl.MIRRORED_REPEAT, this.coverB || this.coverA);
      this.texSpec = this.texture(TW, 1, gl.RGBA, gl.CLAMP_TO_EDGE, null);
      this.texHist = this.texture(TW, HROWS, gl.LUMINANCE, gl.CLAMP_TO_EDGE, null);
      this.texKick = this.texture(HROWS, 1, gl.LUMINANCE, gl.CLAMP_TO_EDGE, null);
      this.histSeen = -1;
      this.partBuf = gl.createBuffer();

      this.fbo = null;
      this.fboTex = null;
      this.W = this.H = this.bgW = this.bgH = 0;
      this.ok = true;
      this.resize();
      if (RSN.Fluid) {
        if (!this.fluid) this.fluid = new RSN.Fluid(this);
        this.fluid.init();
      }
    }

    program(vsSrc, fsSrc, defines, attribs) {
      const gl = this.gl;
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
          const log = gl.getShaderInfoLog(s);
          gl.deleteShader(s);
          throw new Error('шейдер: ' + log);
        }
        return s;
      };
      const vs = compile(gl.VERTEX_SHADER, vsSrc);
      const fs = compile(gl.FRAGMENT_SHADER, defines + fsSrc);
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      attribs.forEach((name, i) => gl.bindAttribLocation(p, i, name));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('линковка: ' + gl.getProgramInfoLog(p));
      const u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0;
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(p, i);
        u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
      }
      return { p, u };
    }

    compFor(style) {
      const id = STYLE_ID[style] !== undefined ? STYLE_ID[style] : 1;
      if (!this.comp[id]) this.comp[id] = this.program(VS_QUAD, FS_COMP, '#define STYLE ' + id + '\n', ['aPos']);
      return this.comp[id];
    }

    texture(w, h, fmt, wrap, data) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      const bpp = fmt === gl.LUMINANCE ? 1 : 4;
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, fmt, gl.UNSIGNED_BYTE, data || new Uint8Array(w * h * bpp));
      return t;
    }

    upload(tex, px) {
      if (!this.ok || !px) return;
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BG_N, BG_N, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }

    resize() {
      if (!this.ok) return;
      const gl = this.gl;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const q = QUALITY[this.quality] || QUALITY.high;
      const cw = Math.max(1, window.innerWidth), ch = Math.max(1, window.innerHeight);
      let W = Math.round(cw * dpr * q.main), H = Math.round(ch * dpr * q.main);
      const cap = 3840 / Math.max(W, H);
      if (cap < 1) { W = Math.round(W * cap); H = Math.round(H * cap); }
      W = Math.max(W, 16); H = Math.max(H, 16);
      if (W !== this.W || H !== this.H) {
        this.canvas.width = W; this.canvas.height = H;
        this.W = W; this.H = H;
      }
      let bw = Math.round(cw * dpr * q.bg), bh = Math.round(ch * dpr * q.bg);
      const bcap = 1280 / Math.max(bw, bh);
      if (bcap < 1) { bw = Math.round(bw * bcap); bh = Math.round(bh * bcap); }
      bw = Math.max(bw, 16); bh = Math.max(bh, 16);
      if (bw !== this.bgW || bh !== this.bgH || !this.fbo) {
        if (this.fbo) { gl.deleteFramebuffer(this.fbo); gl.deleteTexture(this.fboTex); }
        this.fboTex = this.texture(bw, bh, gl.RGBA, gl.CLAMP_TO_EDGE, null);
        this.fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.bgW = bw; this.bgH = bh;
      }
      this.cssW = cw; this.cssH = ch;
      this.k = W / cw;
    }

    /* новая обложка: текущий кадр перехода «запекается» в A, новая — в B */
    setCover(px, instant) {
      if (!px) return;
      if (instant || !this.coverB) {
        this.coverA = px; this.coverB = px; this.mix = 1;
      } else {
        const m = U.easeInOutCubic(U.clamp(this.mix, 0, 1));
        const a = this.coverA, b = this.coverB;
        const A = new Uint8Array(px.length);
        if (m >= 0.999) A.set(b);
        else if (m <= 0.001) A.set(a);
        else for (let i = 0; i < A.length; i++) A[i] = a[i] + (b[i] - a[i]) * m;
        this.coverA = A; this.coverB = px; this.mix = 0;
        /* через много часов время течения велико для float32 — сбрасываем в момент смены обложки */
        if (this.flow > 20000) this.flow = this.flow % 600;
      }
      this.upload(this.texA, this.coverA);
      this.upload(this.texB, this.coverB);
    }

    addWave(strength) {
      if (this.waves.length >= 4) this.waves.shift();
      this.waves.push({ age: 0, life: 1.5, s: strength });
    }

    kickParticles(strength) { this.parts.impulse = Math.max(this.parts.impulse, strength); }

    bindQuad() {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }

    /* st: { S, audio, shape, pal, glow, bright, motion, mouse, partAlpha, visAlpha } */
    render(dt, st) {
      if (!this.ok || this.lost) return;
      const gl = this.gl;
      if (gl.isContextLost()) return;
      const S = st.S, audio = st.audio, pal = st.pal;
      if (this.quality !== S.quality) { this.quality = S.quality; this.resize(); }
      if (this.cssW !== window.innerWidth || this.cssH !== window.innerHeight) this.resize();

      this.time = (this.time + dt) % 86400;
      const pulse = S.beatPulse;
      const kick = audio.kick * pulse;
      const en = audio.levels.energy, bass = audio.levels.bass;
      this.flow += dt * S.bgMotion * st.motion * (0.5 + 0.9 * en + 0.5 * kick);
      if (this.mix < 1) this.mix = Math.min(1, this.mix + dt / 2.6);
      const mixE = U.easeInOutCubic(this.mix);
      const W = this.W, H = this.H, k = this.k;
      const uS = k * U.clamp(this.cssH / 1080, 0.75, 2);
      let style = STYLE_ID[S.visualizer] !== undefined ? S.visualizer : 'aurora';
      const q = QUALITY[this.quality] || QUALITY.high;
      let fl = false;

      /* спектр и история */
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texSpec);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TW, 1, gl.RGBA, gl.UNSIGNED_BYTE, audio.tex);
      if (RIDGES[style] && this.histSeen !== audio.histPushes) {
        gl.bindTexture(gl.TEXTURE_2D, this.texHist);
        if (audio.histPushes - this.histSeen === 1) {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, audio.histHead, TW, 1, gl.LUMINANCE, gl.UNSIGNED_BYTE, audio.histRow);
        } else {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TW, HROWS, gl.LUMINANCE, gl.UNSIGNED_BYTE, audio.hist);
        }
        if (PLUS[style]) {
          gl.bindTexture(gl.TEXTURE_2D, this.texKick);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, HROWS, 1, gl.LUMINANCE, gl.UNSIGNED_BYTE, audio.histKick);
        }
        this.histSeen = audio.histPushes;
      }

      /* «Жидкий свет»: шаг симуляции. Нет half-float — показываем «Аврору» */
      if (style === 'fluid') {
        fl = !!(this.fluid && this.fluid.ok) && this.fluid.step(dt, st, W, H, k, q);
        if (!fl) style = 'aurora';
      }

      const c1 = pal.c1, c2 = pal.c2, c3 = pal.c3;

      /* ---- проход 1: жидкий фон из цветов обложки ---- */
      let P = this.pBg, u = P.u, bgTex = this.fboTex;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, this.bgW, this.bgH);
      gl.useProgram(P.p);
      this.bindQuad();
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texA);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texB);
      gl.uniform1i(u.uTexA, 0);
      gl.uniform1i(u.uTexB, 1);
      gl.uniform1f(u.uMix, mixE);
      gl.uniform1f(u.uTime, this.flow);
      gl.uniform1f(u.uRotA, (this.flow * 0.021) % (Math.PI * 2));
      gl.uniform1f(u.uRotB, (-this.flow * 0.013) % (Math.PI * 2));
      gl.uniform1f(u.uAspect, W / H);
      gl.uniform1f(u.uBass, bass * pulse);
      gl.uniform1f(u.uKick, kick);
      gl.uniform1f(u.uEnergy, en);
      gl.uniform1f(u.uSat, S.bgSaturation * 1.3);
      gl.uniform1f(u.uBright, S.bgBrightness * st.bright * (fl ? 0.6 : 1));   // под светящимся дымом фон темнее
      gl.uniform2f(u.uParallax, st.mouse.x * 0.03, -st.mouse.y * 0.03);
      gl.uniform3f(u.uTint, c1[0] / 255, c1[1] / 255, c1[2] / 255);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      /* ---- проход 2: композит ---- */
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      P = this.compFor(style); u = P.u;
      gl.useProgram(P.p);
      this.bindQuad();
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bgTex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texHist);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.texSpec);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.texA);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.texB);
      gl.uniform1i(u.uBg, 0);
      gl.uniform1i(u.uHist, 1);
      gl.uniform1i(u.uSpec, 2);
      gl.uniform1i(u.uTexA, 3);
      gl.uniform1i(u.uTexB, 4);
      gl.uniform1f(u.uMix, mixE);
      gl.uniform2f(u.uRes, W, H);
      gl.uniform1f(u.uTime, this.time);
      gl.uniform3f(u.uC1, c1[0] / 255, c1[1] / 255, c1[2] / 255);
      gl.uniform3f(u.uC2, c2[0] / 255, c2[1] / 255, c2[2] / 255);
      gl.uniform3f(u.uC3, c3[0] / 255, c3[1] / 255, c3[2] / 255);

      const sh = st.shape;
      const scx = sh.cx * k, scyTop = sh.cy * k, scy = H - scyTop;
      const shw = Math.max(1, sh.hw * k), shh = Math.max(1, sh.hh * k);
      gl.uniform4f(u.uShape, scx, scy, shw, shh);
      gl.uniform1f(u.uShapeR, Math.min(sh.r * k, shw, shh));
      gl.uniform1f(u.uGlow, st.glow * (fl ? 0.6 : 1));
      gl.uniform1f(u.uVis, st.visAlpha);
      if (fl) {
        const F = this.fluid;
        gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, F.dyeTex);
        gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, F.bloomTex);
        gl.uniform1i(u.uFluid, 5);
        gl.uniform1i(u.uBloomT, 6);
        const tx = F.dyeTexel;
        gl.uniform2f(u.uFluidTexel, tx[0], tx[1]);
        gl.uniform4f(u.uFluidK, F.exposure, 0, 0.9, 0);
      }
      if (RIDGES[style] || fl) {
        const mr = st.meta;
        if (mr) gl.uniform4f(u.uMeta, mr.l * k, H - mr.b * k, mr.r * k, H - mr.t * k);
        else gl.uniform4f(u.uMeta, -1e5, -1e5, -1e5 + 1, -1e5 + 1);
      }
      if (style === 'aurora') gl.uniform4f(u.uGeo, H * 0.115, H * 0.15, 0, 0);
      else if (style === 'ring') { const ref = Math.min(shw, shh) * 2; gl.uniform4f(u.uGeo, ref * 0.035 + 4 * uS, ref * 0.21, 0, 0); }
      else if (style === 'bars') { const bwid = W * 0.62; gl.uniform4f(u.uGeo, H * 0.1, H * 0.16, bwid, U.clamp(Math.round(bwid / (24 * uS) / 2) * 2, 24, 96)); }
      else if (RIDGES[style]) {
        if (PLUS[style]) {
          gl.uniform4f(u.uPlus, kick, pulse, 0, 0);
          gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.texKick);
          gl.uniform1i(u.uKickH, 5);
        }
        /* горизонт: дальний край, первая строка, высота пиков, ширина; стена: верх, низ, высота пиков, ширина */
        if (style === 'wall') {
          gl.uniform4f(u.uGeo, H * 0.97, H * 0.03, H * 0.1, W * 1.06);
          const cr = st.clock;
          if (cr) gl.uniform4f(u.uMeta2, cr.l * k, H - cr.b * k, cr.r * k, H - cr.t * k);
          else gl.uniform4f(u.uMeta2, -1e5, -1e5, -1e5 + 1, -1e5 + 1);
        } else gl.uniform4f(u.uGeo, H * 0.31, H * 0.035, H * 0.2, W * 1.06);
        const camX = (S.parallax ? st.mouse.x * W * 0.035 : 0) + Math.sin(this.time * 0.07) * W * 0.012;
        this.camX = camX;
        const wall = style === 'wall';
        gl.uniform4f(u.uRidge, S.ridgeStyle === 'grid' && !wall ? 1 : 0, S.ridgeSun && !wall ? 1 : 0, camX, bass * pulse);
        const mr = st.meta;
        /* в центральной раскладке плеер закрывает точку схода — солнце садится сбоку, правее текста */
        const side = S.layout === 'center' && mr;
        const sunR = side ? 0.095 : 0.12;
        const sunX = side ? U.clamp(mr.r * k + H * sunR * 1.35 - W / 2, W * 0.22, W * 0.4) : 0;
        gl.uniform2f(u.uSun, sunX, sunR);
      }

      for (let i = 0; i < this.waves.length; i++) this.waves[i].age += dt;
      this.waves = this.waves.filter(w => w.age < w.life);
      const wv = this.waveData;
      for (let i = 0; i < 4; i++) {
        const w = this.waves[i];
        wv[i * 4] = scx;
        wv[i * 4 + 1] = scy;
        wv[i * 4 + 2] = w ? Math.max(shw, shh) * 0.9 + w.age * 0.62 * H : 0;
        wv[i * 4 + 3] = w ? w.s * Math.pow(1 - w.age / w.life, 2) : 0;
      }
      gl.uniform4fv(u.uWaves, wv);
      gl.uniform1f(u.uGrain, S.grain);
      this.seedT += dt;
      if (this.seedT > 1 / 24) { this.seedT = 0; this.seed = Math.random(); }
      gl.uniform1f(u.uSeed, this.seed);
      gl.uniform1f(u.uS, uS);
      gl.uniform1f(u.uCA, 0.0035 * kick);
      gl.uniform1f(u.uHistHead, audio.histHead);
      gl.uniform1f(u.uHistPhase, audio.histPhase);
      gl.uniform1f(u.uVignette, 0.42);
      gl.uniform1f(u.uLevel, Math.min(1, en * 1.5 + bass * 0.5));
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      /* ---- проход 3: частицы ---- */
      const n = Math.round(S.particles * 340 * q.parts * (fl ? 0.45 : 1));
      if (n > 0 && st.partAlpha > 0.001) {
        const parts = this.parts;
        parts.ensure(n, W, H);
        parts.update(dt, this.time, W, H, uS, en, scx, scyTop, pulse);
        const mx = S.parallax ? st.mouse.x : 0, my = S.parallax ? st.mouse.y : 0;
        const data = parts.fill(this.time, uS, pal, audio.levels.high, this.maxPoint, st.partAlpha, mx, my);
        P = this.pPart;
        gl.useProgram(P.p);
        gl.uniform2f(P.u.uRes, W, H);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArrays(gl.POINTS, 0, data.length / 8);
        gl.disable(gl.BLEND);
        gl.disableVertexAttribArray(1);
      }

      /* ---- «Горизонт+»: искры с пиков ---- */
      if (PLUS[style]) {
        const wall = style === 'wall';
        const g = { cx: W * 0.5 + (this.camX || 0), Wf: W * 1.06, front: H * (wall ? 0.03 : 0.035), Hf: H * (wall ? 0.1 : 0.2), wide: style !== 'ridge2' };
        this.sparks.update(dt, audio.disp, g, uS, kick, st.visAlpha);
        if (this.sparks.list.length) {
          const data = this.sparks.fill(H, pal);
          P = this.pPart;
          gl.useProgram(P.p);
          gl.uniform2f(P.u.uRes, W, H);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
          gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
          gl.enableVertexAttribArray(0);
          gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
          gl.enableVertexAttribArray(1);
          gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.drawArrays(gl.POINTS, 0, data.length / 8);
          gl.disable(gl.BLEND);
          gl.disableVertexAttribArray(1);
        }
      } else if (this.sparks.list.length) this.sparks.list.length = 0;
    }
  }

  RSN.Renderer = Renderer;
})();
