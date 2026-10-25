/* =========================================================
   RESONANCE — работа с обложкой:
   палитра (k-means в OKLab), размытая текстура для жидкого фона,
   подготовка картинки для показа, генеративные обложки
   ========================================================= */
(function () {
  'use strict';
  const RSN = window.RSN, U = RSN.util;

  const BG_N = 128;  // размер текстуры фона (степень двойки — нужен MIRRORED_REPEAT)

  const LUT_LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) LUT_LIN[i] = U.srgbToLin(i / 255);
  const LUT_SRGB = new Uint8Array(4096);
  for (let i = 0; i < 4096; i++) LUT_SRGB[i] = Math.round(U.linToSrgb(i / 4095) * 255);
  const toSrgb8 = v => LUT_SRGB[v <= 0 ? 0 : v >= 1 ? 4095 : (v * 4095 + 0.5) | 0];

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function ctx2d(c) {
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    return g;
  }
  const sizeOf = img => [img.naturalWidth || img.width || 0, img.naturalHeight || img.height || 0];

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => (img.naturalWidth ? resolve(img) : reject(new Error('empty image')));
      img.onerror = () => reject(new Error('image load failed'));
      img.src = src;
    });
  }

  /* квадратный кроп по центру + качественный ресайз (уменьшение половинными шагами) */
  function toSquare(img, size) {
    const [w, h] = sizeOf(img);
    const s = Math.min(w, h);
    if (!s) return null;
    const sx = (w - s) / 2, sy = (h - s) / 2;
    let cs = Math.min(s, Math.max(size, 2048));
    let cur = makeCanvas(cs, cs);
    ctx2d(cur).drawImage(img, sx, sy, s, s, 0, 0, cs, cs);
    while (cs > size * 2) {
      const ns = Math.max(size, Math.ceil(cs / 2));
      const nxt = makeCanvas(ns, ns);
      ctx2d(nxt).drawImage(cur, 0, 0, cs, cs, 0, 0, ns, ns);
      cur = nxt; cs = ns;
    }
    if (cs !== size) {
      const fin = makeCanvas(size, size);
      ctx2d(fin).drawImage(cur, 0, 0, cs, cs, 0, 0, size, size);
      cur = fin;
    }
    return cur;
  }

  /* гауссово размытие в линейном свете (без «грязных» переходов), края — зеркально */
  function blurLinear(src, n, sigma) {
    const r = Math.ceil(sigma * 2.6);
    const k = [];
    let sum = 0;
    for (let i = -r; i <= r; i++) { const w = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(w); sum += w; }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const N = n * n;
    const a = new Float32Array(N * 3), b = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      a[i * 3] = LUT_LIN[src[i * 4]];
      a[i * 3 + 1] = LUT_LIN[src[i * 4 + 1]];
      a[i * 3 + 2] = LUT_LIN[src[i * 4 + 2]];
    }
    const idx = new Int32Array(n + 2 * r);
    for (let i = 0; i < idx.length; i++) {
      const p = 2 * n;
      let q = (((i - r) % p) + p) % p;
      idx[i] = q < n ? q : p - 1 - q;
    }
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let s0 = 0, s1 = 0, s2 = 0;
        for (let t = 0; t < k.length; t++) {
          const o = (y * n + idx[x + t]) * 3, w = k[t];
          s0 += a[o] * w; s1 += a[o + 1] * w; s2 += a[o + 2] * w;
        }
        const o = (y * n + x) * 3;
        b[o] = s0; b[o + 1] = s1; b[o + 2] = s2;
      }
    }
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let s0 = 0, s1 = 0, s2 = 0;
        for (let t = 0; t < k.length; t++) {
          const o = (idx[y + t] * n + x) * 3, w = k[t];
          s0 += b[o] * w; s1 += b[o + 1] * w; s2 += b[o + 2] * w;
        }
        const o = (y * n + x) * 3;
        a[o] = s0; a[o + 1] = s1; a[o + 2] = s2;
      }
    }
    const out = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) {
      out[i * 4] = toSrgb8(a[i * 3]);
      out[i * 4 + 1] = toSrgb8(a[i * 3 + 1]);
      out[i * 4 + 2] = toSrgb8(a[i * 3 + 2]);
      out[i * 4 + 3] = 255;
    }
    return out;
  }

  function pixelsOf(canvas) {
    try { return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; }
    catch (e) { return null; }
  }

  /* текстура для жидкого фона */
  function bgTexture(img) {
    const c = toSquare(img, BG_N);
    const d = c && pixelsOf(c);
    if (!d) return null;
    return blurLinear(d, BG_N, 5.5);
  }

  /* ---------- палитра ---------- */
  function extractPalette(img) {
    const c = toSquare(img, 48);
    const data = c && pixelsOf(c);
    if (!data) return null;
    const pts = [];
    let lum = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 100) continue;
      pts.push(U.rgbToOklab(data[i], data[i + 1], data[i + 2]));
      lum += 0.2126 * LUT_LIN[data[i]] + 0.7152 * LUT_LIN[data[i + 1]] + 0.0722 * LUT_LIN[data[i + 2]];
    }
    if (pts.length < 16) return null;
    const avgLum = lum / pts.length;

    /* k-means: старт — среднее + самые далёкие точки (ловит мелкие яркие акценты) */
    const d2 = (p, q) => {
      const dl = p[0] - q[0], da = (p[1] - q[1]) * 1.6, db = (p[2] - q[2]) * 1.6;
      return dl * dl + da * da + db * db;
    };
    const K = 7;
    const cents = [];
    const m0 = [0, 0, 0];
    for (const p of pts) { m0[0] += p[0]; m0[1] += p[1]; m0[2] += p[2]; }
    cents.push([m0[0] / pts.length, m0[1] / pts.length, m0[2] / pts.length]);
    const minD = new Float32Array(pts.length).fill(1e9);
    while (cents.length < K) {
      const last = cents[cents.length - 1];
      let best = -1, bi = 0;
      for (let i = 0; i < pts.length; i++) {
        const dd = d2(pts[i], last);
        if (dd < minD[i]) minD[i] = dd;
        if (minD[i] > best) { best = minD[i]; bi = i; }
      }
      if (best < 1e-5) break;
      cents.push(pts[bi].slice());
    }
    const cnt = new Float32Array(cents.length);
    for (let it = 0; it < 9; it++) {
      const sums = cents.map(() => [0, 0, 0]);
      cnt.fill(0);
      for (const p of pts) {
        let bd = 1e9, bi = 0;
        for (let q = 0; q < cents.length; q++) { const dd = d2(p, cents[q]); if (dd < bd) { bd = dd; bi = q; } }
        sums[bi][0] += p[0]; sums[bi][1] += p[1]; sums[bi][2] += p[2]; cnt[bi]++;
      }
      for (let q = 0; q < cents.length; q++) {
        if (cnt[q] > 0) cents[q] = [sums[q][0] / cnt[q], sums[q][1] / cnt[q], sums[q][2] / cnt[q]];
      }
    }
    const cl = [];
    for (let q = 0; q < cents.length; q++) {
      if (cnt[q] < 1) continue;
      const [L, a, b] = cents[q];
      cl.push({ L, C: Math.hypot(a, b), h: Math.atan2(b, a), pop: cnt[q] / pts.length });
    }

    const lw = c => U.smoothstep(0.1, 0.32, c.L) * (1 - 0.55 * U.smoothstep(0.86, 0.98, c.L));
    const score = c => (c.C + 0.012) * Math.pow(c.pop, 0.32) * lw(c);
    cl.sort((x, y) => score(y) - score(x));
    let maxC = 0, dom = cl[0];
    for (const c of cl) { if (c.C > maxC) maxC = c.C; if (c.pop > dom.pop) dom = c; }
    const gray = maxC < 0.04;
    const a1 = cl[0];
    let a2 = null, best2 = 0;
    for (let i = 1; i < cl.length; i++) {
      const c = cl[i];
      if (c.C < 0.035) continue;
      const s = score(c) * (0.15 + U.smoothstep(0.3, 1.1, U.hueDist(c.h, a1.h)));
      if (s > best2) { best2 = s; a2 = c; }
    }
    return buildPalette({
      h1: a1.h, C1: a1.C, L1: a1.L,
      h2: a2 ? a2.h : a1.h + 0.75, C2: a2 ? a2.C : a1.C, L2: a2 ? a2.L : a1.L - 0.1,
      hd: dom.C > 0.04 ? dom.h : a1.h, Cd: dom.C,
      gray, avgLum
    });
  }

  function buildPalette(o) {
    const g = o.gray;
    const C1 = g ? Math.min(o.C1, 0.02) : U.clamp(o.C1 * 1.25, 0.11, 0.21);
    const C2 = g ? Math.min(o.C2, 0.02) : U.clamp(o.C2 * 1.2, 0.09, 0.2);
    return {
      c1: U.oklchToRgb(U.clamp(o.L1, 0.72, 0.86), C1, o.h1),
      c2: U.oklchToRgb(U.clamp(o.L2, 0.62, 0.8), C2, o.h2),
      c3: U.oklchToRgb(0.56, g ? 0.012 : U.clamp(C1 * 0.9, 0.08, 0.17), o.h1 - (g ? 0 : 0.45)),
      vinylA: U.oklchToRgb(0.4, g ? 0.01 : U.clamp(o.Cd * 1.3 + 0.05, 0.07, 0.16), o.hd),
      vinylB: U.oklchToRgb(0.25, g ? 0.01 : U.clamp(o.Cd + 0.03, 0.05, 0.12), o.hd),
      avgLum: o.avgLum,
      gray: g
    };
  }

  /* палитра из одного цвета (схема WE / свой акцент) */
  function paletteFromColor(rgb, avgLum) {
    const [L, C, h] = U.rgbToOklch(rgb[0], rgb[1], rgb[2]);
    const gray = C < 0.03;
    return buildPalette({ h1: h, C1: Math.max(C, gray ? 0 : 0.12), L1: Math.max(L, 0.74), h2: h + 0.85, C2: Math.max(C, 0.12), L2: 0.7, hd: h, Cd: C, gray, avgLum: avgLum || 0.12 });
  }

  /* ---------- фон без музыки: мягкие пятна в цвете схемы ---------- */
  function idleTexture(rgb) {
    const [, C0, h] = U.rgbToOklch(rgb[0], rgb[1], rgb[2]);
    const C = U.clamp(C0, 0.09, 0.2);
    const c = makeCanvas(BG_N, BG_N), g = c.getContext('2d');
    const col = (L, cc, hh, a) => { const v = U.oklchToRgb(L, cc, hh); return 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + a + ')'; };
    g.fillStyle = col(0.16, C * 0.35, h, 1);
    g.fillRect(0, 0, BG_N, BG_N);
    /* аналоговая гармония: оттенки в пределах ±0.9 рад, без грязных дополнительных */
    const blobs = [
      [0.22, 0.28, 0.6, 0.56, C, 0],
      [0.78, 0.22, 0.52, 0.52, C * 0.95, 0.75],
      [0.62, 0.78, 0.62, 0.48, C * 0.9, -0.7],
      [0.16, 0.82, 0.42, 0.42, C * 0.85, 0.35],
      [0.5, 0.5, 0.34, 0.62, C * 0.7, -0.25]
    ];
    for (const [x, y, r, L, cc, dh] of blobs) {
      const rg = g.createRadialGradient(x * BG_N, y * BG_N, 0, x * BG_N, y * BG_N, r * BG_N);
      rg.addColorStop(0, col(L, cc, h + dh, 0.95));
      rg.addColorStop(1, col(L, cc, h + dh, 0));
      g.fillStyle = rg;
      g.fillRect(0, 0, BG_N, BG_N);
    }
    return blurLinear(pixelsOf(c), BG_N, 3);
  }

  /* ---------- картинка для показа: апскейл + лёгкая резкость для маленьких обложек ---------- */
  function displayCanvas(img, target) {
    const [w, h] = sizeOf(img);
    const s = Math.min(w, h);
    target = Math.round(U.clamp(target, 64, 1600));
    if (s >= target) return toSquare(img, target);
    const c = toSquare(img, target);
    const ratio = target / s;
    if (ratio > 1.15) unsharp(c, Math.min(2.4, 0.35 * ratio + 0.4), U.clamp(0.2 + 0.08 * ratio, 0.25, 0.45));
    return c;
  }
  function unsharp(canvas, radius, amount) {
    const w = canvas.width, h = canvas.height;
    const g = canvas.getContext('2d');
    let id;
    try { id = g.getImageData(0, 0, w, h); } catch (e) { return; }
    const bc = makeCanvas(w, h), bg = bc.getContext('2d');
    if (typeof bg.filter !== 'string') return;
    const p = Math.ceil(radius * 3);
    bg.filter = 'blur(' + radius.toFixed(2) + 'px)';
    bg.drawImage(canvas, -p, -p, w + 2 * p, h + 2 * p);   // подложка против тёмных краёв
    bg.drawImage(canvas, 0, 0);
    let bd;
    try { bd = bg.getImageData(0, 0, w, h).data; } catch (e) { return; }
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = d[i] + (d[i] - bd[i]) * amount;
      d[i + 1] = d[i + 1] + (d[i + 1] - bd[i + 1]) * amount;
      d[i + 2] = d[i + 2] + (d[i + 2] - bd[i + 2]) * amount;
    }
    g.putImageData(id, 0, 0);
  }

  /* ---------- генеративная обложка для треков без картинки ---------- */
  function generativeCover(seed) {
    const S = 512;
    const rnd = U.mulberry32(U.hashString(seed || 'resonance'));
    const c = makeCanvas(S, S), g = c.getContext('2d');
    const h0 = rnd() * Math.PI * 2;
    const col = (L, C, h, a) => { const v = U.oklchToRgb(L, C, h); return 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + (a === undefined ? 1 : a) + ')'; };
    const lg = g.createLinearGradient(0, 0, S, S);
    lg.addColorStop(0, col(0.34, 0.12, h0));
    lg.addColorStop(1, col(0.16, 0.07, h0 + 0.9));
    g.fillStyle = lg;
    g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const x = rnd() * S, y = rnd() * S, r = 140 + rnd() * 260;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, col(0.6 + rnd() * 0.15, 0.16, h0 + (rnd() - 0.5) * 2.2, 0.5));
      rg.addColorStop(1, col(0.5, 0.1, h0, 0));
      g.fillStyle = rg;
      g.fillRect(0, 0, S, S);
    }
    g.globalCompositeOperation = 'source-over';
    const cx = S * (0.35 + rnd() * 0.3), cy = S * (0.35 + rnd() * 0.3);
    g.lineWidth = 2;
    for (let r = 24, i = 0; r < S * 1.1; r += 18 + rnd() * 14, i++) {
      g.strokeStyle = 'rgba(255,255,255,' + (0.05 + 0.08 * Math.exp(-i * 0.12)).toFixed(3) + ')';
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    }
    g.fillStyle = col(0.92, 0.04, h0, 0.9);
    g.beginPath(); g.arc(cx, cy, 10, 0, Math.PI * 2); g.fill();
    return c;
  }

  RSN.palette = {
    BG_N, loadImage, toSquare, bgTexture, extractPalette, paletteFromColor,
    idleTexture, displayCanvas, generativeCover, makeCanvas
  };
})();
