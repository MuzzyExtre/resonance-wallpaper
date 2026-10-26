/* =========================================================
   RESONANCE — QR-код (для входа в Яндекс при подключении Станции).
   Байтовый режим, уровень коррекции M, версия подбирается по длине.
   Алгоритм — по ISO/IEC 18004, устройство — как у генератора Project Nayuki (MIT)
   ========================================================= */
(function () {
  'use strict';
  const RSN = window.RSN || (window.RSN = {});

  /* уровень M: кодовых слов коррекции на блок и число блоков, по версиям 1–40 */
  const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31,
    33, 35, 37, 38, 40, 43, 45, 47, 49];
  const FORMAT_M = 0;

  function rawModules(v) {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) {
      const n = Math.floor(v / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (v >= 7) r -= 36;
    }
    return r;
  }
  const dataCodewords = v => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v] * BLOCKS[v];

  /* арифметика поля GF(256) и коды Рида — Соломона */
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(degree) {
    const r = new Array(degree).fill(0);
    r[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        r[j] = gfMul(r[j], root);
        if (j + 1 < degree) r[j] ^= r[j + 1];
      }
      root = gfMul(root, 2);
    }
    return r;
  }
  function rsRemainder(data, div) {
    const r = new Array(div.length).fill(0);
    for (const b of data) {
      const f = b ^ r.shift();
      r.push(0);
      for (let i = 0; i < div.length; i++) r[i] ^= gfMul(div[i], f);
    }
    return r;
  }

  function alignPositions(v, size) {
    if (v === 1) return [];
    const n = Math.floor(v / 7) + 2;
    const step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
    const r = [6];
    for (let p = size - 7; r.length < n; p -= step) r.splice(1, 0, p);
    return r;
  }

  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    let v = 1;
    for (; v <= 40; v++) if (4 + (v <= 9 ? 8 : 16) + bytes.length * 8 <= dataCodewords(v) * 8) break;
    if (v > 40) throw new Error('QR: слишком длинный текст');

    /* поток бит: режим «байты», длина, данные, терминатор, выравнивание, заполнители */
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4);
    put(bytes.length, v <= 9 ? 8 : 16);
    bytes.forEach(b => put(b, 8));
    const cap = dataCodewords(v) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }

    /* блоки с коррекцией, чередование */
    const nb = BLOCKS[v], eccLen = ECC_PER_BLOCK[v];
    const raw = Math.floor(rawModules(v) / 8);
    const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    const div = rsDivisor(eccLen), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const words = [];
    for (let i = 0; i < blocks[0].length; i++) {
      for (let j = 0; j < nb; j++) if (i !== shortLen - eccLen || j >= nShort) words.push(blocks[j][i]);
    }

    /* матрица: служебные узоры, данные змейкой, лучшая маска */
    const size = v * 4 + 17;
    const mod = new Uint8Array(size * size), fn = new Uint8Array(size * size);
    const setF = (x, y, dark) => { mod[y * size + x] = dark ? 1 : 0; fn[y * size + x] = 1; };
    for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const al = alignPositions(v, size), na = al.length;
    for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    const drawFormat = mask => {
      const d = (FORMAT_M << 3) | mask;
      let rem = d;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const b = ((d << 10) | rem) ^ 0x5412, bit = i => (b >>> i) & 1;
      for (let i = 0; i <= 5; i++) setF(8, i, bit(i));
      setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
      for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(i));
      setF(8, size - 8, 1);
    };
    drawFormat(0);
    if (v >= 7) {
      let rem = v;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const b = (v << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const dark = (b >>> i) & 1, a = size - 11 + i % 3, c = Math.floor(i / 3);
        setF(a, c, dark); setF(c, a, dark);
      }
    }
    let n = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
          if (!fn[y * size + x] && n < words.length * 8) {
            mod[y * size + x] = (words[n >>> 3] >>> (7 - (n & 7))) & 1;
            n++;
          }
        }
      }
    }
    const MASKS = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
      (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0
    ];
    const applyMask = m => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (!fn[y * size + x] && MASKS[m](x, y)) mod[y * size + x] ^= 1;
      }
    };
    let best = 0, bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m);
      drawFormat(m);
      const s = penalty(mod, size);
      if (s < bestScore) { bestScore = s; best = m; }
      applyMask(m);
    }
    applyMask(best);
    drawFormat(best);
    return { size, version: v, mask: best, dark: (x, y) => mod[y * size + x] === 1 };
  }

  /* штраф маски: длинные ряды, квадраты 2×2, узоры как у поисковых меток, баланс тёмного */
  function penalty(mod, size) {
    let score = 0, dark = 0;
    const at = (x, y) => mod[y * size + x];
    const F1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], F2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < size; a++) {
        let run = 1;
        for (let b = 0; b < size; b++) {
          const c = pass ? at(a, b) : at(b, a);
          if (b > 0) {
            const p = pass ? at(a, b - 1) : at(b - 1, a);
            if (c === p) run++;
            else { if (run >= 5) score += run - 2; run = 1; }
          }
          if (b + 11 <= size) {
            let m1 = true, m2 = true;
            for (let k = 0; k < 11 && (m1 || m2); k++) {
              const q = pass ? at(a, b + k) : at(b + k, a);
              if (q !== F1[k]) m1 = false;
              if (q !== F2[k]) m2 = false;
            }
            if (m1) score += 40;
            if (m2) score += 40;
          }
        }
        if (run >= 5) score += run - 2;
      }
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const c = at(x, y);
      dark += c;
      if (x < size - 1 && y < size - 1 && c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) score += 3;
    }
    const total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }

  /* рисует код на canvas: тёмные модули на белом, с обязательным белым полем в 4 модуля;
     px — желаемый размер в пикселях экрана (модуль — целое число пикселей, без размытия) */
  function draw(canvas, text, px) {
    const q = encode(text), k = Math.max(2, Math.floor((px || 400) / (q.size + 8))), full = (q.size + 8) * k;
    canvas.width = canvas.height = full;
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, full, full);
    g.fillStyle = '#0b0d12';
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) {
      if (q.dark(x, y)) g.fillRect((x + 4) * k, (y + 4) * k, k, k);
    }
    return q;
  }

  RSN.qr = { encode, draw };
})();
