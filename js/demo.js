/* =========================================================
   RESONANCE — демо-режим для обычного браузера.
   Включается сам, только если за 2,5 с не пришло ни одного сигнала
   от Wallpaper Engine или Lively (или принудительно: ?demo).
   API Wallpaper Engine не подменяется — данные идут прямо в обработчики.
   Клавиши: N/B — трек, Пробел — пауза, S — стоп, V/C/L/F/Q — вид,
   H — подсказка. Можно перетащить аудиофайл — обои «услышат» его.
   ========================================================= */
(function () {
  'use strict';
  const RSN = window.RSN, U = RSN.util;
  const params = new URLSearchParams(location.search);
  const forced = params.has('demo');

  const weApi = () => typeof window.wallpaperRegisterAudioListener === 'function';
  const hostDetected = () => RSN.inWE || RSN.inLively || weApi();

  const feed = {
    audio: arr => { if (RSN.app && RSN.app.audio) RSN.app.audio.ingest(arr); },
    status: e => RSN.media._feed.status(e),
    props: e => RSN.media._feed.props(e),
    thumb: e => RSN.media._feed.thumb(e),
    play: e => RSN.media._feed.playback(e),
    time: e => RSN.media._feed.timeline(e)
  };

  /* ---------- процедурные обложки ---------- */
  const SZ = 600;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = SZ; return c; };

  function coverAurora() {
    const c = mk(), g = c.getContext('2d'), rnd = U.mulberry32(11);
    const sky = g.createLinearGradient(0, 0, 0, SZ);
    sky.addColorStop(0, '#030712'); sky.addColorStop(0.55, '#0a1d3b'); sky.addColorStop(1, '#0b3140');
    g.fillStyle = sky; g.fillRect(0, 0, SZ, SZ);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = 'rgba(255,255,255,' + (0.15 + rnd() * 0.75).toFixed(2) + ')';
      g.beginPath(); g.arc(rnd() * SZ, rnd() * SZ * 0.75, rnd() * 1.3 + 0.2, 0, 6.283); g.fill();
    }
    g.globalCompositeOperation = 'lighter';
    g.filter = 'blur(16px)';
    [['rgba(50,255,170,0.6)', 0.36, 0, 54], ['rgba(40,190,255,0.45)', 0.45, 1.4, 40], ['rgba(180,90,255,0.42)', 0.27, 2.2, 36]].forEach(([col, yy, ph, lw]) => {
      g.strokeStyle = col; g.lineWidth = lw; g.beginPath();
      for (let x = -40; x <= SZ + 40; x += 8) {
        const y = SZ * yy + Math.sin(x * 0.011 + ph) * 64 + Math.sin(x * 0.029 + ph * 2) * 20;
        if (x === -40) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    });
    g.filter = 'blur(6px)';
    for (let x = 0; x < SZ; x += 7) {
      const y = SZ * 0.36 + Math.sin(x * 0.011) * 64;
      const gr = g.createLinearGradient(0, y - 150, 0, y + 10);
      gr.addColorStop(0, 'rgba(60,255,180,0)'); gr.addColorStop(1, 'rgba(60,255,180,' + (0.05 + 0.08 * rnd()).toFixed(3) + ')');
      g.fillStyle = gr; g.fillRect(x, y - 150, 4, 160);
    }
    g.filter = 'none';
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#02060c';
    g.beginPath(); g.moveTo(0, SZ);
    for (let x = 0; x <= SZ; x += 12) g.lineTo(x, SZ * 0.8 - Math.abs(Math.sin(x * 0.0105 + 1.2)) * 110 - Math.sin(x * 0.041) * 16);
    g.lineTo(SZ, SZ); g.closePath(); g.fill();
    return c;
  }

  function coverSynth() {
    const c = mk(), g = c.getContext('2d');
    const hz = SZ * 0.62;
    const sky = g.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, '#12022a'); sky.addColorStop(0.55, '#4c0f62'); sky.addColorStop(1, '#ff4f7b');
    g.fillStyle = sky; g.fillRect(0, 0, SZ, hz);
    const sun = g.createLinearGradient(0, hz - 300, 0, hz);
    sun.addColorStop(0, '#ffe08a'); sun.addColorStop(0.55, '#ff7a59'); sun.addColorStop(1, '#ff2d95');
    g.save();
    g.beginPath(); g.arc(SZ / 2, hz - 30, 170, Math.PI, 0); g.closePath(); g.clip();
    g.fillStyle = sun; g.fillRect(0, 0, SZ, hz);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 7; i++) { const y = hz - 110 + i * 15; g.fillRect(0, y, SZ, 3 + i * 1.3); }
    g.restore();
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.filter = 'blur(30px)';
    g.fillStyle = 'rgba(255,80,160,0.35)';
    g.beginPath(); g.arc(SZ / 2, hz - 40, 190, Math.PI, 0); g.fill();
    g.restore();
    const fl = g.createLinearGradient(0, hz, 0, SZ);
    fl.addColorStop(0, '#2a0838'); fl.addColorStop(1, '#0b0114');
    g.fillStyle = fl; g.fillRect(0, hz, SZ, SZ - hz);
    g.strokeStyle = 'rgba(255,70,200,0.85)'; g.lineWidth = 2;
    g.shadowColor = '#ff3cc8'; g.shadowBlur = 12;
    for (let i = -14; i <= 14; i++) { g.beginPath(); g.moveTo(SZ / 2 + i * 12, hz); g.lineTo(SZ / 2 + i * 120, SZ); g.stroke(); }
    for (let k = 0; k < 9; k++) { const y = hz + Math.pow(k / 8, 2.2) * (SZ - hz); g.beginPath(); g.moveTo(0, y); g.lineTo(SZ, y); g.stroke(); }
    g.shadowBlur = 0;
    return c;
  }

  function coverOcean() {
    const c = mk(), g = c.getContext('2d'), rnd = U.mulberry32(5);
    const bg = g.createLinearGradient(0, 0, 0, SZ);
    bg.addColorStop(0, '#0f7c8c'); bg.addColorStop(0.45, '#0a3d5c'); bg.addColorStop(1, '#020b18');
    g.fillStyle = bg; g.fillRect(0, 0, SZ, SZ);
    g.globalCompositeOperation = 'lighter';
    g.filter = 'blur(10px)';
    for (let i = 0; i < 7; i++) {
      const x = 80 + i * 75 + rnd() * 30;
      const gr = g.createLinearGradient(0, 0, 0, SZ * 0.9);
      gr.addColorStop(0, 'rgba(180,255,250,0.32)'); gr.addColorStop(1, 'rgba(180,255,250,0)');
      g.fillStyle = gr; g.beginPath();
      g.moveTo(x - 14, -10); g.lineTo(x + 14, -10); g.lineTo(x + 90 + rnd() * 40, SZ); g.lineTo(x + 30, SZ); g.closePath(); g.fill();
    }
    g.filter = 'none';
    for (let i = 0; i < 60; i++) {
      const x = rnd() * SZ, y = SZ * 0.3 + rnd() * SZ * 0.7, r = 2 + rnd() * 9;
      g.strokeStyle = 'rgba(200,255,255,' + (0.25 + rnd() * 0.4).toFixed(2) + ')'; g.lineWidth = 1.4;
      g.beginPath(); g.arc(x, y, r, 0, 6.283); g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(2,10,22,0.9)';
    g.beginPath(); g.ellipse(SZ * 0.52, SZ * 0.68, 150, 46, -0.12, 0, 6.283); g.fill();
    g.beginPath(); g.moveTo(SZ * 0.3, SZ * 0.66); g.lineTo(SZ * 0.2, SZ * 0.6); g.lineTo(SZ * 0.22, SZ * 0.72); g.closePath(); g.fill();
    return c;
  }

  function coverGolden() {
    const c = mk(), g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, SZ);
    bg.addColorStop(0, '#ffd889'); bg.addColorStop(0.45, '#ff9447'); bg.addColorStop(1, '#b53a12');
    g.fillStyle = bg; g.fillRect(0, 0, SZ, SZ);
    g.save(); g.filter = 'blur(40px)'; g.fillStyle = 'rgba(255,250,220,0.8)';
    g.beginPath(); g.arc(SZ * 0.5, SZ * 0.42, 150, 0, 6.283); g.fill(); g.restore();
    g.fillStyle = '#fff4d1'; g.beginPath(); g.arc(SZ * 0.5, SZ * 0.42, 92, 0, 6.283); g.fill();
    [['#c2410c', 0.62, 0.9, 40], ['#8f2a0b', 0.72, 1.7, 52], ['#4a1206', 0.84, 2.4, 60]].forEach(([col, base, ph, amp]) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, SZ);
      for (let x = 0; x <= SZ; x += 10) g.lineTo(x, SZ * base - Math.sin(x * 0.009 + ph) * amp - Math.sin(x * 0.023 + ph) * amp * 0.3);
      g.lineTo(SZ, SZ); g.closePath(); g.fill();
    });
    g.strokeStyle = 'rgba(60,15,5,0.8)'; g.lineWidth = 3;
    [[200, 150], [236, 132], [262, 160]].forEach(([x, y]) => { g.beginPath(); g.moveTo(x - 12, y); g.quadraticCurveTo(x - 5, y - 8, x, y); g.quadraticCurveTo(x + 5, y - 8, x + 12, y); g.stroke(); });
    return c;
  }

  const TRACKS = [
    { title: 'Северное сияние', artist: 'Полярная ночь', album: 'Холодный свет', dur: 214, cover: coverAurora },
    { title: 'Neon Boulevard', artist: 'Midnight Arcade', album: 'Afterglow', dur: 246, cover: coverSynth },
    { title: 'Глубина', artist: 'Океан тишины', album: 'Подводные течения', dur: 198, cover: coverOcean },
    { title: 'Golden Hour', artist: 'The Velvet Pines', album: 'Late Summer Tapes', dur: 231, cover: coverGolden }
  ];
  const thumbSize = +params.get('thumb') || 300;   // как маленькие обложки из SMTC
  function thumbOf(tr) {
    if (tr._url) return tr._url;
    const big = tr.cover();
    const s = document.createElement('canvas'); s.width = s.height = thumbSize;
    const g = s.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(big, 0, 0, thumbSize, thumbSize);
    tr._url = s.toDataURL('image/png');
    return tr._url;
  }

  /* ---------- состояние «плеера» ---------- */
  const D = { idx: -1, playing: false, stopped: true, pos: 0, stamp: performance.now(), file: null };
  const curPos = () => D.pos + (D.playing ? (performance.now() - D.stamp) / 1000 : 0);
  function sendTimeline() {
    const tr = TRACKS[D.idx];
    if (!tr) return;
    D.pos = curPos(); D.stamp = performance.now();
    if (D.pos > tr.dur) { next(); return; }
    feed.time({ position: D.pos, duration: tr.dur });
  }
  function sendState() { feed.play({ state: D.stopped ? 0 : D.playing ? 1 : 2 }); }
  function load(i) {
    D.idx = (i + TRACKS.length) % TRACKS.length;
    const tr = TRACKS[D.idx];
    feed.props({ title: tr.title, artist: tr.artist, albumTitle: tr.album, albumArtist: tr.artist, subTitle: '', genres: '', contentType: 'music' });
    feed.thumb({ thumbnail: thumbOf(tr), primaryColor: '#202020', secondaryColor: '#404040', tertiaryColor: '#606060', textColor: '#ffffff', highContrastColor: '#ffffff' });
    D.pos = params.has('pos') ? +params.get('pos') : 12 + Math.random() * 50;
    D.stamp = performance.now();
    D.playing = true; D.stopped = false;
    sendState(); sendTimeline();
  }
  function next() { load(D.idx + 1); }
  function prev() { load(D.idx - 1); }
  function togglePause() {
    if (D.stopped) { load(Math.max(D.idx, 0)); return; }
    D.pos = curPos(); D.stamp = performance.now();
    D.playing = !D.playing;
    sendState(); sendTimeline();
    if (D.file) { if (D.playing) D.file.el.play(); else D.file.el.pause(); }
  }
  function stop() { D.pos = curPos(); D.playing = false; D.stopped = true; sendState(); }
  function seek(t) {
    if (D.file) { D.file.el.currentTime = t; }
    D.pos = Math.max(0, t); D.stamp = performance.now();
    sendTimeline();
  }

  /* ---------- синтетический звук (похож на данные WE) ---------- */
  function synth(t) {
    const out = new Array(128).fill(0);
    if (!D.playing) return out;
    const bpm = 122, beat = t * bpm / 60, ph = beat % 1;
    const bar = Math.floor(beat / 4), section = Math.floor(beat / 32) % 4;
    const inten = [0.75, 1, 0.9, 0.55][section];
    const kick = section === 3 ? 0 : Math.exp(-ph * 9);
    const snare = Math.floor(beat) % 2 === 1 ? Math.exp(-ph * 7) : 0;
    const hat = Math.exp(-((beat * 2) % 1) * 16);
    const chord = [0.26, 0.31, 0.22, 0.34][bar % 4];
    for (let ch = 0; ch < 2; ch++) {
      for (let i = 0; i < 64; i++) {
        const x = i / 63;
        let v = kick * 0.95 * Math.exp(-x * 13);
        v += 0.24 * Math.exp(-Math.pow((x - 0.1) / 0.06, 2)) * (0.6 + 0.4 * Math.sin(t * 2.1));
        v += snare * 0.34 * Math.exp(-Math.pow((x - 0.36) / 0.17, 2));
        v += hat * 0.15 * Math.exp(-Math.pow((x - 0.8) / 0.12, 2));
        v += 0.17 * Math.exp(-Math.pow((x - chord - 0.04 * ch) / 0.05, 2)) * (0.55 + 0.45 * Math.sin(t * 3.3 + i * 0.4));
        v += 0.1 * Math.exp(-Math.pow((x - 0.52 - 0.08 * Math.sin(t * 0.4)) / 0.04, 2));
        v *= 1 - 0.55 * x;
        v += Math.random() * 0.018;
        out[ch * 64 + i] = Math.max(0, v * inten * (ch ? 0.94 : 1));
      }
    }
    return out;
  }

  /* ---------- аудиофайл перетаскиванием ---------- */
  function useFile(file) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ac = D.file ? D.file.ac : new Ctx();
      if (D.file) D.file.el.pause();
      const el = new Audio(URL.createObjectURL(file));
      el.loop = true;
      const src = ac.createMediaElementSource(el);
      const split = ac.createChannelSplitter(2);
      const an = [ac.createAnalyser(), ac.createAnalyser()];
      an.forEach(a => { a.fftSize = 4096; a.smoothingTimeConstant = 0.5; a.minDecibels = -90; a.maxDecibels = -20; });
      src.connect(split); split.connect(an[0], 0); split.connect(an[1], 1);
      src.connect(ac.destination);
      const bins = new Uint8Array(an[0].frequencyBinCount);
      const hz = ac.sampleRate / 4096;
      const edges = [];
      for (let i = 0; i <= 64; i++) edges.push(Math.max(1, Math.round(30 * Math.pow(16000 / 30, i / 64) / hz)));
      D.file = { ac, el, an, bins, edges };
      el.play(); ac.resume();
      const name = file.name.replace(/\.[^.]+$/, '');
      const dash = name.split(' - ');
      feed.props({ title: dash[1] || name, artist: dash[1] ? dash[0] : RSN.i18n.t('localFile'), albumTitle: '' });
      feed.thumb({ thumbnail: '' });
      D.playing = true; D.stopped = false; D.idx = -1;
      sendState();
      el.addEventListener('loadedmetadata', () => feed.time({ position: 0, duration: el.duration || 0 }));
    } catch (e) { console.error(e); }
  }
  function fileFrame() {
    const f = D.file, out = new Array(128).fill(0);
    if (!D.playing) return out;
    for (let ch = 0; ch < 2; ch++) {
      f.an[ch].getByteFrequencyData(f.bins);
      for (let i = 0; i < 64; i++) {
        let m = 0;
        for (let b = f.edges[i]; b <= Math.max(f.edges[i], f.edges[i + 1] - 1); b++) if (f.bins[b] > m) m = f.bins[b];
        const v = m / 255;
        out[ch * 64 + i] = v * v * (1 - 0.5 * i / 63);
      }
    }
    return out;
  }

  /* ---------- подсказка и клавиши ---------- */
  function cycle(key, vals) {
    const map = { visualizer: ['ridge', 'ridge2', 'ridge3', 'wall', 'fluid', 'aurora', 'ring', 'bars', 'none'], coverstyle: ['card', 'vinyl', 'disc'], layout: ['center', 'left', 'right'], font: ['manrope', 'unbounded', 'serif', 'system'], quality: ['high', 'medium', 'low'] };
    const field = { visualizer: 'visualizer', coverstyle: 'coverStyle', layout: 'layout', font: 'font', quality: 'quality' }[key];
    const i = map[key].indexOf(RSN.settings[field]);
    const props = {};
    props[key] = { value: vals[(i + 1) % vals.length] };
    RSN.applyProps(props, 'we');
  }
  function help(show) {
    const el = document.getElementById('demoHelp');
    if (!el) return;
    el.innerHTML = RSN.i18n.t('help');
    if (show !== null) el.classList.toggle('on', show === undefined ? !el.classList.contains('on') : show);
  }

  /* ---------- запуск ---------- */
  let active = false;
  function start() {
    if (active) return;
    active = true;
    RSN.demo = true;
    RSN.onLanguage = () => help(null);
    if (RSN.control && RSN.control.onChange) RSN.control.onChange();   // в демо кнопки управляют демо-плеером
    const t0 = performance.now();
    const audioTimer = setInterval(() => {
      if (hostDetected() && !forced) { clearInterval(audioTimer); return; }
      feed.audio(D.file ? fileFrame() : synth((performance.now() - t0) / 1000));
    }, 33);
    setInterval(() => { if (D.playing && !D.file) sendTimeline(); }, 5000);

    window.addEventListener('keydown', e => {
      const k = e.code;
      if (k === 'KeyN' || k === 'ArrowRight') next();
      else if (k === 'KeyB' || k === 'ArrowLeft') prev();
      else if (k === 'Space' || k === 'KeyP') { e.preventDefault(); togglePause(); }
      else if (k === 'KeyS') stop();
      else if (k === 'KeyV') cycle('visualizer', [4, 7, 8, 9, 6, 1, 2, 3, 0]);
      else if (k === 'KeyG') RSN.applyProps({ language: { value: RSN.i18n.lang === 'ru' ? 2 : 1 } }, 'we');
      else if (k === 'KeyC') cycle('coverstyle', [1, 2, 3]);
      else if (k === 'KeyL') cycle('layout', [1, 2, 3]);
      else if (k === 'KeyF') cycle('font', [1, 2, 3, 4]);
      else if (k === 'KeyQ') cycle('quality', [1, 2, 3]);
      else if (k === 'KeyH') help();
    });
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (f && /^audio\//.test(f.type)) useFile(f);
    });

    feed.status({ enabled: !params.has('nomedia') });
    if (!params.has('clean')) { help(true); setTimeout(() => help(false), 7000); }
    if (params.has('idle')) return;
    const startIdx = +(params.get('track') || 1) - 1;
    setTimeout(() => {
      load(startIdx);
      if (params.get('state') === 'paused') setTimeout(togglePause, 50);
    }, params.has('fast') ? 30 : 1200);
    if (!params.has('hold')) setInterval(() => { if (D.playing && !D.file) next(); }, 28000);
  }

  window.addEventListener('load', () => {
    setTimeout(() => { if (forced || !hostDetected()) start(); }, forced ? 0 : 2500);
  });

  /* для проверки крайних случаев: произвольный трек, пустая обложка, выключенная интеграция */
  function custom(title, artist, album, thumb, dur) {
    feed.props({ title, artist, albumTitle: album || '', contentType: 'music' });
    feed.thumb({ thumbnail: thumb || '' });
    D.idx = 0; D.playing = true; D.stopped = false; D.pos = 3; D.stamp = performance.now();
    sendState();
    if (dur) feed.time({ position: 3, duration: dur });
  }
  RSN.demoControl = { start, next, prev, togglePause, stop, seek, load, custom, mediaEnabled: en => feed.status({ enabled: !!en }) };
})();
