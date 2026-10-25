/* =========================================================
   RESONANCE — утилиты: математика, цвет, время
   ========================================================= */
(function () {
  'use strict';
  const RSN = (window.RSN = window.RSN || {});

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  /* экспоненциальное сглаживание, не зависящее от частоты кадров */
  const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
  const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

  /* пружина: стабильна при любом dt за счёт подшагов */
  class Spring {
    constructor(value, stiffness, damping) {
      this.x = value; this.v = 0; this.target = value;
      this.k = stiffness; this.c = damping;
    }
    step(dt) {
      const n = Math.max(1, Math.ceil(dt * 240));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        this.v += (this.k * (this.target - this.x) - this.c * this.v) * h;
        this.x += this.v * h;
      }
      return this.x;
    }
  }

  /* ---------- цвет: sRGB <-> OKLab / OKLCH ---------- */
  const srgbToLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const linToSrgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

  function rgbToOklab(r, g, b) {
    const lr = srgbToLin(r / 255), lg = srgbToLin(g / 255), lb = srgbToLin(b / 255);
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    ];
  }
  function oklabToLin(L, a, b) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ];
  }
  const inGamut = c => c[0] > -0.0005 && c[0] < 1.0005 && c[1] > -0.0005 && c[1] < 1.0005 && c[2] > -0.0005 && c[2] < 1.0005;
  const linToRgb255 = c => [0, 1, 2].map(i => Math.round(clamp(linToSrgb(clamp(c[i], 0, 1)), 0, 1) * 255));

  /* OKLCH -> sRGB (0..255); если цвет вне охвата — уменьшаем хрому */
  function oklchToRgb(L, C, h) {
    let c = C;
    for (let i = 0; i < 28; i++) {
      const lin = oklabToLin(L, c * Math.cos(h), c * Math.sin(h));
      if (inGamut(lin)) return linToRgb255(lin);
      c *= 0.9;
    }
    return linToRgb255(oklabToLin(L, 0, 0));
  }
  function rgbToOklch(r, g, b) {
    const lab = rgbToOklab(r, g, b);
    return [lab[0], Math.hypot(lab[1], lab[2]), Math.atan2(lab[2], lab[1])];
  }
  /* угловое расстояние между оттенками (радианы) */
  const hueDist = (a, b) => { let d = Math.abs(a - b) % (Math.PI * 2); return d > Math.PI ? Math.PI * 2 - d : d; };

  const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const triplet = c => (c[0] | 0) + ' ' + (c[1] | 0) + ' ' + (c[2] | 0);

  /* цвет из свойства Wallpaper Engine: "0.5 0.2 1.0" */
  function parseWEColor(str) {
    const p = String(str).trim().split(/\s+/).map(Number);
    return [0, 1, 2].map(i => clamp(isFinite(p[i]) ? p[i] : 0, 0, 1) * 255);
  }
  /* "#rrggbb" / "rgb(r,g,b)" -> [r,g,b] */
  function parseCssColor(str) {
    if (!str) return null;
    str = String(str).trim();
    let m = /^#?([0-9a-f]{6})$/i.exec(str);
    if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    m = /^rgba?\(([^)]+)\)$/i.exec(str);
    if (m) { const p = m[1].split(/[\s,\/]+/).map(Number); if (p.length >= 3) return [p[0], p[1], p[2]]; }
    return null;
  }

  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const ss = s < 10 ? '0' + s : String(s);
    if (h > 0) return h + ':' + (m < 10 ? '0' + m : m) + ':' + ss;
    return m + ':' + ss;
  }

  const RU_DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  RSN.util = {
    clamp, lerp, smoothstep, damp, easeInOutCubic, easeOutCubic, Spring,
    srgbToLin, linToSrgb, rgbToOklab, oklabToLin, oklchToRgb, rgbToOklch, hueDist,
    mixRgb, triplet, parseWEColor, parseCssColor, hashString, mulberry32,
    formatTime, RU_DAYS, RU_MONTHS
  };
})();
