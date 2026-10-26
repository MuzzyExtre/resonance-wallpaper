/* =========================================================
   RESONANCE — аудиодвижок
   Принимает 128 значений от Wallpaper Engine (64 L + 64 R),
   выравнивает спектр, держит автоусиление, ищет биты и
   готовит текстуру 256×1 в «экранном» порядке:
   слева — верха левого канала, в центре — бас, справа — верха правого.
   ========================================================= */
(function () {
  'use strict';
  const RSN = window.RSN, U = RSN.util;

  const NB = 64;       // полос на канал
  const TW = 256;      // ширина текстуры спектра
  const HROWS = 128;   // строк истории (для «Горизонта»; широкому нужно больше 64)

  class AudioEngine {
    constructor() {
      this.L = new Float32Array(NB);
      this.R = new Float32Array(NB);
      this.prevLow = new Float32Array(12);

      /* лёгкий фиксированный наклон + адаптивный эквалайзер по долгосрочному среднему полосы:
         реальный спектр WE может быть любым — подстраиваемся под него сами */
      this.eq = new Float32Array(NB);
      for (let i = 0; i < NB; i++) this.eq[i] = 0.8 + 0.6 * (i / (NB - 1));
      this.bandAvg = new Float32Array(NB).fill(0.1);

      /* экранная раскладка: больше места басу */
      this.map = new Float32Array(TW);
      this.side = new Uint8Array(TW);
      const half = TW / 2;
      for (let j = 0; j < TW; j++) {
        const right = j >= half;
        const s = right ? (j - half + 0.5) / half : (half - 0.5 - j) / half;
        this.map[j] = Math.pow(s, 1.35) * (NB - 1);
        this.side[j] = right ? 1 : 0;
      }

      /* гауссово ядро для пространственного сглаживания */
      const sigma = 1.7, rad = 4;
      const k = [];
      let sum = 0;
      for (let i = -rad; i <= rad; i++) { const w = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(w); sum += w; }
      this.kern = k.map(w => w / sum);

      this.work = new Float32Array(TW);
      this.target = new Float32Array(TW);
      this.disp = new Float32Array(TW);
      this.peak = new Float32Array(TW);
      this.peakV = new Float32Array(TW);
      this.hold = new Float32Array(TW);
      this.slow = new Float32Array(TW);
      this.tex = new Uint8Array(TW * 4);

      this.hist = new Uint8Array(TW * HROWS);
      this.histRow = new Uint8Array(TW);
      this.histKick = new Uint8Array(HROWS);   // сила удара, пришедшегося на строку («Горизонт+»)
      this.kickAcc = 0;
      this.histHead = 0;
      this.histPushes = 0;
      this.histTimer = 0;
      this.histPhase = 0;

      this.agc = 0.3;
      this.gain = 1;
      this.raw = { bass: 0, mid: 0, high: 0, energy: 0 };
      this.levels = { bass: 0, mid: 0, high: 0, energy: 0 };
      this.kick = 0;
      this.fluxAvg = 0.3;
      this.fluxVar = 0.05;
      this.lastBeat = -10;
      this.lastIngest = -10;
      this.frames = 0;
      this.sensitivity = 1;
      this.onBeat = null;
    }

    get active() { return performance.now() / 1000 - this.lastIngest < 0.5; }

    ingest(arr) {
      if (!arr || arr.length < NB) return;
      const t = performance.now() / 1000;
      const dtI = U.clamp(t - this.lastIngest, 0.008, 0.25);
      this.lastIngest = t;
      this.frames++;

      const stereo = arr.length >= NB * 2;
      const aAvg = 1 - Math.exp(-dtI / 5);
      let frameMax = 0;
      for (let i = 0; i < NB; i++) {
        let l = +arr[i];
        let r = stereo ? +arr[i + NB] : l;
        if (!(l > 0)) l = 0; else if (l > 4) l = 4;
        if (!(r > 0)) r = 0; else if (r > 4) r = 4;
        this.bandAvg[i] += ((l + r) * 0.5 - this.bandAvg[i]) * aAvg;
        const w = this.eq[i] / Math.sqrt(this.bandAvg[i] + 0.035);
        l *= w; r *= w;
        this.L[i] = l; this.R[i] = r;
        if (l > frameMax) frameMax = l;
        if (r > frameMax) frameMax = r;
      }

      /* автоусиление: тихие и громкие треки выглядят одинаково живо */
      this.agc = Math.max(frameMax, this.agc * Math.exp(-dtI / 6), 0.1);
      const gain = (0.95 / this.agc) * this.sensitivity;
      this.gain = gain;

      let bass = 0, mid = 0, high = 0, all = 0, flux = 0;
      for (let i = 0; i < NB; i++) {
        const v = (this.L[i] + this.R[i]) * 0.5 * gain;
        all += v;
        if (i < 6) bass += v; else if (i < 24) mid += v; else high += v;
        if (i < 12) {
          const d = v - this.prevLow[i];
          if (d > 0) flux += d * (i < 6 ? 1 : 0.4);
          this.prevLow[i] = v;
        }
      }
      bass /= 6; mid /= 18; high /= (NB - 24); all /= NB;
      const raw = this.raw;
      raw.bass = bass; raw.mid = mid; raw.high = high; raw.energy = all;

      /* детектор битов: спектральный поток в низах с адаптивным порогом */
      const thr = this.fluxAvg + 1.5 * Math.sqrt(this.fluxVar) + 0.06;
      if (flux > thr && bass > 0.2 && t - this.lastBeat > 0.21) {
        const strength = U.clamp((flux - this.fluxAvg) / (this.fluxAvg * 2.5 + 0.3), 0.3, 1);
        this.lastBeat = t;
        if (strength > this.kick) this.kick = strength;
        if (this.onBeat) this.onBeat(strength);
      }
      const a = 1 - Math.exp(-dtI / 0.45);
      const dl = flux - this.fluxAvg;
      this.fluxAvg += dl * a;
      this.fluxVar += (dl * dl - this.fluxVar) * a;

      /* раскладка в 256 точек (Катмулл-Ром) + мягкое насыщение */
      const work = this.work;
      for (let j = 0; j < TW; j++) {
        const src = this.side[j] ? this.R : this.L;
        const b = this.map[j];
        const i0 = b | 0, f = b - i0;
        const p0 = src[i0 > 0 ? i0 - 1 : 0];
        const p1 = src[i0];
        const p2 = src[i0 + 1 < NB ? i0 + 1 : NB - 1];
        const p3 = src[i0 + 2 < NB ? i0 + 2 : NB - 1];
        let v = p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
        if (v < 0) v = 0;
        work[j] = 1 - Math.exp(-1.4 * v * gain);
      }
      const K = this.kern, R = (K.length - 1) >> 1;
      for (let j = 0; j < TW; j++) {
        let s = 0;
        for (let q = -R; q <= R; q++) {
          let jj = j + q;
          if (jj < 0) jj = 0; else if (jj >= TW) jj = TW - 1;
          s += work[jj] * K[q + R];
        }
        this.target[j] = s;
      }
    }

    update(dt) {
      const t = performance.now() / 1000;
      if (t - this.lastIngest > 0.3) {
        /* звук пропал — плавно гасим */
        const k = Math.exp(-dt * 5);
        for (let j = 0; j < TW; j++) this.target[j] *= k;
        const r = this.raw;
        r.bass *= k; r.mid *= k; r.high *= k; r.energy *= k;
      }

      const up = 1 - Math.exp(-dt * 32), down = 1 - Math.exp(-dt * 8.5);
      const su = 1 - Math.exp(-dt * 3.2), sd = 1 - Math.exp(-dt * 1.3);
      const tex = this.tex;
      for (let j = 0; j < TW; j++) {
        const tg = this.target[j];
        let d = this.disp[j];
        d += (tg - d) * (tg > d ? up : down);
        this.disp[j] = d;

        let p = this.peak[j];
        if (d >= p) { p = d; this.peakV[j] = 0; this.hold[j] = 0.16; }
        else if (this.hold[j] > 0) this.hold[j] -= dt;
        else { this.peakV[j] += dt * 1.8; p -= this.peakV[j] * dt; if (p < d) p = d; }
        this.peak[j] = p;

        let s = this.slow[j];
        s += (tg - s) * (tg > s ? su : sd);
        this.slow[j] = s;

        const o = j << 2;
        tex[o] = d >= 1 ? 255 : (d * 255) | 0;
        tex[o + 1] = p >= 1 ? 255 : (p * 255) | 0;
        tex[o + 2] = s >= 1 ? 255 : (s * 255) | 0;
        tex[o + 3] = 255;
      }

      const L = this.levels, r = this.raw;
      L.bass = U.damp(L.bass, r.bass, r.bass > L.bass ? 20 : 5, dt);
      L.mid = U.damp(L.mid, r.mid, r.mid > L.mid ? 14 : 4, dt);
      L.high = U.damp(L.high, r.high, r.high > L.high ? 16 : 5, dt);
      L.energy = U.damp(L.energy, r.energy, 2.2, dt);
      this.kick *= Math.exp(-dt * 5.2);
      if (this.kick > this.kickAcc) this.kickAcc = this.kick;

      /* история спектра: рельеф «течёт» быстрее на громких местах */
      const iv = 1 / (12 + 10 * Math.min(1, L.energy * 2));
      this.histTimer += dt;
      if (this.histTimer >= iv) {
        this.histTimer -= iv;
        if (this.histTimer > iv) this.histTimer = 0;
        this.pushHistory();
      }
      this.histPhase = this.histTimer / iv;
    }

    pushHistory() {
      this.histHead = (this.histHead + 1) % HROWS;
      const off = this.histHead * TW;
      for (let j = 0; j < TW; j++) {
        const v = this.disp[j];
        const b = v >= 1 ? 255 : (v * 255) | 0;
        this.hist[off + j] = b;
        this.histRow[j] = b;
      }
      this.histKick[this.histHead] = Math.min(255, Math.round(this.kickAcc * 255));
      this.kickAcc = 0;
      this.histPushes++;
    }
  }

  AudioEngine.TW = TW;
  AudioEngine.HROWS = HROWS;
  RSN.AudioEngine = AudioEngine;
})();
