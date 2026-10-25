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
    send(cmd, query) {
      if (!this.ok) return;
      const M = RSN.media;
      const who = 'title=' + encodeURIComponent(M.title || '') + '&artist=' + encodeURIComponent(M.artist || '');
      fetch(BASE + cmd + '?' + who + (query ? '&' + query : ''), { cache: 'no-store' }).catch(() => {
        this.ok = false;
        if (this.onChange) this.onChange();
      });
    }
  });

  /* помощник может запуститься позже обоев — проверяем периодически */
  C.ping();
  setTimeout(() => C.ping(), 4000);
  setInterval(() => C.ping(), 20000);
})();
