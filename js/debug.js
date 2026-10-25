/* =========================================================
   RESONANCE — отладочная панель (по умолчанию выключена).
   Включается свойством «Отладка» в Wallpaper Engine, флагом
   window.RSN_DEBUG или параметром ?debug. Показывает, какие события
   реально присылает WE, и сырой спектр (128 значений).
   ========================================================= */
(function () {
  'use strict';
  const RSN = window.RSN;
  const log = [], sent = [];
  let box = null, cnv = null, raw = null, frames = 0, lastState = '—';
  const t0 = performance.now();
  const stamp = () => ((performance.now() - t0) / 1000).toFixed(2) + 's';
  const push = s => {
    const line = stamp() + '  ' + s;
    log.push(line); if (log.length > 16) log.shift();
    if (window.RSN_DEBUG_BEACON) { sent.push(line); if (sent.length > 200) sent.shift(); }
  };
  /* трассировка внутренних шагов (обложка, поиск чёткой версии) — только при диагностике */
  if (window.RSN_DEBUG_BEACON) RSN.trace = s => push('· ' + s);

  const short = v => {
    if (v === null || v === undefined) return String(v);
    if (typeof v === 'string') return v.length > 60 ? v.slice(0, 40) + '…(' + v.length + ')' : v;
    return String(v);
  };
  const summarize = e => {
    if (!e || typeof e !== 'object') return short(e);
    return Object.keys(e).map(k => k + '=' + short(e[k])).join(' ');
  };

  /* обложку от WE — кусками на локальный сервер (только для диагностики) */
  function sendThumb(data) {
    const img = new Image();
    img.onload = () => {
      const id = Date.now().toString(36), size = 18000, n = Math.ceil(data.length / size);
      for (let i = 0; i < n; i++) {
        const b = new Image();
        b.src = window.RSN_DEBUG_BEACON.replace('__log', '__thumb') + '?id=' + id + '&i=' + i + '&n=' + n +
          '&w=' + img.naturalWidth + '&h=' + img.naturalHeight + '&d=' + encodeURIComponent(data.slice(i * size, (i + 1) * size));
      }
    };
    img.src = data;
  }

  /* перехватываем регистрацию до того, как main.js подпишется */
  ['wallpaperRegisterMediaStatusListener', 'wallpaperRegisterMediaPropertiesListener',
    'wallpaperRegisterMediaThumbnailListener', 'wallpaperRegisterMediaPlaybackListener',
    'wallpaperRegisterMediaTimelineListener'].forEach(name => {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    const tag = name.replace('wallpaperRegisterMedia', '').replace('Listener', '');
    window[name] = function (cb) {
      return orig.call(this, function (e) {
        push(tag + ': ' + summarize(e));
        if (tag === 'Playback' && e) lastState = String(e.state);
        if (tag === 'Thumbnail' && e && e.thumbnail && window.RSN_DEBUG_BEACON) sendThumb(e.thumbnail);
        return cb(e);
      });
    };
  });
  if (typeof window.wallpaperRegisterAudioListener === 'function') {
    const origA = window.wallpaperRegisterAudioListener;
    window.wallpaperRegisterAudioListener = function (cb) {
      return origA.call(this, function (arr) { raw = arr; frames++; return cb(arr); });
    };
  }

  function build() {
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:16px;top:16px;z-index:98;width:560px;padding:12px 14px;border-radius:10px;' +
      'background:rgba(6,6,12,.78);color:#cfe;font:12px/1.5 Consolas,monospace;white-space:pre-wrap;pointer-events:none';
    cnv = document.createElement('canvas');
    cnv.width = 532; cnv.height = 90;
    cnv.style.cssText = 'display:block;margin-top:8px;background:rgba(255,255,255,.05)';
    const txt = document.createElement('div');
    box.appendChild(txt);
    box.appendChild(cnv);
    document.body.appendChild(box);
    setInterval(() => {
      if (!RSN.debugOn) { box.style.display = 'none'; return; }
      box.style.display = 'block';
      const M = RSN.media, MI = window.wallpaperMediaIntegration;
      let mx = 0, lo = 0, mid = 0, hi = 0;
      if (raw) {
        for (let i = 0; i < raw.length; i++) mx = Math.max(mx, raw[i]);
        for (let i = 0; i < 8; i++) lo += raw[i] / 8;
        for (let i = 8; i < 32; i++) mid += raw[i] / 24;
        for (let i = 32; i < 64; i++) hi += raw[i] / 32;
      }
      txt.textContent =
        'WE api: ' + (typeof window.wallpaperRegisterAudioListener === 'function') +
        '  media api: ' + (typeof window.wallpaperRegisterMediaPropertiesListener === 'function') +
        '  consts: ' + (MI ? JSON.stringify(MI) : 'нет') + '\n' +
        'mode: ' + (RSN.app ? RSN.app.mode : '?') + '  enabled: ' + M.enabled + '  state: ' + M.state + ' (raw ' + lastState + ')\n' +
        'track: ' + (M.title || '—') + ' / ' + (M.artist || '—') + '  thumb: ' + (M.thumb ? M.thumb.length : 0) + '\n' +
        'timeline: ' + M.position().toFixed(1) + ' / ' + M.dur.toFixed(1) + '  fresh: ' + M.timelineFresh() + '\n' +
        'hq: ' + (RSN.hqStatus || '—') + '\n' +
        'audio frames: ' + frames + '  len: ' + (raw ? raw.length : 0) + '  max: ' + mx.toFixed(3) +
        '  low: ' + lo.toFixed(3) + '  mid: ' + mid.toFixed(3) + '  high: ' + hi.toFixed(3) + '\n' +
        'fps limit: ' + RSN.fpsLimit + '  inWE: ' + !!RSN.inWE + '  size: ' + innerWidth + 'x' + innerHeight + ' dpr ' + devicePixelRatio + '\n' +
        '— события —\n' + log.join('\n');
      const g = cnv.getContext('2d');
      g.clearRect(0, 0, cnv.width, cnv.height);
      if (raw) {
        const n = raw.length, bw = cnv.width / n, scale = Math.max(1, mx);
        for (let i = 0; i < n; i++) {
          const v = Math.min(1, raw[i] / scale);
          g.fillStyle = i < n / 2 ? '#7fd' : '#d9f';
          g.fillRect(i * bw, cnv.height - v * cnv.height, Math.max(1, bw - 1), v * cnv.height);
        }
      }
    }, 250);
  }

  /* только для диагностики разработчиком: сводка на локальный сервер (в обычной сборке не задано) */
  if (window.RSN_DEBUG_BEACON) {
    setInterval(() => {
      const M = RSN.media;
      const d = {
        mode: RSN.app ? RSN.app.mode : '?', en: M.enabled, st: M.state, raw: lastState,
        t: M.title, a: M.artist, th: M.thumb ? M.thumb.length : 0, pos: +M.position().toFixed(1), dur: M.dur,
        hq: RSN.hqStatus || '—', cover: RSN.app && RSN.app.ui.coverSrc ? RSN.app.ui.coverSrc.width : 0,
        wePaused: !!RSN.wePaused, vis: document.visibilityState,
        frames, ev: sent.splice(0, sent.length),
        spec: raw ? Array.from(raw).map(v => Math.round(v * 1000) / 1000) : null
      };
      const img = new Image();
      img.src = window.RSN_DEBUG_BEACON + '?d=' + encodeURIComponent(JSON.stringify(d)) + '&r=' + Math.random();
    }, 2000);
  }

  RSN.debugOn = !!(window.RSN_DEBUG || /[?&]debug\b/.test(location.search));
  RSN.setDebug = on => { RSN.debugOn = !!on; if (on && !box) build(); };
  if (RSN.debugOn) {
    if (document.body) build(); else window.addEventListener('DOMContentLoaded', build);
  }
})();
