/* =========================================================
   RESONANCE — чёткие обложки из интернета (по желанию).
   Плееры отдают в Windows маленькую обложку (Яндекс Музыка — 150×150).
   Ищем трек в Deezer (запасной вариант — iTunes); если точного трека нет —
   перебираем альбомы исполнителя. Обложка принимается, только если она
   визуально совпадает с той, что прислал плеер. Иначе остаётся родная.
   ========================================================= */
(function () {
  'use strict';
  const RSN = window.RSN, P = RSN.palette;
  const cache = new Map();
  let seq = 0;

  /* JSONP: у этих API нет CORS для запросов из локального файла */
  function jsonp(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const name = '__rsnHQ' + (++seq);
      const s = document.createElement('script');
      let done = false, timer = 0;
      const finish = (ok, data) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window[name] = function () {};   // поздний ответ после таймаута не должен ронять страницу
        if (s.parentNode) s.parentNode.removeChild(s);
        if (ok) resolve(data); else reject(data);
      };
      window[name] = data => finish(true, data);
      s.onerror = () => finish(false, new Error('network'));
      timer = setTimeout(() => finish(false, new Error('timeout')), timeoutMs || 7000);
      s.src = url + (url.indexOf('?') < 0 ? '?' : '&') + 'callback=' + name;
      document.head.appendChild(s);
    });
  }

  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е')
    .replace(/\s*[([][^)\]]*[)\]]/g, ' ')
    .replace(/\s+(feat\.?|ft\.?|featuring|при уч\.?)\s.*$/i, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const firstArtist = s => norm(String(s || '').split(/,|&|;|\s+x\s+|\s+feat\.?\s+|\s+ft\.?\s+/i)[0]);

  function titleMatches(want, got) {
    const a = norm(want), b = norm(got);
    if (!a || !b) return false;
    return a === b || (a.length > 3 && b.indexOf(a) === 0) || (b.length > 3 && a.indexOf(b) === 0);
  }
  function artistMatches(want, got) {
    const a = firstArtist(want), b = norm(got);
    if (!a || !b) return false;
    return b.indexOf(a) >= 0 || a.indexOf(b) >= 0;
  }

  /* кандидат: test — маленькая картинка для сверки, full — большая для показа, pri — приоритет */
  async function deezer(title, artist, out) {
    const add = (alb, pri) => {
      if (!alb || !alb.cover_xl) return;
      if (out.some(c => c.full === alb.cover_xl)) return;
      out.push({ test: alb.cover_medium || alb.cover_big || alb.cover_xl, full: alb.cover_xl, pri });
    };
    const API = 'https://api.deezer.com/';
    const d1 = await jsonp(API + 'search?output=jsonp&limit=15&q=' + encodeURIComponent(artist + ' ' + title));
    let artistId = 0;
    for (const r of (d1 && d1.data) || []) {
      if (!r || !r.album || !r.artist || !artistMatches(artist, r.artist.name)) continue;
      artistId = artistId || r.artist.id;
      add(r.album, titleMatches(title, r.title_short || r.title) ? 0 : 1);
    }
    if (out.some(c => c.pri === 0)) return;
    /* точного трека нет — альбомы исполнителя (сверка по картинке решит) */
    if (!artistId) {
      const d2 = await jsonp(API + 'search/artist?output=jsonp&limit=5&q=' + encodeURIComponent(firstArtist(artist)));
      const hit = ((d2 && d2.data) || []).find(a => a && artistMatches(artist, a.name));
      artistId = hit ? hit.id : 0;
    }
    if (!artistId) return;
    const d3 = await jsonp(API + 'artist/' + artistId + '/albums?output=jsonp&limit=60');
    for (const alb of (d3 && d3.data) || []) add(alb, 2);
  }

  async function itunes(title, artist, out) {
    const d = await jsonp('https://itunes.apple.com/search?entity=song&limit=15&term=' + encodeURIComponent(artist + ' ' + title));
    for (const r of (d && d.results) || []) {
      if (!r || !r.artworkUrl100 || !artistMatches(artist, r.artistName)) continue;
      const full = r.artworkUrl100.replace(/\/\d+x\d+bb\./, '/1000x1000bb.');
      if (out.some(c => c.full === full)) continue;
      out.push({ test: r.artworkUrl100, full, pri: titleMatches(title, r.trackName) ? 0 : 1 });
    }
  }

  function candidates(title, artist) {
    const key = norm(artist) + '|' + norm(title);
    if (cache.has(key)) return cache.get(key);
    const p = (async () => {
      const out = [];
      try { await deezer(title, artist, out); } catch (e) { /* дальше — iTunes */ }
      if (!out.some(c => c.pri === 0)) {
        try { await itunes(title, artist, out); } catch (e) { /* нет сети */ }
      }
      return out.sort((a, b) => a.pri - b.pri);
    })();
    cache.set(key, p);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return p;
  }

  function loadCors(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      /* декодируем заранее, вне кадра — иначе первая отрисовка большой картинки даёт рывок */
      img.onload = () => (img.decode ? img.decode().then(() => resolve(img), () => resolve(img)) : resolve(img));
      img.onerror = () => reject(new Error('img'));
      img.src = url;
    });
  }

  /* насколько картинки похожи (0 — одинаковые): цвет + структура (перепады яркости) на сетке 16×16 */
  const G = 16;
  function grid(img) {
    const c = P.toSquare(img, G);
    const d = c.getContext('2d').getImageData(0, 0, G, G).data;
    const lum = new Float32Array(G * G);
    for (let i = 0; i < G * G; i++) lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    return { d, lum };
  }
  function distance(a, b) {
    let A, B;
    try { A = a.lum ? a : grid(a); B = b.lum ? b : grid(b); } catch (e) { return 999; }
    let col = 0, edge = 0;
    for (let i = 0; i < G * G; i++) {
      col += Math.abs(A.d[i * 4] - B.d[i * 4]) + Math.abs(A.d[i * 4 + 1] - B.d[i * 4 + 1]) + Math.abs(A.d[i * 4 + 2] - B.d[i * 4 + 2]);
      const x = i % G, y = (i / G) | 0;
      if (x < G - 1) edge += Math.abs((A.lum[i + 1] - A.lum[i]) - (B.lum[i + 1] - B.lum[i]));
      if (y < G - 1) edge += Math.abs((A.lum[i + G] - A.lum[i]) - (B.lum[i + G] - B.lum[i]));
    }
    return 0.6 * col / (G * G * 3) + 1.2 * edge / (2 * G * (G - 1));
  }
  RSN.hqDistance = distance;

  /* уже найденные чёткие обложки: следующий трек того же альбома получает её сразу, без сети */
  const recent = [];
  function remember(img, artist) {
    try { recent.unshift({ g: grid(img), img, artist: firstArtist(artist) }); } catch (e) { return; }
    if (recent.length > 40) recent.pop();
  }

  RSN.hq = {
    /* поиск начинаем сразу при смене трека, ещё до прихода обложки от плеера */
    prefetch(title, artist) {
      if (!title || !artist) return;
      candidates(title, artist).then(list => {
        list.slice(0, 4).forEach(c => loadCors(c.test).catch(() => {}));
        const exact = list.find(c => c.pri === 0);
        if (exact) loadCors(exact.full).catch(() => {});   // скорее всего понадобится — пусть лежит в кэше
      }).catch(() => {});
    },

    recall(ref, artist) {
      if (!ref || !recent.length) return null;
      let g;
      try { g = grid(ref); } catch (e) { return null; }
      const a = firstArtist(artist);
      for (const r of recent) {
        if (r.artist && a && r.artist !== a) continue;
        if (distance(g, r.g) < 12) return r.img;
      }
      return null;
    },

    /* ref — обложка от плеера: если она есть, найденная должна с ней совпасть визуально;
       без неё принимаем только точное совпадение названия трека */
    async fetch(title, artist, ref) {
      if (!title || !artist) return null;
      const list = await candidates(title, artist);
      let best = null, bestD = 1e9;
      for (const c of list.slice(0, 10)) {
        if (!ref) { if (c.pri === 0) { best = c; break; } continue; }
        let img;
        try { img = await loadCors(c.test); } catch (e) { continue; }
        const d = distance(img, ref);
        if (d < bestD) { bestD = d; best = c; }
        if (d < 14) break;   // уверенное совпадение — дальше не ищем
      }
      if (!best || (ref && bestD > 30)) return null;
      const img = await loadCors(best.full);
      if (ref) remember(img, artist);
      return img;
    }
  };
})();
