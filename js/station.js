/* =========================================================
   RESONANCE — Яндекс Станция через помощник Resonance Control:
   что играет на колонке (трек, обложка, позиция), команды ей,
   вход в Яндекс по QR-коду и «тень» трека — беззвучный разбор
   того же файла, чтобы визуализатор двигался под музыку колонки
   ========================================================= */
(function () {
  'use strict';
  const RSN = window.RSN, S = RSN.settings, M = RSN.media;
  const BASE = 'http://127.0.0.1:57391/station';
  const $ = id => document.getElementById(id);

  const St = (RSN.station = {
    info: null,       // последний ответ помощника
    offset: 0,        // сдвиг «тени» относительно позиции колонки, с
    volume: -1,       // громкость колонки 0..1 (-1 — неизвестна)
    /* множитель визуализатора от громкости колонки: на 5 из 10 — как со звуком компьютера,
       громче — активнее (до ×1,6), тише — спокойнее, без звука — волн нет */
    level() {
      const v = this.volume;
      if (v < 0) return 1;
      return v <= 0.001 ? 0 : Math.min(1.6, Math.pow(v / 0.5, 0.7));
    },
    cmd(c, v) {
      return fetch(BASE + '/cmd?c=' + c + (v !== undefined ? '&v=' + (+v).toFixed(2) : ''), { cache: 'no-store' })
        .then(r => r.json()).then(j => { schedule(150); return !!j.ok; })
        .catch(() => false);
    }
  });

  /* ---------- плавные часы колонки ----------
     позиция приходит раз в ~0,7 с и может «гулять» — подтягиваем понемногу, скачки (перемотка) — сразу */
  let clockPos = 0, clockAt = 0, clockPlaying = false, clockId = '';
  function clockSync(pos, playing, id) {
    const t = performance.now(), cur = clockNow();
    const diff = pos - cur;
    clockPos = id !== clockId || !playing || !clockPlaying || Math.abs(diff) > 1.5 ? pos : cur + diff * 0.15;
    clockAt = t; clockPlaying = playing; clockId = id;
  }
  function clockNow() { return clockPos + (clockPlaying ? (performance.now() - clockAt) / 1000 : 0); }

  /* ---------- опрос помощника ---------- */
  let timer = 0, busy = false, loginAt = -1e9, sawLogin = false, linked = false;
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(poll, ms); }

  async function poll() {
    timer = 0;
    if (!S.station) { stop(); return; }
    const C = RSN.control;
    if (!C.ok || C.v < 4) {
      panel(C.ok ? 'old' : 'nohelper');
      M._station(null);
      if (!C.ok) C.ping();   // помощник мог запуститься позже обоев — не ждём его обычной проверки
      schedule(3000);
      return;
    }
    if (busy) { schedule(500); return; }
    busy = true;
    let j = null;
    try { j = await (await fetch(BASE, { cache: 'no-store' })).json(); } catch (e) { j = null; }
    busy = false;
    if (!S.station) { stop(); return; }
    St.info = j;
    handle(j);
    schedule(j && j.phase === 'connected' ? 700 : 1500);
  }

  function handle(j) {
    if (!j) { panel('nohelper'); M._station(null); return; }
    if (j.phase === 'unlinked' || j.phase === 'login') {
      sawLogin = true; linked = false;
      M._station(null);
      if (j.link) panel('qr', j);
      else {
        panel(j.note === 'expired' ? 'expired' : 'wait', j);
        /* код просим сами, но не чаще раза в 10 с и не после того, как прежний истёк, — тогда по клику */
        if (j.note !== 'expired' && performance.now() - loginAt > 10000) login();
      }
      return;
    }
    if (j.phase !== 'connected') {
      /* сразу после входа показываем, что ищем колонку; потом связь восстанавливается молча */
      M._station(null);
      panel(sawLogin && !linked ? 'search' : 'hide', j);
      return;
    }
    if (!linked) { linked = true; panel(sawLogin ? 'linked' : 'hide', j); }
    if (typeof j.volume === 'number') St.volume = j.volume;
    if (!j.title) { M._station(null); return; }
    clockSync(+j.progress || 0, !!j.playing, j.id || j.title);
    M._station({
      title: j.title, artist: j.artist || '', playing: !!j.playing,
      progress: clockNow(), duration: +j.duration || 0, at: performance.now(),
      cover: j.cover ? BASE + '/cover?u=' + encodeURIComponent(j.cover) : ''
    });
    if (j.playing && j.type === 'Track' && /^\d+(:\d+)?$/.test(j.id || '') && j.id !== Sh.id) shadowLoad(j.id);
  }

  function login() {
    loginAt = performance.now();
    fetch(BASE + '/login', { cache: 'no-store' }).then(r => r.json()).then(j => {
      if (!j.ok) panel('error', { note: j.error || '' });
      schedule(300);
    }).catch(() => {});
  }

  function stop() {
    clearTimeout(timer); timer = 0;
    panel('hide');
    M._station(null);
    shadowDrop();
  }

  /* ---------- панель подключения ---------- */
  const T = key => RSN.i18n.t(key);
  let panelState = '', panelKey = '', hideTimer = 0;
  function panel(state, j) {
    const el = $('station');
    if (!el) return;
    const link = j && j.link || '', key = link + '|' + (j && j.note || '');
    if (state === panelState && key === panelKey && state !== 'error') return;
    clearTimeout(hideTimer);
    panelState = state; panelKey = key;
    el.className = 'station' + (state === 'hide' ? '' : ' show') + (state === 'qr' ? ' with-qr' : '');
    const title = $('stTitle'), line = $('stLine'), act = $('stAct');
    act.textContent = '';
    if (state === 'qr') {
      const cv = $('stQr');
      try { RSN.qr.draw(cv, link, cv.clientWidth * (window.devicePixelRatio || 1)); } catch (e) { console.error(e); }
      title.textContent = T('stConnect');
      line.textContent = T('stScan');
      act.textContent = T('stBrowser');
    } else if (state === 'expired') {
      title.textContent = T('stConnect'); line.textContent = T('stExpired'); act.textContent = T('stRefresh');
    } else if (state === 'wait') {
      title.textContent = T('stConnect'); line.textContent = T('stWait');
    } else if (state === 'search') {
      title.textContent = T('stName'); line.textContent = j && j.note ? T('stProblem') + j.note : T('stSearch');
    } else if (state === 'linked') {
      title.textContent = T('stLinked'); line.textContent = j && j.name || '';
      hideTimer = setTimeout(() => panel('hide'), 6000);
    } else if (state === 'nohelper') {
      title.textContent = T('stName'); line.textContent = T('stNoHelper');
    } else if (state === 'old') {
      title.textContent = T('stName'); line.textContent = T('stOldHelper');
    } else if (state === 'error') {
      title.textContent = T('stConnect'); line.textContent = T('stProblem') + (j && j.note || ''); act.textContent = T('stRefresh');
    }
  }
  function onPanelClick(ev) {
    ev.stopPropagation();
    if (panelState === 'qr') fetch(BASE + '/open', { cache: 'no-store' }).catch(() => {});
    else if (panelState === 'expired' || panelState === 'error') login();
  }

  /* ---------- «тень» трека ----------
     Музыка звучит из колонки, компьютер её не слышит. Помощник отдаёт тот же трек из Яндекс Музыки,
     обои декодируют его (без звука) и в такт позиции колонки считают спектр так, как его считает
     сам Wallpaper Engine (откалибровано по его данным на одном и том же треке): окно Ханна 23 мс,
     64 логарифмические полосы 96 Гц – 14,6 кГц, линейная амплитуда с усилением, растущим к верхам,
     ~30 кадров в секунду без сглаживания. Тогда Станция и компьютер рисуют одинаково */
  const SR = 32000, N = 1024, HALF = N / 2, NB = 64;
  const WL = 743;                              // 1024 отсчёта при 44,1 кГц, как у WE, — это 743 при 32 кГц
  const F0 = 96.4, RATIO = 1.0829;             // центры полос WE: F0 · RATIO^i
  const Sh = { id: '', token: 0, L: null, R: null, len: 0 };
  const rev = new Uint16Array(N), cosT = new Float32Array(HALF), sinT = new Float32Array(HALF), win = new Float32Array(N);
  const re = new Float32Array(N), im = new Float32Array(N);
  const magL = new Float32Array(HALF + 1), magR = new Float32Array(HALF + 1);
  const kLo = new Int16Array(NB), kHi = new Int16Array(NB), kAt = new Float32Array(NB), gain = new Float32Array(NB);
  const out = new Float32Array(NB * 2);
  const RSS = 1 / Math.sqrt(N / WL);           // дополнение нулями раздувает энергию полосы в N/WL раз
  (function () {
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >>> b) & 1) << (bits - 1 - b);
      rev[i] = r;
      win[i] = i < WL ? 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (WL - 1)) : 0;
    }
    for (let i = 0; i < HALF; i++) { cosT[i] = Math.cos(-2 * Math.PI * i / N); sinT[i] = Math.sin(-2 * Math.PI * i / N); }
    const hz = SR / N, half = Math.sqrt(RATIO);
    for (let i = 0; i < NB; i++) {
      const c = F0 * Math.pow(RATIO, i);
      kLo[i] = Math.ceil(c / half / hz);
      kHi[i] = Math.ceil(c * half / hz) - 1;
      kAt[i] = c / hz;
      gain[i] = Math.exp(-0.000488 * i * i + 0.08948 * i + 0.0483);
    }
  })();

  function fft() {
    for (let i = 0; i < N; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let i = 0; i < N; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const tr = re[b] * cosT[k] - im[b] * sinT[k], ti = re[b] * sinT[k] + im[b] * cosT[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }

  async function shadowLoad(id) {
    const token = ++Sh.token;
    Sh.id = id; Sh.L = Sh.R = null; Sh.len = 0;
    try {
      const r = await fetch(BASE + '/audio?id=' + encodeURIComponent(id), { cache: 'no-store' });
      if (!r.ok) throw new Error('audio ' + r.status);
      const data = await r.arrayBuffer();
      if (token !== Sh.token) return;
      const buf = await new OfflineAudioContext(2, 1, SR).decodeAudioData(data);
      if (token !== Sh.token) return;
      const n = buf.length, a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a;
      const L = new Int16Array(n), R = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const x = a[i], y = b[i];
        L[i] = x > 1 ? 32767 : x < -1 ? -32767 : x * 32767;
        R[i] = y > 1 ? 32767 : y < -1 ? -32767 : y * 32767;
      }
      Sh.L = L; Sh.R = R; Sh.len = n;
    } catch (e) {
      if (token === Sh.token) console.warn('station audio: ' + (e && e.message));
    }
  }
  function shadowDrop() { Sh.token++; Sh.id = ''; Sh.L = Sh.R = null; Sh.len = 0; }

  /* спектр в формате WE (64 полосы левого канала, затем 64 правого) для момента pos, с */
  function analyze(pos, L, R, len) {
    const c = Math.round(pos * SR) - (WL >> 1);
    if (c + WL < 0 || c >= len) return null;
    for (let i = 0; i < N; i++) {
      const k = c + i, w = win[i] / 32768;
      if (w > 0 && k >= 0 && k < len) { re[i] = L[k] * w; im[i] = R[k] * w; } else re[i] = im[i] = 0;
    }
    fft();
    /* два канала одним преобразованием: левый — вещественная часть, правый — мнимая */
    const inv = 1 / WL;
    magL[0] = Math.abs(re[0]) * inv; magR[0] = Math.abs(im[0]) * inv;
    for (let k = 1; k <= HALF; k++) {
      const r1 = re[k], i1 = im[k], r2 = re[(N - k) % N], i2 = im[(N - k) % N];
      magL[k] = 0.5 * Math.hypot(r1 + r2, i1 - i2) * inv;
      magR[k] = 0.5 * Math.hypot(i1 + i2, r2 - r1) * inv;
    }
    for (let ch = 0; ch < 2; ch++) {
      const mag = ch ? magR : magL;
      for (let i = 0; i < NB; i++) {
        let v;
        if (kHi[i] > kLo[i]) {                   // полоса шире двух бинов — её энергия
          let e = 0;
          for (let k = kLo[i]; k <= kHi[i]; k++) e += mag[k] * mag[k];
          v = Math.sqrt(e) * RSS;
        } else {                                  // узкая низкая полоса — значение на частоте центра
          const k = kAt[i] | 0, fr = kAt[i] - k;
          v = mag[k] * (1 - fr) + mag[k + 1] * fr;
        }
        out[ch * NB + i] = v * gain[i];
      }
    }
    return out;
  }
  St._analyze = (L, R, pos) => analyze(pos, L, R, L.length);   // для проверки по данным WE

  /* вызывается каждый кадр: true — визуализатор питается «тенью», звук компьютера не подмешиваем.
     Спектр подаём ~30 раз в секунду, как присылает WE: тогда и детектор битов ведёт себя одинаково */
  let fedAt = 0;
  St.feed = function (audio) {
    if (M.source !== 'station' || !Sh.len || M.state !== 'playing' || Sh.id !== clockId) return false;
    const now = performance.now();
    if (now - fedAt < 32) return true;
    const arr = analyze(clockNow() + St.offset, Sh.L, Sh.R, Sh.len);
    if (!arr) return false;
    fedAt = now;
    audio.ingest(arr);
    return true;
  };

  /* ---------- запуск ---------- */
  function apply() {
    if (S.station) { if (!timer && !busy) schedule(50); }
    else stop();
  }
  St.apply = apply;
  St.relabel = () => { const s = panelState; panelState = ''; if (s && s !== 'hide') panel(s, St.info || {}); };
  const box = $('station');
  if (box) box.addEventListener('click', onPanelClick);
  setTimeout(apply, 300);
})();
