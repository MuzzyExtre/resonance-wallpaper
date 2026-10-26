/* =========================================================
   RESONANCE — интерфейс поверх WebGL:
   обложка (карточка / винил / диск), текст, прогресс, часы
   ========================================================= */
(function () {
  'use strict';
  const RSN = window.RSN, U = RSN.util;
  const $ = id => document.getElementById(id);

  const pad2 = n => (n < 10 ? '0' : '') + n;

  /* разбиваем на графемы (эмодзи и диакритика не разваливаются) */
  function graphemes(text) {
    try {
      if (window.Intl && Intl.Segmenter) {
        return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), s => s.segment);
      }
    } catch (e) { /* старый движок */ }
    return Array.from(text);
  }

  /* побуквенное появление: строчные span'ы не ломают кернинг и переносы */
  function buildChars(el, text) {
    el.textContent = '';
    const frag = document.createDocumentFragment();
    const chars = graphemes(text);
    const step = chars.length > 40 ? 8 : chars.length > 22 ? 14 : 22;
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (/^\s+$/.test(ch)) { frag.appendChild(document.createTextNode(' ')); continue; }
      const s = document.createElement('span');
      s.className = 'ch';
      s.textContent = ch;
      s.style.animationDelay = (110 + i * step) + 'ms';
      frag.appendChild(s);
    }
    el.appendChild(frag);
  }

  class UI {
    constructor() {
      const e = (this.el = {});
      ['playerInner', 'art', 'artTilt', 'cover', 'coverSpin', 'coverA', 'coverB', 'coverSheen',
        'vinyl', 'vinylLabel', 'vinylCanvas', 'meta', 'title', 'artist', 'album',
        'progress', 'tCur', 'tDur', 'pBar', 'pFill', 'pHead', 'ctlPrev', 'ctlNext', 'ctlHint',
        'clockTime', 'cH', 'cM', 'cAp', 'clockDate', 'clockHint', 'mcTime', 'mcDate', 'resume', 'resumeLabel', 'resumeTrack'
      ].forEach(id => { e[id] = $(id); });
      this.body = document.body;
      this.S = RSN.settings;
      this.onControl = null;      // (cmd, arg) => void — назначает main.js
      this.ctlShownUntil = 0;
      this.ctlVisible = false;
      this.ctlIn = false;         // курсор рядом с обложкой
      this.ctlMoved = 0;
      this.hintFlipUntil = 0;     // значок паузы/плея меняем сразу, не дожидаясь ответа плеера
      this.hintFlipFrom = '';
      this.hintPause = null;
      this.peekCss = -1;
      this.dur = 0;
      this.front = e.coverA;
      this.back = e.coverB;
      this.coverSrc = null;
      this.mode = 'idle';
      this.track = { title: '', artist: '', album: '' };
      this.textTimer = 0;
      this.swapTimer = 0;

      this.tiltX = new U.Spring(0, 38, 11);
      this.tiltY = new U.Spring(0, 38, 11);
      this.kickS = new U.Spring(1, 320, 25);
      this.peek = new U.Spring(0, 58, 14);
      this.spin = 0;
      this.vinylAngle = Math.random() * 360;
      this.discAngle = 0;
      this.pendingLabel = null;
      this.pendingSince = 0;

      this.mouse = { x: 0, y: 0, tx: 0, ty: 0 };
      this.focus = 0;
      this.shape = { cx: window.innerWidth / 2, cy: window.innerHeight / 2, hw: 120, hh: 60, r: 60 };

      this.progressW = 0;
      this.progressPx = -1;
      this.progressOn = true;
      this.lastCur = '';
      this.lastDur = '';
      this.lastMinute = -1;
      this.layoutDirty = true;

      window.addEventListener('mousemove', ev => {
        this.mouse.tx = (ev.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
        this.mouse.ty = (ev.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
        this.pokeControls(ev.clientX, ev.clientY);
      });
      this.initControls();
      document.documentElement.addEventListener('mouseleave', () => { this.mouse.tx = 0; this.mouse.ty = 0; this.ctlIn = false; });
      window.addEventListener('resize', () => { this.layoutDirty = true; });
    }

    /* ---------- настройки ---------- */
    applySettings(S) {
      const b = this.body;
      const pick = (prefix, val, all) => all.forEach(v => b.classList.toggle(prefix + v, v === val));
      pick('layout-', S.layout, ['center', 'left', 'right']);
      pick('cover-', S.coverStyle, ['card', 'vinyl', 'disc']);
      pick('vis-', S.visualizer, ['fluid', 'aurora', 'ring', 'bars', 'ridge', 'none']);
      pick('font-', S.font, ['manrope', 'unbounded', 'serif', 'system']);
      pick('clock-', S.clockMode, ['auto', 'idle', 'off']);
      b.classList.toggle('vinyl-color', S.vinylColor === 'color');
      b.classList.toggle('no-cover', !S.showCover);
    b.classList.toggle('no-info', !S.showInfo);
    b.classList.toggle('no-album', !S.showAlbum);
      b.classList.toggle('no-date', !S.showDate);
      const r = document.documentElement.style;
      r.setProperty('--ui', String(U.clamp(S.uiScale, 0.4, 2)));
      r.setProperty('--ox', (S.offsetX * 100).toFixed(2) + 'vw');
      r.setProperty('--oy', (-S.offsetY * 100).toFixed(2) + 'vh');
      if (S.coverStyle !== 'disc') this.el.coverSpin.style.transform = '';
      this.layoutDirty = true;
      this.lastMinute = -1;
      if (this.track.title) requestAnimationFrame(() => this.fitTitle());
    }

    setColors(p) {
      const r = document.documentElement.style;
      r.setProperty('--c1', U.triplet(p.c1));
      r.setProperty('--c2', U.triplet(p.c2));
      r.setProperty('--c3', U.triplet(p.c3));
      r.setProperty('--vinyl-a', U.triplet(p.vinylA));
      r.setProperty('--vinyl-b', U.triplet(p.vinylB));
    }

    setHint(text) { this.el.clockHint.textContent = text || ''; }

    /* ---------- режим: idle / playing / paused ---------- */
    setMode(m) {
      if (m === this.mode) return;
      const prev = this.mode;
      this.mode = m;
      const b = this.body;
      b.classList.toggle('is-idle', m === 'idle');
      b.classList.toggle('is-playing', m === 'playing');
      b.classList.toggle('is-paused', m === 'paused');
      if (prev === 'idle' && m !== 'idle') {
        this.layoutDirty = true;
        if (this.track.title || this.track.artist) this.renderText();
        if (this.pendingLabel) { this.drawLabel(this.pendingLabel); this.pendingLabel = null; }
        this.peek.x = 0;
      }
    }

    /* ---------- текст ---------- */
    setTrack(title, artist, album) {
      title = title || ''; artist = artist || ''; album = album || '';
      const tr = this.track;
      if (title === tr.title && artist === tr.artist && album === tr.album) return;
      const had = !!(tr.title || tr.artist);
      this.track = { title, artist, album };
      clearTimeout(this.textTimer);
      if (!had || this.mode === 'idle') { this.renderText(); return; }
      [this.el.title, this.el.artist, this.el.album].forEach(el => {
        el.classList.remove('line-in');
        el.style.animationDelay = '0s';
        void el.offsetWidth;
        el.classList.add('line-out');
      });
      this.textTimer = setTimeout(() => this.renderText(), 360);
    }

    renderText() {
      const { title, artist, album } = this.track;
      const T = this.el.title, A = this.el.artist, B = this.el.album;
      buildChars(T, title || artist || RSN.i18n.t('untitled'));
      A.textContent = title ? artist : '';
      const low = s => s.toLowerCase();
      const showAlb = !!album && low(album) !== low(title) && low(album) !== low(artist);
      B.textContent = showAlb ? album : '';
      B.style.display = showAlb ? '' : 'none';
      [T, A, B].forEach((el, i) => {
        el.classList.remove('line-out', 'line-in');
        void el.offsetWidth;
        el.style.animationDelay = (i === 0 ? 0 : 0.2 + i * 0.1) + 's';
        el.classList.add('line-in');
      });
      this.fitTitle();
      this.layoutDirty = true;
    }

    /* название — максимум две строки: уменьшаем кегль, пока не влезет */
    fitTitle() {
      const T = this.el.title;
      T.style.setProperty('--title-fit', '1');
      let fit = 1;
      for (let i = 0; i < 7; i++) {
        const cs = getComputedStyle(T);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.1 || 1;
        const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        const lines = Math.round((T.scrollHeight - pad) / lh);
        if (lines <= 2 && T.scrollWidth <= T.clientWidth + 2) break;
        fit -= 0.09;
        T.style.setProperty('--title-fit', fit.toFixed(3));
      }
    }

    /* ---------- обложка ---------- */
    coverBacking() {
      const css = this.el.art.offsetWidth || 400;
      return Math.round(U.clamp(css * Math.min(window.devicePixelRatio || 1, 2), 128, 1600));
    }

    drawCover(canvas, src) {
      const size = this.coverBacking();
      if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
      const g = canvas.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.clearRect(0, 0, size, size);
      g.drawImage(src, 0, 0, size, size);
    }

    drawLabel(src) {
      const c = this.el.vinylCanvas, g = c.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(src, 0, 0, c.width, c.height);
    }

    /* смена картинки: новая проявляется поверх старой. Новый трек — быстро (0,6 с),
       та же обложка в лучшем качестве — медленно (1,8 с), чтобы резкость «наводилась» незаметно */
    crossfade(src, slow) {
      this.coverSrc = src;
      const incoming = this.back, outgoing = this.front;
      this.drawCover(incoming, src);
      clearTimeout(this.swapTimer);
      incoming.style.zIndex = '2';
      outgoing.style.zIndex = '1';
      incoming.classList.add('instant');
      incoming.classList.remove('on');
      incoming.classList.toggle('slow', !!slow);
      void incoming.offsetWidth;
      incoming.classList.remove('instant');
      incoming.classList.add('on');
      this.swapTimer = setTimeout(() => {
        outgoing.classList.add('instant');
        outgoing.classList.remove('on');
        void outgoing.offsetWidth;
        outgoing.classList.remove('instant');
      }, slow ? 1900 : 700);
      this.front = incoming;
      this.back = outgoing;
      this.swapAt = performance.now();
      this.swapSlow = !!slow;
    }

    setCover(src) {
      this.crossfade(src);

      /* винил: сначала уезжает в конверт, потом меняется «яблоко» */
      if (this.S.coverStyle === 'vinyl' && this.mode !== 'idle' && this.peek.x > 0.05) {
        this.pendingLabel = src;
        this.pendingSince = performance.now();
      } else {
        this.drawLabel(src);
      }
    }

    /* та же обложка, но чётче (из интернета): мягко «наводим резкость», без анимации смены трека */
    upgradeCover(src) {
      if (!src) return;
      if (performance.now() - (this.swapAt || 0) < (this.swapSlow ? 1900 : 700)) {
        /* смена ещё идёт — подменяем проявляющуюся картинку, в движении это незаметно */
        this.coverSrc = src;
        this.drawCover(this.front, src);
      } else this.crossfade(src, true);
      if (this.pendingLabel) this.pendingLabel = src; else this.drawLabel(src);
    }

    /* ---------- кадр ---------- */
    update(dt, now, audio, media) {
      const S = this.S, e = this.el;
      const t = now / 1000;
      if (this.layoutDirty) this.measure();

      const m = this.mouse, mk = 1 - Math.exp(-dt * 3);
      m.x += ((S.parallax ? m.tx : 0) - m.x) * mk;
      m.y += ((S.parallax ? m.ty : 0) - m.y) * mk;

      const visible = this.mode !== 'idle';
      const playing = this.mode === 'playing';
      this.focus = U.damp(this.focus, visible ? 1 : 0, 2.4, dt);

      if (visible || this.focus > 0.01) {
        const sway = S.coverStyle === 'card' ? 1 : 0.7;
        this.tiltX.target = Math.sin(t * 0.31) * 2.4 * sway - m.y * 6.5;
        this.tiltY.target = Math.cos(t * 0.23) * 3.2 * sway + m.x * 8.5;
        this.tiltX.step(dt);
        this.tiltY.step(dt);
        this.kickS.target = 1 + audio.kick * 0.028 * S.beatPulse * (playing ? 1 : 0);
        this.kickS.step(dt);
        e.artTilt.style.transform = 'perspective(1500px) rotateX(' + this.tiltX.x.toFixed(3) + 'deg) rotateY(' +
          this.tiltY.x.toFixed(3) + 'deg) scale(' + this.kickS.x.toFixed(4) + ')';
        e.coverSheen.style.transform = 'translate3d(' + (-this.tiltY.x * 2.4).toFixed(2) + '%,' + (this.tiltX.x * 2.4).toFixed(2) + '%,0)';
        this.updateVinyl(dt, now, playing);
        this.updateDisc(dt, playing);
        this.updateProgress(media);
      }
      const near = this.ctlIn && now - this.ctlMoved < 6000;
      const showCtl = this.mode !== 'idle' && (near || now < this.ctlShownUntil);
      if (showCtl !== this.ctlVisible) { this.ctlVisible = showCtl; e.art.classList.toggle('ctl-show', showCtl); }
      const flip = now < this.hintFlipUntil && this.mode === this.hintFlipFrom;
      const asPause = (this.mode === 'playing') !== flip;
      if (asPause !== this.hintPause) { this.hintPause = asPause; e.ctlHint.classList.toggle('as-pause', asPause); }
      this.updateClock();
      this.computeShape();
    }

    measure() {
      this.layoutDirty = false;
      this.progressW = this.el.pBar.clientWidth || 0;
      this.progressPx = -1;
      if (this.coverSrc) {
        const need = this.coverBacking();
        if (Math.abs(need - this.front.width) / need > 0.2) this.drawCover(this.front, this.coverSrc);
      }
    }

    updateVinyl(dt, now, playing) {
      if (this.S.coverStyle !== 'vinyl') return;
      this.spin = U.damp(this.spin, playing ? 1 : 0, playing ? 1.3 : 1.9, dt);
      this.vinylAngle = (this.vinylAngle + dt * this.spin * 200) % 360;
      let target = playing ? 0.5 : this.mode === 'paused' ? 0.13 : 0;
      if (this.pendingLabel) {
        target = 0;
        if (this.peek.x < 0.04 || now - this.pendingSince > 1600) {
          this.drawLabel(this.pendingLabel);
          this.pendingLabel = null;
        }
      }
      this.peek.target = target;
      this.peek.step(dt);
      /* стрелка «вперёд» стоит у края пластинки в покое: при смене трека пластинка
         ныряет в конверт, но стрелка не убегает из-под курсора при быстрых переключениях */
      const rest = playing ? 0.5 : this.mode === 'paused' ? 0.13 : 0;
      if (rest !== this.peekCss) { this.peekCss = rest; this.el.art.style.setProperty('--peek', String(rest)); }
      const dir = this.S.layout === 'right' ? -1 : 1;
      this.el.vinyl.style.transform = 'translate3d(' + (this.peek.x * dir * 100).toFixed(2) + '%,0,0)';
      this.el.vinylLabel.style.transform = 'rotate(' + this.vinylAngle.toFixed(2) + 'deg)';
    }

    updateDisc(dt, playing) {
      if (this.S.coverStyle !== 'disc') return;
      this.spin = U.damp(this.spin, playing ? 1 : 0, 1.2, dt);
      this.discAngle = (this.discAngle + dt * this.spin * 18) % 360;
      this.el.coverSpin.style.transform = 'rotate(' + this.discAngle.toFixed(2) + 'deg)';
    }

    updateProgress(media) {
      const e = this.el;
      const on = this.S.showProgress && media.timelineFresh() && media.dur > 0;
      this.dur = on ? media.dur : 0;
      if (on !== this.progressOn) { this.progressOn = on; e.progress.classList.toggle('off', !on); }
      if (!on) return;
      const pos = media.position(), dur = media.dur;
      const p = U.clamp(pos / dur, 0, 1);
      const px = Math.round(p * this.progressW * 2) / 2;
      if (px !== this.progressPx) {
        this.progressPx = px;
        e.pFill.style.width = px + 'px';
        e.pHead.style.transform = 'translate3d(' + px + 'px,0,0)';
      }
      const cur = U.formatTime(pos), du = U.formatTime(dur);
      if (cur !== this.lastCur) { this.lastCur = cur; e.tCur.textContent = cur; }
      if (du !== this.lastDur) { this.lastDur = du; e.tDur.textContent = du; }
    }

    /* ---------- управление: клик по обложке — пауза, стрелки — назад/вперёд ---------- */
    initControls() {
      const e = this.el;
      const tap = el => { el.classList.remove('tap'); void el.offsetWidth; el.classList.add('tap'); };
      const fire = (cmd, arg) => {
        if (this.onControl) this.onControl(cmd, arg);
        this.ctlShownUntil = performance.now() + 2600;
      };
      [e.ctlPrev, e.ctlNext].forEach(btn => {
        btn.addEventListener('click', ev => { ev.stopPropagation(); tap(btn); fire(btn.getAttribute('data-cmd')); });
      });
      e.art.addEventListener('click', () => {
        if (!this.body.classList.contains('ctl-on') || this.mode === 'idle') return;
        tap(e.art);
        this.hintFlipFrom = this.mode;
        this.hintFlipUntil = performance.now() + 2500;
        fire('playpause');
      });
      e.resume.addEventListener('click', ev => { ev.stopPropagation(); tap(e.resume); fire('resume'); });
      e.pBar.addEventListener('click', ev => {
        if (!this.body.classList.contains('seek-on') || !(this.dur > 0)) return;
        const r = e.pBar.getBoundingClientRect();
        fire('seek', U.clamp((ev.clientX - r.left) / Math.max(1, r.width), 0, 1) * this.dur);
      });
    }

    /* стрелки видны, пока курсор у обложки, и гаснут чуть позже, когда он уходит */
    pokeControls(x, y) {
      if (!this.body.classList.contains('ctl-on') || this.mode === 'idle') { this.ctlIn = false; return; }
      const e = this.el;
      const a = e.art.getBoundingClientRect(), p = e.ctlPrev.getBoundingClientRect(), n = e.ctlNext.getBoundingClientRect();
      const pad = window.innerHeight * 0.05;
      const L = Math.min(a.left, p.left, n.left) - pad, R = Math.max(a.right, p.right, n.right) + pad;
      const T = Math.min(a.top, p.top, n.top) - pad, B = Math.max(a.bottom, p.bottom, n.bottom) + pad;
      const inside = x >= L && x <= R && y >= T && y <= B, now = performance.now();
      if (this.ctlIn && !inside) this.ctlShownUntil = now + 1200;
      this.ctlIn = inside;
      this.ctlMoved = now;
    }

    /* кнопка «Продолжить» на экране с часами: track — последний игравший трек или null */
    setResume(track) {
      const e = this.el;
      this.body.classList.toggle('can-resume', !!track);
      e.resumeLabel.textContent = RSN.i18n.t('resume');
      e.resumeTrack.textContent = track ? [track.artist, track.title].filter(Boolean).join(' — ') : '';
    }
    resumeFailed() {
      const b = this.el.resume;
      b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope');
    }

    /* ok — помощник доступен; seek — умеет перематывать; mode — hover | always | off */
    setControls(ok, seek, mode) {
      const b = this.body, on = ok && mode !== 'off';
      if (b.classList.contains('ctl-on') !== on) this.layoutDirty = true;
      b.classList.toggle('ctl-on', on);
      b.classList.toggle('ctl-always', on && mode === 'always');
      b.classList.toggle('seek-on', on && !!seek);
      const e = this.el, t = k => RSN.i18n.t(k);
      e.ctlPrev.title = t('prev');
      e.ctlNext.title = t('next');
    }

    updateClock() {
      const d = new Date();
      const key = d.getHours() * 60 + d.getMinutes();
      if (key === this.lastMinute) return;
      this.lastMinute = key;
      const S = this.S, e = this.el;
      let h = d.getHours(), ap = '';
      if (!S.clock24) { ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; }
      const hh = S.clock24 ? pad2(h) : String(h);
      const mm = pad2(d.getMinutes());
      e.cH.textContent = hh;
      e.cM.textContent = mm;
      e.cAp.textContent = ap;
      e.mcTime.textContent = hh + ':' + mm + (ap ? ' ' + ap : '');
      e.clockDate.textContent = RSN.i18n.date(d);
      e.mcDate.textContent = RSN.i18n.dateShort(d);
    }

    focusEased() { return U.easeInOutCubic(U.clamp(this.focus, 0, 1)); }

    /* форма для WebGL: обложка в режиме плеера, «пилюля» вокруг часов в простое */
    computeShape() {
      const S = this.S, sh = this.shape;
      const W = window.innerWidth, H = window.innerHeight;
      const ar = this.el.art.getBoundingClientRect();
      const ks = this.kickS.x;
      const ccx = ar.left + ar.width / 2, ccy = ar.top + ar.height / 2;
      const chw = (ar.width / 2) * ks, chh = (ar.height / 2) * ks;
      const cr = S.coverStyle === 'disc' || !S.showCover ? chw : ar.width * 0.034 * ks;   // без обложки — круг

      let pcx, pcy, phw, phh;
      if (S.clockMode === 'off') {
        pcx = W / 2; pcy = H * 0.44; phw = phh = H * 0.16;
      } else {
        const r = this.el.clockTime.getBoundingClientRect();
        pcx = r.left + r.width / 2;
        pcy = r.top + r.height * 0.53;
        phh = r.height * 0.5;
        phw = r.width / 2 + r.height * 0.32;
      }
      const f = this.focusEased();
      /* прямоугольник текстового блока — чтобы яркие элементы фона не лезли под текст */
      if (f > 0.5) {
        const m = this.el.meta.getBoundingClientRect();
        this.metaRect = { l: m.left, t: m.top, r: m.right, b: m.bottom };
      } else this.metaRect = null;
      sh.cx = U.lerp(pcx, ccx, f);
      sh.cy = U.lerp(pcy, ccy, f);
      sh.hw = Math.max(4, U.lerp(phw, chw, f));
      sh.hh = Math.max(4, U.lerp(phh, chh, f));
      sh.r = U.lerp(Math.min(phw, phh), cr, f);
    }
  }

  RSN.UI = UI;
})();
