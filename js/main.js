/* =========================================================
   RESONANCE — сборка: медиа -> обложка/палитра -> рендер
   ========================================================= */
(function () {
  'use strict';
  const RSN = window.RSN, U = RSN.util, S = RSN.settings, M = RSN.media, P = RSN.palette;
  const report = (msg) => { console.error(msg); if (window.RSN_ERR) window.RSN_ERR(msg); };
  const trace = (msg) => { if (RSN.trace) RSN.trace(msg); };   // есть только в диагностической сборке

  /* все изменяемые переменные — наверху: обработчики WE могут сработать в любой момент */
  let last = performance.now(), nextFrame = 0, pauseDim = 0, errors = 0, activity = 0, ready = false;
  let mode = 'idle', idleSince = 0;
  let thumbToken = 0, genTimer = 0, lastWave = 0;
  let thumbImg = null, hqTimer = 0, hqToken = 0, hqFor = null, holdImg = null, holdTimer = 0;
  let lastPlayed = null;   // последний трек, который действительно играл — для кнопки «Продолжить»
  let fromStation = false; // визуализатор питает «тень» трека Станции — звук компьютера не подмешиваем
  let pausedAt = 0;        // когда трек встал на паузу — для часов при долгой паузе

  const audio = new RSN.AudioEngine();
  const ui = new RSN.UI();
  let gfx = null;
  try {
    gfx = new RSN.Renderer(document.getElementById('gl'));
  } catch (e) {
    document.body.classList.add('no-webgl');
    report('WebGL: ' + e.message);
  }

  /* ---------- палитра ---------- */
  const clonePal = p => ({
    c1: p.c1.slice(), c2: p.c2.slice(), c3: p.c3.slice(),
    vinylA: p.vinylA.slice(), vinylB: p.vinylB.slice(),
    avgLum: p.avgLum, gray: p.gray
  });
  /* тёмные обложки чуть вытягиваем, светлые — приглушаем, но без пересвета */
  const brightFor = lum => U.clamp(Math.pow(0.1 / Math.max(lum, 0.01), 0.35), 0.5, 1.3);
  /* свечение вокруг светлой обложки иначе превращается в засвет */
  const glowFor = lum => U.clamp(0.16 / Math.max(lum, 0.05), 0.28, 1);

  let idlePal = P.paletteFromColor(S.schemeColor, 0.1);
  let idleTex = P.idleTexture(S.schemeColor);
  let trackPal = null, trackTex = null;
  let palFrom = clonePal(idlePal), palTo = clonePal(idlePal), palNow = clonePal(idlePal), palT = 1;
  let brightFrom = brightFor(0.1), brightTo = brightFrom, brightNow = brightFrom;

  function effective(p) {
    if (S.accentMode !== 'custom') return p;
    const c = P.paletteFromColor(S.accentColor, p.avgLum);
    return Object.assign({}, p, { c1: c.c1, c2: c.c2, c3: c.c3 });
  }
  function setTargetPalette(p, instant) {
    p = effective(p);
    palFrom = clonePal(palNow);
    palTo = clonePal(p);
    brightFrom = brightNow;
    brightTo = brightFor(p.avgLum);
    palT = instant ? 1 : 0;
    if (instant) stepPalette(0);
  }
  /* смешивание в OKLab: переход бирюза -> розовый идёт через сочные цвета, а не через серый */
  const PAL_KEYS = ['c1', 'c2', 'c3', 'vinylA', 'vinylB'];
  function mixLab(a, b, k, out) {
    const A = U.rgbToOklab(a[0], a[1], a[2]), B = U.rgbToOklab(b[0], b[1], b[2]);
    const lin = U.oklabToLin(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k);
    for (let i = 0; i < 3; i++) out[i] = U.clamp(U.linToSrgb(U.clamp(lin[i], 0, 1)), 0, 1) * 255;
  }
  function stepPalette(dt) {
    if (palT >= 1 && dt > 0) return;
    palT = Math.min(1, palT + dt / 2.6);
    const k = U.easeInOutCubic(palT);
    PAL_KEYS.forEach(key => mixLab(palFrom[key], palTo[key], k, palNow[key]));
    palNow.avgLum = palTo.avgLum;
    palNow.gray = palTo.gray;
    brightNow = brightFrom + (brightTo - brightFrom) * k;
    ui.setColors(palNow);
  }

  /* ---------- обложка ---------- */
  function applyCover(img) {
    trace('apply ' + (img.naturalWidth || img.width));
    const pal = P.extractPalette(img) || P.paletteFromColor(S.schemeColor, 0.12);
    const tex = P.bgTexture(img);
    const disp = P.displayCanvas(img, ui.coverBacking());
    trackPal = pal;
    trackTex = tex;
    ui.setCover(disp || img);
    if (mode !== 'idle') {
      if (gfx && tex) gfx.setCover(tex);
      setTargetPalette(pal);
    }
    if (!gfx && disp) {
      try { document.getElementById('fallback').style.backgroundImage = 'url(' + disp.toDataURL('image/jpeg', 0.8) + ')'; } catch (e) { /* ignore */ }
    }
  }
  /* Чтобы не было видно, как мутная обложка плеера (у Яндекс Музыки 150×150) сменяется
     чёткой, новую обложку придерживаем: пока ищется чёткая версия, остаётся прежняя,
     и смена идёт сразу на резкую. Не нашлась за HOLD_MS — показываем родную, а резкость
     «наводим» плавно, когда чёткая всё-таки придёт */
  const HOLD_MS = 1200;
  function releaseHold(why) {
    clearTimeout(holdTimer);
    const img = holdImg;
    holdImg = null;
    if (img) { trace('release ' + (why || '')); try { applyCover(img); } catch (e) { report('cover: ' + e.message); } }
  }
  async function onThumb(src) {
    const token = ++thumbToken;
    clearTimeout(genTimer);
    trace('thumb ' + (src ? src.length : 0));
    let img = null;
    if (src) { try { img = await P.loadImage(src); } catch (e) { img = null; } }
    if (token !== thumbToken) return;
    thumbImg = img;
    holdImg = null;
    clearTimeout(holdTimer);
    const hq = S.hqCovers && RSN.hq && M.source !== 'station';   // у Станции обложка сразу большая
    try {
      if (!img) applyCover(P.generativeCover(M.title + '\u0000' + M.artist));
      else {
        const known = hq ? RSN.hq.recall(img, M.artist) : null;   // тот же альбом — чёткая есть сразу
        if (known) { trace('recall'); hqFor = img; applyCover(known); return; }
        if (hq && M.title && M.artist && ui.coverSrc && mode !== 'idle') {
          trace('hold');
          holdImg = img;
          holdTimer = setTimeout(() => releaseHold('timeout'), HOLD_MS);
        } else applyCover(img);
      }
    } catch (e) { report('cover: ' + e.message); }
    scheduleHQ();
  }

  /* чёткая обложка из интернета (если включено). Трек и обложка приходят от WE
     в любом порядке, поэтому даём им немного устояться */
  function scheduleHQ() {
    clearTimeout(hqTimer);
    if (!S.hqCovers || !RSN.hq || M.source === 'station') { releaseHold(); return; }
    hqTimer = setTimeout(() => {
      const token = ++hqToken, title = M.title, artist = M.artist, ref = thumbImg;
      if (!title || !artist) { releaseHold(); return; }
      if (ref && hqFor === ref) return;   // для этой обложки чёткая уже показана
      RSN.hqStatus = 'поиск: ' + title;
      const t0 = performance.now();
      trace('hq search: ' + artist + ' — ' + title);
      RSN.hq.fetch(title, artist, ref).then(img => {
        RSN.hqStatus = img ? 'найдена ' + img.naturalWidth + 'px' : 'не найдена';
        trace('hq ' + (img ? 'found ' + img.naturalWidth : 'none') + ' ' + Math.round(performance.now() - t0) + 'ms' + (token !== hqToken ? ' (stale)' : ''));
        if (token !== hqToken) return;   // уже ищем для другого трека
        if (!img || !S.hqCovers || title !== M.title || artist !== M.artist || ref !== thumbImg) { releaseHold('nf'); return; }
        hqFor = ref;
        if (holdImg && holdImg === ref) {
          holdImg = null;
          clearTimeout(holdTimer);
          applyCover(img);
        } else if (ref) {
          trace('upgrade');
          const sharp = P.displayCanvas(img, ui.coverBacking());
          ui.upgradeCover(sharp);
        } else applyCover(img);
      }).catch(e => {
        RSN.hqStatus = 'ошибка: ' + (e && e.message);
        trace('hq error ' + (e && e.message) + ' ' + Math.round(performance.now() - t0) + 'ms');
        if (token === hqToken) releaseHold('error');   // остаётся обложка плеера
      });
    }, 150);
  }

  /* ---------- режим ---------- */
  function desiredMode() {
    if (M.enabled === false && M.source !== 'station') return 'idle';
    if (!(M.title || M.thumb)) return 'idle';
    if (M.state === 'stopped') return 'idle';
    /* долгая пауза (если так выбрано в настройках) — тоже экран с часами и кнопкой «Продолжить» */
    if (M.state === 'paused') return S.pauseClock > 0 && pausedAt && performance.now() - pausedAt > S.pauseClock * 60000 ? 'idle' : 'paused';
    return 'playing';
  }
  /* фон без музыки: от последнего трека (если он был и так выбрано) или цвет схемы */
  function idleBackground() {
    if (S.idleBg === 'last' && trackTex) {
      if (gfx) gfx.setCover(trackTex);
      if (trackPal) setTargetPalette(trackPal);
    } else {
      if (gfx) gfx.setCover(idleTex);
      setTargetPalette(idlePal);
    }
  }
  function setMode(m) {
    const prev = mode;
    mode = m;
    ui.setMode(m);
    if (m === 'idle') {
      ui.setResume(lastPlayed);
      if (!(S.idleBg === 'last' && trackTex)) idleBackground();   // фон последнего трека просто остаётся
    } else if (prev === 'idle') {
      if (gfx && trackTex) gfx.setCover(trackTex);
      if (trackPal) setTargetPalette(trackPal);
    }
  }
  function updateMode(now) {
    const want = desiredMode();
    if (want === mode) { idleSince = 0; return; }
    if (want === 'idle') {
      /* между треками плеер иногда на миг сообщает «стоп» — не дёргаемся */
      if (!idleSince) idleSince = now;
      if (now - idleSince < 2500) return;
    }
    idleSince = 0;
    setMode(want);
  }

  M.on('thumb', onThumb);
  M.on('track', () => {
    trace('track: ' + M.artist + ' — ' + M.title);
    notePlaying();
    ui.setTrack(M.title, M.artist, M.album);
    if (S.hqCovers && RSN.hq && M.source !== 'station') RSN.hq.prefetch(M.title, M.artist);
    /* у трека так и не появилось своей обложки — рисуем абстрактную */
    clearTimeout(genTimer);
    genTimer = setTimeout(() => { if (!M.thumbFresh) onThumb(''); }, 1200);
    scheduleHQ();
  });
  /* запоминаем трек, только пока он играет: на остановке WE может подсунуть чужой сеанс */
  const notePlaying = () => { if (M.state === 'playing' && (M.title || M.artist)) lastPlayed = { title: M.title, artist: M.artist, source: M.source }; };
  M.on('state', () => {
    pausedAt = M.state === 'paused' ? performance.now() : 0;
    notePlaying();
    updateMode(performance.now());
  });
  const refreshHint = () => ui.setHint(M.enabled === false ? RSN.i18n.t('mediaHint') : '');
  M.on('status', refreshHint);

  /* ---------- кнопки управления ---------- */
  const refreshControls = () => {
    const demo = !!RSN.demo;
    ui.setControls(RSN.control.ok || demo, RSN.control.seek || demo, S.controls);
  };
  RSN.control.onChange = refreshControls;
  ui.onControl = (cmd, arg) => {
    if (RSN.demo && RSN.demoControl) {
      const d = RSN.demoControl;
      if (cmd === 'playpause' || cmd === 'resume') d.togglePause();
      else if (cmd === 'next') d.next();
      else if (cmd === 'prev') d.prev();
      else if (cmd === 'seek' && d.seek) d.seek(arg);
      return;
    }
    if (cmd === 'resume') {
      /* плеер закрыт или трек в нём уже другой — кнопка «качает головой» */
      if (!lastPlayed) return;
      const done = lastPlayed.source === 'station' && RSN.station ? RSN.station.cmd('play') : RSN.control.resume(lastPlayed);
      done.then(ok => { if (!ok) ui.resumeFailed(); });
      return;
    }
    /* на экране трек Станции — команды уходят колонке */
    if (M.source === 'station' && RSN.station) {
      if (cmd === 'seek') { RSN.station.cmd('seek', +arg); M.pos = +arg; M.stamp = performance.now(); }
      else RSN.station.cmd(cmd);
      return;
    }
    if (cmd === 'seek') {
      RSN.control.send('seek', 't=' + (+arg).toFixed(2));
      M.pos = +arg; M.stamp = performance.now();   // сразу двигаем ползунок, не дожидаясь плеера
    } else RSN.control.send(cmd);
  };

  /* ---------- биты ---------- */
  audio.onBeat = strength => {
    if (!gfx || S.beatPulse <= 0.01) return;
    gfx.kickParticles(strength * 0.6);
    if (gfx.fluid && S.visualizer === 'fluid' && strength > 0.4) gfx.fluid.beat(strength * Math.min(S.beatPulse, 1.5));
    const now = performance.now();
    if (S.shockwaves && strength > 0.7 && now - lastWave > 900) {
      lastWave = now;
      gfx.addWave(strength * Math.min(S.beatPulse, 1.6) * (mode === 'idle' ? 0.6 : 1));
    }
  };

  /* ---------- настройки ---------- */
  RSN.setSettingsHandler(keys => {
    const has = k => keys.indexOf(k) >= 0;
    audio.sensitivity = S.sensitivity;
    ui.applySettings(S);
    if (has('schemeColor')) {
      idlePal = P.paletteFromColor(S.schemeColor, 0.1);
      idleTex = P.idleTexture(S.schemeColor);
    }
    if ((has('schemeColor') || has('idleBg')) && mode === 'idle') idleBackground();
    if (has('accentMode') || has('accentColor')) setTargetPalette(trackPal && (mode !== 'idle' || S.idleBg === 'last') ? trackPal : idlePal);
    if (has('hqCovers') && S.hqCovers) scheduleHQ();
    if (has('debug') && RSN.setDebug) RSN.setDebug(S.debug || !!window.RSN_DEBUG);
    if (has('language') && RSN.i18n.setMode(S.language)) {
      ui.lastMinute = -1;
      refreshHint();
      if (!M.title && !M.artist) ui.renderText();
      ui.setResume(mode === 'idle' ? lastPlayed : null);
      if (RSN.onLanguage) RSN.onLanguage();
    }
    if (has('controls')) refreshControls();
    if (has('station') && RSN.station) RSN.station.apply();
    if (has('language') && RSN.station) RSN.station.relabel();
  });
  RSN.onPauseChange = paused => { if (!paused) last = performance.now(); };

  /* ---------- старт ---------- */
  if (gfx) gfx.setCover(idleTex, true);
  setTargetPalette(idlePal, true);
  RSN.i18n.setMode(S.language);
  ui.applySettings(S);
  audio.sensitivity = S.sensitivity;
  refreshControls();
  refreshHint();

  /* подписка на API Wallpaper Engine; если оно появится позже — подпишемся позже */
  let audioReg = false;
  function registerAll() {
    if (!audioReg && typeof window.wallpaperRegisterAudioListener === 'function') {
      try { window.wallpaperRegisterAudioListener(arr => { if (!fromStation) audio.ingest(arr); }); audioReg = true; }
      catch (e) { report('audio: ' + e.message); }
    }
    M.register();
  }
  registerAll();
  if (!audioReg || !M.supported) {
    window.addEventListener('load', registerAll);
    setTimeout(registerAll, 1500);
    setTimeout(registerAll, 4000);
  }
  window.livelyAudioListener = arr => { RSN.inLively = true; if (!fromStation) audio.ingest(arr); };

  /* страховка: если обои загрузились, пока WE стоял на паузе (игра на весь экран),
     стартовые медиа-события могли потеряться. Как только WE «ожил» (пошёл звук),
     а медиа-данных так и нет — переподписываемся (повторы событий безопасны) */
  let mediaRetries = 0, liveSince = 0;
  setInterval(() => {
    if (M.seen || mediaRetries >= 3 || !audioReg) return;
    if (!audio.active) { liveSince = 0; return; }
    if (!liveSince) { liveSince = performance.now(); return; }
    if (performance.now() - liveSince > 3000) { mediaRetries++; liveSince = 0; M.register(true); }
  }, 1000);
  /* страховка: интерфейс проявится, даже если первый кадр задержится */
  setTimeout(() => { if (!ready) { ready = true; document.body.classList.add('ready'); } }, 2500);

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { ui.layoutDirty = true; ui.fitTitle(); });

  /* ---------- цикл ---------- */
  const st = { S, audio, shape: ui.shape, pal: palNow, glow: 0, bright: 1, motion: 1, mouse: ui.mouse, partAlpha: 1, visAlpha: 1 };

  function frame(now) {
    requestAnimationFrame(frame);
    if (RSN.wePaused) { last = now; return; }
    const lim = RSN.fpsLimit;
    if (lim > 0 && lim < 500) {
      const iv = 1000 / lim;
      if (now < nextFrame - 1.5) return;
      nextFrame = Math.max(nextFrame + iv, now - iv);
    }
    const dt = U.clamp((now - last) / 1000, 0.0005, 0.1);
    last = now;
    try {
      fromStation = !!(RSN.station && RSN.station.feed(audio));
      /* у Станции визуализатор следует за громкостью колонки (плавно, за полсекунды) */
      audio.volume = U.damp(audio.volume, fromStation ? RSN.station.level() : 1, 4, dt);
      audio.update(dt);
      updateMode(now);
      stepPalette(dt);
      ui.update(dt, now, audio, M);
      if (gfx) {
        pauseDim = U.damp(pauseDim, mode === 'paused' ? 1 : 0, 2, dt);
        st.pal = palNow;
        st.glow = S.showCover ? ui.focusEased() * (0.5 + 0.55 * audio.kick * S.beatPulse) * (1 - 0.4 * pauseDim) * glowFor(palNow.avgLum) : 0;
        st.bright = brightNow * (1 - 0.22 * pauseDim);
        st.motion = 1 - 0.55 * pauseDim;
        st.partAlpha = 1 - 0.45 * pauseDim;
        /* без звука в простое визуализатор растворяется, на паузе — остаётся спокойный силуэт */
        const lv = audio.levels;
        activity = U.damp(activity, audio.active && lv.energy + lv.bass > 0.03 ? 1 : 0, 1.5, dt);
        st.visAlpha = mode === 'idle' ? activity : Math.max(activity, 0.65);
        st.meta = ui.metaRect;
        gfx.render(dt, st);
      }
    } catch (e) {
      if (errors++ < 3) report('frame: ' + (e && e.message ? e.message : e));
    }
    if (!ready) { ready = true; document.body.classList.add('ready'); }
  }
  requestAnimationFrame(frame);

  RSN.app = { audio, ui, gfx, get mode() { return mode; }, palette: () => palNow };
})();
