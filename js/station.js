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
     обои декодируют его (без звука) и в такт позиции колонки считают спектр так же, как демо
     считает его для перетащенного файла: 64 полосы на канал, -90…-20 дБ */
  const SR = 32000, N = 2048, HALF = N / 2, NB = 64;
  const Sh = { id: '', token: 0, L: null, R: null, len: 0 };
  const rev = new Uint16Array(N), cosT = new Float32Array(HALF), sinT = new Float32Array(HALF), win = new Float32Array(N);
  const re = new Float32Array(N), im = new Float32Array(N);
  const magL = new Float32Array(HALF + 1), magR = new Float32Array(HALF + 1);
  const smL = new Float32Array(HALF + 1), smR = new Float32Array(HALF + 1);
  const edges = new Int16Array(NB + 1), out = new Float32Array(NB * 2);
  (function () {
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >>> b) & 1) << (bits - 1 - b);
      rev[i] = r;
      win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    }
    for (let i = 0; i < HALF; i++) { cosT[i] = Math.cos(-2 * Math.PI * i / N); sinT[i] = Math.sin(-2 * Math.PI * i / N); }
    const hz = SR / N;
    for (let i = 0; i <= NB; i++) edges[i] = Math.max(1, Math.round(30 * Math.pow(16000 / 30, i / NB) / hz));
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
      smL.fill(0); smR.fill(0);
    } catch (e) {
      if (token === Sh.token) console.warn('station audio: ' + (e && e.message));
    }
  }
  function shadowDrop() { Sh.token++; Sh.id = ''; Sh.L = Sh.R = null; Sh.len = 0; }

  /* вызывается каждый кадр: true — спектр подан вместо звука компьютера */
  St.feed = function (audio) {
    if (M.source !== 'station' || !Sh.len || M.state !== 'playing' || Sh.id !== clockId) return false;
    const c = Math.round((clockNow() + St.offset) * SR) - HALF;
    if (c + N < 0 || c >= Sh.len) return false;
    const L = Sh.L, R = Sh.R;
    for (let i = 0; i < N; i++) {
      const k = c + i, w = win[i] / 32768;
      if (k >= 0 && k < Sh.len) { re[i] = L[k] * w; im[i] = R[k] * w; } else re[i] = im[i] = 0;
    }
    fft();
    /* два канала одним преобразованием: левый — вещественная часть, правый — мнимая */
    const inv = 1 / N;
    magL[0] = Math.abs(re[0]) * inv; magR[0] = Math.abs(im[0]) * inv;
    for (let k = 1; k <= HALF; k++) {
      const r1 = re[k], i1 = im[k], r2 = re[(N - k) % N], i2 = im[(N - k) % N];
      magL[k] = 0.5 * Math.hypot(r1 + r2, i1 - i2) * inv;
      magR[k] = 0.5 * Math.hypot(i1 + i2, r2 - r1) * inv;
    }
    for (let k = 0; k <= HALF; k++) { smL[k] = 0.5 * smL[k] + 0.5 * magL[k]; smR[k] = 0.5 * smR[k] + 0.5 * magR[k]; }
    for (let ch = 0; ch < 2; ch++) {
      const sm = ch ? smR : smL;
      for (let i = 0; i < NB; i++) {
        let m = 0;
        for (let b = edges[i], e = Math.max(edges[i], edges[i + 1] - 1); b <= e && b <= HALF; b++) if (sm[b] > m) m = sm[b];
        let v = (20 * Math.log10(m + 1e-9) + 90) / 70;
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        out[ch * NB + i] = v * v * (1 - 0.5 * i / 63);
      }
    }
    audio.ingest(out);
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
