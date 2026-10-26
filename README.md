# Resonance

Музыкальные живые обои для [Wallpaper Engine](https://store.steampowered.com/app/431960/). Обложка и название трека берутся из любого плеера (Яндекс Музыка, Spotify, браузер), фон собирается из цветов обложки, звук превращается в визуализацию: «Горизонт», «Жидкий свет», «Аврора» и другие. Если музыка играет на Яндекс Станции, обои показывают и её.

![Resonance](preview.jpg)

**Установка:** [подпишитесь в Мастерской Steam](https://steamcommunity.com/sharedfiles/filedetails/?id=3827476266) — обои скачаются и появятся в Wallpaper Engine.

## Кнопки на обложке — Resonance Control

Обои умеют ставить трек на паузу и переключать его кликом по обложке, а когда музыка остановлена — продолжать последний трек кнопкой под часами. Но Wallpaper Engine не даёт обоям управлять плеерами. Это делает маленькая программа-помощник из папки [`control`](control).

- Слушает только `127.0.0.1:57391` и принимает команды только от Wallpaper Engine и Lively.
- Управляет тем плеером, чей трек показан на обоях (через системный медиа-API Windows).
- В интернет не ходит. Весь код — в [`control/ResonanceControl.cs`](control/ResonanceControl.cs).

**Установить:** скачайте репозиторий (Code → Download ZIP), распакуйте и запустите `control\install.cmd`. Скрипт соберёт программу из исходников встроенным компилятором .NET и добавит её в автозагрузку.
**Удалить:** `control\uninstall.cmd`.

## Яндекс Станция

Если музыка играет на колонке с Алисой, обои могут показывать её трек, обложку и визуализацию, а кнопки на обложке — управлять колонкой.

1. Установите помощник Resonance Control (см. выше).
2. В настройках обоев включите «Яндекс Станция». В правом нижнем углу появится QR-код.
3. Наведите на него камеру телефона и подтвердите вход в Яндекс ID (или нажмите на панель и войдите в браузере на компьютере).

Помощник найдёт колонку в домашней сети и подключится к ней напрямую. Работает с колонками Яндекса, которые поддерживают локальное управление (Станция, Мини, Макс, Лайт и другие); компьютер и колонка должны быть в одной сети. Протокол неофициальный (тот же, что в интеграции [AlexxIT/YandexStation](https://github.com/AlexxIT/YandexStation) для Home Assistant), поэтому обновление прошивки может его сломать.

Визуализация: компьютер музыку колонки не слышит, поэтому помощник берёт тот же трек из Яндекс Музыки, а обои беззвучно разбирают его в такт с колонкой.

## Конфиденциальность

Настройка «Чёткие обложки» отправляет название трека и исполнителя в Deezer и iTunes, чтобы найти обложку побольше. Настройку можно выключить.

«Яндекс Станция»: вход выполняется на сайте Яндекса, помощник получает токен и хранит его только на этом компьютере, зашифрованным средствами Windows (`%LOCALAPPDATA%\ResonanceControl\station.dat`). Помощник обращается только к серверам Яндекса (вход, список колонок, обложки, трек для визуализации) и к самой колонке в домашней сети. Отвязать: удалите этот файл или запустите `control\uninstall.cmd`.

Больше ничего никуда не отправляется.

## Поддержать автора

Обои бесплатные. Если хотите сказать спасибо:

**Картой или по СБП:** [Boosty](https://boosty.to/pinkpanther1377/donate) · [DonationAlerts](https://www.donationalerts.com/r/strikegamesnews) · [DonateX](https://donatex.gg/donate/pinkpanther)

**Криптой — USDT в любой из сетей ниже.** Отправляйте только USDT и только в той сети, что указана рядом с адресом — другие монеты или другая сеть могут потеряться.

| Сеть | Адрес USDT |
|---|---|
| TON | `UQDn8njNDzVExiHLLDgigNTtiWAZ6J4us8rT3VZ1qhxCzTcw` |
| Tron (TRC20) | `TGEQEUstJFwC3oHDedYxwxtgP8ZpX5PFWk` |
| BNB Smart Chain (BEP20) | `0x1C69A0DCACe8D205B462A18beB6Ac1952660C337` |
| Solana | `HkUg3AD14sa6y4n9PjmkovTQwnEbrmM6QcEFkW2cY6zm` |
| Ethereum (ERC20) | `0x1C69A0DCACe8D205B462A18beB6Ac1952660C337` |

## Лицензия

Код — MIT ([LICENSE](LICENSE)). Шрифты — SIL Open Font License ([fonts/OFL.txt](fonts/OFL.txt)). Сторонние компоненты — [THIRD-PARTY.txt](THIRD-PARTY.txt).

---

# Resonance (English)

Music live wallpaper for [Wallpaper Engine](https://store.steampowered.com/app/431960/). Cover and track info come from any player (Spotify, browsers, Yandex Music), the background is made from the cover colors, and the audio drives the visualizers: Horizon, Liquid light, Aurora and more. Music playing on a Yandex Station speaker shows up too.

**Install:** [subscribe on the Steam Workshop](https://steamcommunity.com/sharedfiles/filedetails/?id=3827476266) — the wallpaper downloads into Wallpaper Engine.

**Cover buttons (Resonance Control):** Wallpaper Engine does not let wallpapers control players, so a tiny helper in [`control`](control) does it. It listens on `127.0.0.1:57391` only, accepts commands only from Wallpaper Engine and Lively, controls the player whose track is shown, and never goes online. Install: download the repo, run `control\install.cmd` (builds from source with the built-in .NET compiler and adds itself to startup). Uninstall: `control\uninstall.cmd`.

**Yandex Station:** with the helper installed, turn on "Yandex Station" in the wallpaper settings and scan the QR code that appears in the corner to log in with Yandex ID. The helper finds the speaker on your home network and connects to it directly (unofficial local protocol, as used by [AlexxIT/YandexStation](https://github.com/AlexxIT/YandexStation)). The wallpaper then shows the speaker's track and cover, the cover buttons control the speaker, and the visualizer runs on a silent copy of the same track from Yandex Music, kept in sync with the speaker.

**Privacy:** the "Sharp covers" setting sends the track title and artist to Deezer and iTunes to find a larger cover; you can turn it off. For Yandex Station, the login happens on Yandex's site; the helper stores the token only on this PC, encrypted by Windows (`%LOCALAPPDATA%\ResonanceControl\station.dat`), and talks only to Yandex servers and to the speaker on your network. Delete that file or run `control\uninstall.cmd` to unlink. Nothing else is sent.

**Support the author:** the wallpaper is free. To say thanks: [Boosty](https://boosty.to/pinkpanther1377/donate) · [DonationAlerts](https://www.donationalerts.com/r/strikegamesnews) · [DonateX](https://donatex.gg/donate/pinkpanther), or USDT using one of the networks in the table above. **Send only USDT and only on the network listed next to the address** — other coins or another network may be lost.

**License:** code — MIT, fonts — SIL OFL 1.1, third-party notices — THIRD-PARTY.txt.
