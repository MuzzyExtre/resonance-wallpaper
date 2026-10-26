/* =========================================================
   RESONANCE — кнопки управления плеером.
   Обои сами не умеют управлять плеером (медиа-API Wallpaper Engine
   только читает), поэтому команды уходят локальному помощнику
   Resonance Control (папка control\install.cmd), а он нажимает
   системные медиаклавиши. Нет помощника — кнопки скрыты.
   ========================================================= */
(function () {
  'use strict';
  const RSN = window.RSN;
  const BASE = 'http://127.0.0.1:57391/';

  const C = (RSN.control = {
    ok: false,
    seek: false,
    v: 0,
    busy: false,
    onChange: null,

    async ping() {
      if (this.busy) return this.ok;
      this.busy = true;
      let ok = false, seek = false;
      try {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = setTimeout(() => { if (ctl) ctl.abort(); }, 1500);
        const r = await fetch(BASE + 'ping', { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
        clearTimeout(timer);
        const j = await r.json();
        ok = !!j.ok; seek = !!j.seek;
        this.v = +j.v || 0;
      } catch (e) { ok = false; }
      this.busy = false;
      if (ok !== this.ok || seek !== this.seek) {
        this.ok = ok; this.seek = seek;
        if (this.onChange) this.onChange();
      }
      return ok;
    },

    /* с командой уходит показанный трек — помощник найдёт именно этот плеер,
       а не тот, где звук включали последним (например, YouTube) */
    /* промис: выполнил ли плеер команду */
    send(cmd, query, track) {
      if (!this.ok) return Promise.resolve(false);
      const t = track || RSN.media;
      const who = 'title=' + encodeURIComponent(t.title || '') + '&artist=' + encodeURIComponent(t.artist || '');
      return fetch(BASE + cmd + '?' + who + (query ? '&' + query : ''), { cache: 'no-store' })
        .then(r => r.json()).then(j => !!j.ok)
        .catch(() => {
          this.ok = false;
          if (this.onChange) this.onChange();
          return false;
        });
    }
  });

  /* продолжить остановленный трек. Помощник с v3 включает только этот плеер (/resume);
     старый умеет лишь «пауза/плей» */
  C.resume = track => C.send(C.v >= 3 ? 'resume' : 'playpause', null, track);

  /* помощник может запуститься позже обоев — проверяем периодически */
  C.ping();
  setTimeout(() => C.ping(), 4000);
  setInterval(() => C.ping(), 20000);
})();
