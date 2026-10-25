/* =========================================================
   RESONANCE — медиа-интеграция Wallpaper Engine:
   название трека, обложка, состояние и позиция воспроизведения
   ========================================================= */
(function () {
  'use strict';
  const RSN = window.RSN;
  const now = () => performance.now();
  const clean = s => String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim();

  const M = (RSN.media = {
    supported: false,
    enabled: null,           // null — неизвестно, true/false — включена ли интеграция в WE
    title: '',
    artist: '',
    album: '',
    thumb: '',
    weColors: null,
    state: 'none',           // none | playing | paused | stopped
    pos: 0,
    dur: 0,
    stamp: 0,
    hasTimeline: false,
    timelineAt: -1e9,
    trackAt: 0,
    handlers: { status: [], track: [], thumb: [], state: [] },

    on(ev, fn) { this.handlers[ev].push(fn); },
    emit(ev, arg) {
      const list = this.handlers[ev];
      for (let i = 0; i < list.length; i++) {
        try { list[i](arg); } catch (e) {
          console.error(e);
          if (window.RSN_ERR) window.RSN_ERR('media/' + ev + ': ' + e.message);
        }
      }
    },
    /* позиция с интерполяцией: WE присылает таймлайн не каждый кадр */
    position() {
      if (!this.hasTimeline) return 0;
      let p = this.pos;
      if (this.state === 'playing') p += (now() - this.stamp) / 1000;
      if (this.dur > 0 && p > this.dur) p = this.dur;
      return p < 0 ? 0 : p;
    },
    /* таймлайн относится к текущему треку (пришёл после смены трека или чуть раньше) */
    timelineFresh() { return this.hasTimeline && this.timelineAt >= this.trackAt - 600; }
  });

  function stateName(s) {
    const MI = window.wallpaperMediaIntegration || {};
    const PLAY = MI.PLAYBACK_PLAYING !== undefined ? MI.PLAYBACK_PLAYING : 1;
    const PAUSE = MI.PLAYBACK_PAUSED !== undefined ? MI.PLAYBACK_PAUSED : 2;
    if (s === PLAY) return 'playing';
    if (s === PAUSE) return 'paused';
    return 'stopped';
  }

  function onStatus(e) {
    M.seen = true;
    const en = !!(e && e.enabled);
    if (en !== M.enabled) { M.enabled = en; M.emit('status', en); }
  }

  /* Защита от «чужих» сеансов. На смене трека плеер на миг перестаёт играть, и Windows
     примерно на секунду делает текущим другой медиасеанс (у пользователя — голосовое
     из Telegram: «Вы — сегодня в 16:35», остановлено, обложка 50×50). WE честно присылает
     его название, обложку и нулевой таймлайн, а через секунду — новый трек. Поэтому
     события сначала копятся в raw, а на экран попадают, только когда понятно, что это
     настоящий трек: он играет, или чужой сеанс продержался дольше пары секунд */
  const raw = { title: '', artist: '', album: '', thumb: null, thumbNew: false, timeline: null, state: 'none' };
  let lastPlaying = -1e9, gateTimer = 0, rawIdle = false;

  function commit() {
    clearTimeout(gateTimer);
    gateTimer = 0;
    if (raw.title !== M.title || raw.artist !== M.artist || raw.album !== M.album) {
      M.title = raw.title; M.artist = raw.artist; M.album = raw.album;
      M.trackAt = now();
      M.thumbFresh = false;
      M.emit('track', M);
    }
    if (raw.thumb !== null && raw.thumbNew) {   // обложка пришла уже для этого трека
      M.thumbFresh = true;
      if (raw.thumb !== M.thumb) { M.thumb = raw.thumb; M.emit('thumb', raw.thumb); }
    }
    if (raw.timeline) {
      const tl = raw.timeline;
      raw.timeline = null;
      M.pos = tl.pos; M.dur = tl.dur; M.stamp = tl.at;
      M.hasTimeline = M.dur > 0;
      M.timelineAt = tl.at;
    }
    if (raw.state !== M.state) {
      if (M.hasTimeline) { M.pos = M.position(); M.stamp = now(); }
      M.state = raw.state;
      M.emit('state', M.state);
    }
  }

  function settle() {
    clearTimeout(gateTimer);
    gateTimer = 0;
    const other = raw.title !== M.title || raw.artist !== M.artist;
    if (raw.state === 'playing') {
      /* заиграло, а данные пришли от сеанса, который не играл: свежие обычно идут следом */
      if (rawIdle && other) gateTimer = setTimeout(commit, 200);
      else commit();
    } else if (other && now() - lastPlaying < 4000) {
      gateTimer = setTimeout(commit, 2500);   // похоже на чужой сеанс на время смены трека
    } else commit();
  }

  function onProps(e) {
    if (!e) return;
    M.seen = true;
    const title = clean(e.title), artist = clean(e.artist);
    if (title !== raw.title || artist !== raw.artist) raw.thumbNew = false;
    raw.title = title; raw.artist = artist; raw.album = clean(e.albumTitle);
    rawIdle = raw.state !== 'playing';
    settle();
  }

  function onThumb(e) {
    if (!e) return;
    M.seen = true;
    let t = typeof e.thumbnail === 'string' ? e.thumbnail.trim() : '';
    if (t && !/^(data:|https?:|file:|blob:)/i.test(t)) t = 'data:image/png;base64,' + t;
    /* пустая обложка посреди трека («base64,» без данных) — сбой, а не смена картинки */
    if (/^data:[^,]*,\s*$/i.test(t)) t = '';
    if (!t && raw.thumb && raw.title === M.title && raw.artist === M.artist) return;
    M.weColors = {
      primary: e.primaryColor, secondary: e.secondaryColor, tertiary: e.tertiaryColor,
      text: e.textColor, high: e.highContrastColor
    };
    raw.thumb = t;
    raw.thumbNew = true;
    if (raw.state !== 'playing') rawIdle = true;
    settle();
  }

  function onPlayback(e) {
    if (!e) return;
    M.seen = true;
    raw.state = stateName(e.state);
    if (raw.state === 'playing') lastPlaying = now();
    settle();
  }

  function onTimeline(e) {
    if (!e) return;
    M.seen = true;
    const pos = +e.position, dur = +e.duration;
    if (!isFinite(pos)) return;
    raw.timeline = { pos: pos > 0 ? pos : 0, dur: isFinite(dur) && dur > 0 ? dur : 0, at: now() };
    settle();
  }
  /* пока трек играет, отметка «недавно играло» обновляется */
  setInterval(() => { if (raw.state === 'playing') lastPlaying = now(); }, 1000);

  /* регистрация повторяемая: каждый слушатель подключается ровно один раз,
     даже если WE внедрит своё API позже наших скриптов */
  const registered = {};
  M.seen = false;   // приходило ли от WE хоть одно медиа-событие
  M.register = function (force) {
    const reg = (name, fn) => {
      if (registered[name] && !force) return true;
      try {
        if (typeof window[name] === 'function') { window[name](fn); registered[name] = true; return true; }
      } catch (e) { console.error(e); if (window.RSN_ERR) window.RSN_ERR(name + ': ' + e.message); }
      return false;
    };
    reg('wallpaperRegisterMediaStatusListener', onStatus);
    M.supported = reg('wallpaperRegisterMediaPropertiesListener', onProps) || M.supported;
    reg('wallpaperRegisterMediaThumbnailListener', onThumb);
    reg('wallpaperRegisterMediaPlaybackListener', onPlayback);
    reg('wallpaperRegisterMediaTimelineListener', onTimeline);
    return M.supported;
  };

  /* вход для демо-режима в браузере: те же обработчики, без подмены API WE */
  M._feed = { status: onStatus, props: onProps, thumb: onThumb, playback: onPlayback, timeline: onTimeline };

  /* Lively Wallpaper: JSON с треком или null, если ничего не играет */
  window.livelyCurrentTrack = function (data) {
    let o = null;
    try { o = typeof data === 'string' ? JSON.parse(data) : data; } catch (err) { o = null; }
    RSN.inLively = true;
    M.supported = true;
    if (M.enabled !== true) { M.enabled = true; M.emit('status', true); }
    if (!o) { onPlayback({ state: -1 }); return; }
    onProps({ title: o.Title, artist: o.Artist, albumTitle: o.AlbumTitle });
    onThumb({ thumbnail: o.Thumbnail || '' });
    const MI = window.wallpaperMediaIntegration || {};
    onPlayback({ state: MI.PLAYBACK_PLAYING !== undefined ? MI.PLAYBACK_PLAYING : 1 });
  };
})();
