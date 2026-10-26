/* =========================================================
   RESONANCE — локализация интерфейса (русский / English)
   ========================================================= */
(function () {
  'use strict';
  const RSN = window.RSN;

  const STR = {
    ru: {
      untitled: 'Без названия',
      localFile: 'Локальный файл',
      mediaHint: 'Включи «Поддержка интеграции медиа» в настройках Wallpaper Engine',
      prev: 'Предыдущий', next: 'Следующий', playpause: 'Пауза / воспроизведение', resume: 'Продолжить',
      stName: 'Яндекс Станция',
      stConnect: 'Подключите Яндекс Станцию',
      stScan: 'Наведите камеру телефона на код и подтвердите вход в Яндекс ID',
      stBrowser: 'или нажмите сюда, чтобы войти в браузере на компьютере',
      stWait: 'Готовлю код для входа…',
      stExpired: 'Код устарел.',
      stRefresh: 'Нажмите, чтобы получить новый',
      stSearch: 'Вход выполнен. Ищу колонку в домашней сети…',
      stProblem: 'Не получается: ',
      stLinked: 'Станция подключена',
      stNoHelper: 'Нужен помощник Resonance Control: он лежит на GitHub проекта, установка за минуту',
      stOldHelper: 'Обновите помощника: запустите control\\install.cmd из новой версии',
      days: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
      months: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
      daysShort: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
      monthsShort: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
      help: '<b>Resonance — демо в браузере</b><br>В Wallpaper Engine трек и обложка придут из плеера.<br>' +
        '<kbd>N</kbd>/<kbd>B</kbd> трек &nbsp;<kbd>␣</kbd> пауза &nbsp;<kbd>S</kbd> стоп<br>' +
        '<kbd>V</kbd> визуализатор &nbsp;<kbd>C</kbd> обложка<br>' +
        '<kbd>L</kbd> раскладка &nbsp;<kbd>F</kbd> шрифт &nbsp;<kbd>G</kbd> язык &nbsp;<kbd>H</kbd> подсказка<br>' +
        'Перетащи аудиофайл в окно — визуализатор оживёт под него.'
    },
    en: {
      untitled: 'Untitled',
      localFile: 'Local file',
      mediaHint: 'Turn on “Media integration support” in Wallpaper Engine settings',
      prev: 'Previous', next: 'Next', playpause: 'Play / pause', resume: 'Resume',
      stName: 'Yandex Station',
      stConnect: 'Connect your Yandex Station',
      stScan: 'Point your phone camera at the code and confirm the Yandex ID login',
      stBrowser: 'or click here to log in with the browser on this PC',
      stWait: 'Preparing the login code…',
      stExpired: 'The code has expired.',
      stRefresh: 'Click to get a new one',
      stSearch: 'Logged in. Looking for the speaker on your home network…',
      stProblem: 'Something went wrong: ',
      stLinked: 'Station connected',
      stNoHelper: 'Requires the Resonance Control helper: get it from the project’s GitHub, it installs in a minute',
      stOldHelper: 'Update the helper: run control\\install.cmd from the new version',
      days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      daysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      help: '<b>Resonance — browser demo</b><br>In Wallpaper Engine the track and cover come from your player.<br>' +
        '<kbd>N</kbd>/<kbd>B</kbd> track &nbsp;<kbd>␣</kbd> pause &nbsp;<kbd>S</kbd> stop<br>' +
        '<kbd>V</kbd> visualizer &nbsp;<kbd>C</kbd> cover<br>' +
        '<kbd>L</kbd> layout &nbsp;<kbd>F</kbd> font &nbsp;<kbd>G</kbd> language &nbsp;<kbd>H</kbd> help<br>' +
        'Drop an audio file into the window to drive the visualizer.'
    }
  };

  /* язык системы: русский для ru/be/kk. Встроенный браузер WE может отдавать en-US
     и на русской системе — тогда подсказкой служит часовой пояс России и соседей */
  const RU_TZ = /^(Europe\/(Moscow|Kaliningrad|Samara|Volgograd|Saratov|Ulyanovsk|Astrakhan|Kirov|Minsk|Simferopol)|Asia\/(Yekaterinburg|Omsk|Novosibirsk|Barnaul|Tomsk|Novokuznetsk|Krasnoyarsk|Irkutsk|Chita|Yakutsk|Khandyga|Vladivostok|Ust-Nera|Magadan|Sakhalin|Srednekolymsk|Kamchatka|Anadyr|Almaty|Qostanay|Bishkek))$/;
  function detect() {
    const list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en']);
    if (list.some(l => /^(ru|be|kk)\b/i.test(String(l)))) return 'ru';
    try {
      if (RU_TZ.test(Intl.DateTimeFormat().resolvedOptions().timeZone || '')) return 'ru';
    } catch (e) { /* без Intl */ }
    return 'en';
  }

  const I = (RSN.i18n = {
    lang: detect(),
    setMode(mode) {
      const lang = mode === 'ru' || mode === 'en' ? mode : detect();
      if (lang === this.lang) return false;
      this.lang = lang;
      document.documentElement.lang = lang;
      return true;
    },
    t(key) { return (STR[this.lang] || STR.ru)[key]; },
    date(d) {
      const s = STR[this.lang] || STR.ru;
      return this.lang === 'en'
        ? s.days[d.getDay()] + ', ' + s.months[d.getMonth()] + ' ' + d.getDate()
        : s.days[d.getDay()] + ', ' + d.getDate() + ' ' + s.months[d.getMonth()];
    },
    dateShort(d) {
      const s = STR[this.lang] || STR.ru;
      return this.lang === 'en'
        ? s.daysShort[d.getDay()] + ', ' + s.monthsShort[d.getMonth()] + ' ' + d.getDate()
        : s.daysShort[d.getDay()] + ', ' + d.getDate() + ' ' + s.monthsShort[d.getMonth()];
    }
  });
  document.documentElement.lang = I.lang;
})();
