/* =========================================================
   RESONANCE — настройки: значения по умолчанию и приём
   свойств из Wallpaper Engine (и Lively Wallpaper)
   ========================================================= */
(function () {
  'use strict';
  const RSN = window.RSN, U = RSN.util;

  const S = (RSN.settings = {
    schemeColor: [112, 92, 250],
    idleBg: 'last',
    layout: 'center',
    coverStyle: 'vinyl',
    vinylColor: 'black',
    visualizer: 'ridge',
    font: 'manrope',
    uiScale: 1,
    offsetX: 0,
    offsetY: 0,
    accentMode: 'auto',
    accentColor: [150, 130, 255],
    sensitivity: 1,
    beatPulse: 1,
    shockwaves: true,
    bgMotion: 1,
    bgBrightness: 1,
    bgSaturation: 1,
    particles: 0.5,
    grain: 0.3,
    parallax: true,
    showCover: true,
    showInfo: true,
    showAlbum: true,
    showProgress: true,
    clockMode: 'auto',
    clock24: true,
    showDate: true,
    quality: 'high',
    hqCovers: true,
    debug: false,
    language: 'auto',
    controls: 'hover',
    ridgeStyle: 'lines',
    ridgeSun: false,
    ridgeGlow: 1,
    ridgeMist: true,
    ridgeSparks: true,
    fluidMouse: true,
    fluidTrail: 0.5,
    station: false
  });

  RSN.fpsLimit = 0;
  RSN.wePaused = false;

  /* выпадающие списки: значение из project.json -> внутреннее; lively — порядок пунктов */
  const COMBOS = {
    layout:     { key: 'layout',     vals: { 1: 'center', 2: 'left', 3: 'right' }, lively: [1, 2, 3] },
    coverstyle: { key: 'coverStyle', vals: { 1: 'card', 2: 'vinyl', 3: 'disc' }, lively: [1, 2, 3] },
    vinylcolor: { key: 'vinylColor', vals: { 1: 'black', 2: 'color' }, lively: [1, 2] },
    /* 5 — бывший Milkdrop («Жидкий свет»); 7, 8, 9 — бывшие «Горизонт+», «широкий» и «Стена» (теперь это «Горизонт») */
    visualizer: { key: 'visualizer', vals: { 4: 'ridge', 7: 'ridge', 8: 'ridge', 9: 'ridge', 6: 'fluid', 1: 'aurora', 2: 'ring', 3: 'bars', 5: 'fluid', 0: 'none' }, lively: [4, 6, 1, 2, 3, 0] },
    idlebg:     { key: 'idleBg',     vals: { 1: 'last', 2: 'color' }, lively: [1, 2] },
    language:   { key: 'language',   vals: { 0: 'auto', 1: 'ru', 2: 'en' }, lively: [0, 1, 2] },
    controls:   { key: 'controls',   vals: { 1: 'hover', 2: 'always', 0: 'off' }, lively: [1, 2, 0] },
    ridgestyle: { key: 'ridgeStyle', vals: { 1: 'lines', 2: 'grid', 3: 'lines' }, lively: [1, 2] },
    font:       { key: 'font',       vals: { 1: 'manrope', 2: 'unbounded', 3: 'serif', 4: 'system' }, lively: [1, 2, 3, 4] },
    accentmode: { key: 'accentMode', vals: { 1: 'auto', 2: 'custom' }, lively: [1, 2] },
    clockmode:  { key: 'clockMode',  vals: { 1: 'auto', 2: 'idle', 0: 'off' }, lively: [1, 2, 0] },
    quality:    { key: 'quality',    vals: { 1: 'high', 2: 'medium', 3: 'low' }, lively: [1, 2, 3] }
  };
  const SLIDERS = {
    uiscale: 'uiScale', offsetx: 'offsetX', offsety: 'offsetY',
    sensitivity: 'sensitivity', beatpulse: 'beatPulse',
    bgmotion: 'bgMotion', bgbrightness: 'bgBrightness', bgsaturation: 'bgSaturation',
    particles: 'particles', grain: 'grain', fluidtrail: 'fluidTrail', ridgeglow: 'ridgeGlow'
  };
  const BOOLS = {
    shockwaves: 'shockwaves', parallax: 'parallax', showcover: 'showCover', showinfo: 'showInfo',
    showalbum: 'showAlbum', showprogress: 'showProgress',
    clock24: 'clock24', showdate: 'showDate', hqcovers: 'hqCovers', debug: 'debug', ridgesun: 'ridgeSun',
    fluidmouse: 'fluidMouse', station: 'station', ridgemist: 'ridgeMist', ridgesparks: 'ridgeSparks'
  };
  const COLORS = { schemecolor: 'schemeColor', accentcolor: 'accentColor' };

  function convert(name, v, src) {
    const key = String(name).toLowerCase();
    if (COMBOS[key]) {
      const c = COMBOS[key];
      const raw = src === 'lively' ? c.lively[+v] : v;
      const out = c.vals[String(raw)];
      return out === undefined ? null : [c.key, out];
    }
    if (SLIDERS[key]) {
      const n = +v;
      return isFinite(n) ? [SLIDERS[key], n / 100] : null;
    }
    if (BOOLS[key]) return [BOOLS[key], v === true || v === 'true' || v === 1 || v === '1'];
    if (COLORS[key]) {
      const str = String(v);
      const c = str.charAt(0) === '#' || /^rgb/i.test(str) ? U.parseCssColor(str) : U.parseWEColor(str);
      return c ? [COLORS[key], c] : null;
    }
    return null;
  }

  /* изменения копятся, пока приложение не подписалось */
  const pending = new Set();
  let handler = null;
  function emit(keys) {
    if (!keys.length) return;
    if (handler) { try { handler(keys); } catch (e) { console.error(e); if (window.RSN_ERR) window.RSN_ERR('settings: ' + e.message); } }
    else keys.forEach(k => pending.add(k));
  }
  RSN.setSettingsHandler = function (fn) {
    handler = fn;
    if (pending.size) { const keys = Array.from(pending); pending.clear(); emit(keys); }
  };
  RSN.applyProps = function (props, src) {
    const changed = [];
    for (const k in props) {
      const p = props[k];
      if (p === null || p === undefined) continue;
      const val = typeof p === 'object' && 'value' in p ? p.value : p;
      if (val === undefined) continue;
      const r = convert(k, val, src || 'we');
      if (r) { S[r[0]] = r[1]; changed.push(r[0]); }
    }
    emit(changed);
  };

  /* Wallpaper Engine: слушатель должен быть глобальным и объявлен сразу */
  window.wallpaperPropertyListener = {
    applyUserProperties: function (props) { RSN.inWE = true; RSN.applyProps(props, 'we'); },
    applyGeneralProperties: function (props) {
      if (props && props.fps !== undefined && props.fps !== null) {
        const f = typeof props.fps === 'object' ? props.fps.value : props.fps;
        RSN.fpsLimit = +f || 0;
      }
    },
    setPaused: function (paused) {
      RSN.wePaused = !!paused;
      if (RSN.onPauseChange) RSN.onPauseChange(RSN.wePaused);
    }
  };

  /* Lively Wallpaper */
  window.livelyPropertyListener = function (name, val) {
    RSN.inLively = true;
    const r = convert(name, val, 'lively');
    if (r) { S[r[0]] = r[1]; emit([r[0]]); }
  };

  /* параметры адресной строки (для превью в браузере): ?visualizer=2&coverstyle=1 */
  try {
    const q = new URLSearchParams(location.search);
    const props = {};
    q.forEach((v, k) => { props[k] = { value: v }; });
    RSN.applyProps(props, 'we');
  } catch (e) { /* без параметров */ }
})();
