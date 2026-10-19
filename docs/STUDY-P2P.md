# Изучение P2P-линии друга (`claude/full-p2p-desktop`)

Ревизия: `c682105`, версия `0.16.5`. Читалось тремя параллельными агентами
(десктоп / сеть / тесты-CI) только через `git show/grep/ls-tree`, плюс две
личные проверки (нет подписи обновлений, нет y-webrtc в зависимостях).
Ветки не переключались, файлы не менялись.

## 1. Установщик и автообновление (главный ответ)

- **Стек:** Electron 44 + electron-builder 26, конфиг `electron-builder.yml`
  (`appId dev.zpro.review`, цели nsis/dmg/AppImage+deb, `artifactName:
  ReView-${version}-${os}-${arch}.${ext}`, `publish: null`).
- **CI:** `.github/workflows/desktop-release.yml` по тегам `p2p-desktop-v*`:
  матрица 4 (win-x64, linux-x64, mac-arm64, mac-x64), Rust stable, installers
  в `release/`, публикация prerelease через `softprops/action-gh-release`
  (`make_latest: false`). Перед сборкой `hub-check`: живой хаб-тест + relay-e2e.
- **Автообновление — свое, без electron-updater.** `electron/main.cjs`
  (`RELEASES_API` = GitHub Releases API, префикс тегов `p2p-desktop-v*`,
  пропуск draft): Home показывает бейдж, скачивание стримом с прогрессом
  (`review-update`), установка: AppImage — поверх себя + relaunch, exe —
  silent-install `/S`, dmg/deb — скачать и открыть. Подмена фида для тестов:
  `REVIEW_UPDATE_FEED`.
- **Проверено лично: проверки подписи артефактов НЕТ** (в `main.cjs` нет
  pubkey/verify/checksum). Доверие = TLS GitHub + имя файла. Бинари unsigned
  (mac `identity: null`, ad-hoc codesign; в релиз-нотах честно: SmartScreen
  через More info, macOS через `xattr -cr`).
- **Воспроизведение:** поднять версию → `npm ci` (node 22, Rust stable) →
  `node scripts/desktop.mjs --dist -- --win/--linux/--mac` → артефакты из
  `release/` → тег `p2p-desktop-v<version>` → prerelease. Секреты не нужны.
- Окно грузит только свой хост (`http://127.0.0.1:<port>`, встроенный
  `review-host`, порты 4455–4474, `REVIEW_DESKTOP_PORT`), внешние ссылки —
  в системный браузер, `review://board/<id>` инвайты, single-instance lock.

## 2. Данные на диске

- Корень выбирает пользователь при первом старте (дефолт `Documents/ReView`),
  указатель `<config>/location.json`; legacy Tauri-данные переезжают сами.
- `boards/<id>.review` = сырой Y-апдейт + `<id>.json` мета; `blobs/<ab>/<sha256>`
  = `<mime>\n<bytes>`; зеркалирование с дебаунсом 1.5s, `__reviewFlushBoards`
  при выходе; media never deleted; compact перезаписывает файл без слияния.
- IPC только с loopback-источников (`reviewDesktop.invoke`), лимиты
  512 МБ доска / 64 МБ блоб, `writeAtomic` через rename.

## 3. Сеть: хаб + свой меш (без y-webrtc — проверено лично)

- **Меш свой** (`src/net/p2p/`: `mesh.ts`, `webrtcLink.ts`, `hub.ts`,
  `protocol.ts`…): один ordered `RTCDataChannel('review')`, фреймы 1 байт тип +
  тело, чанки 16 КБ (`MAX_FRAME`), `MAX_MESSAGE` 256 МБ; типы 0x01 Sync,
  0x02 Awareness, 0x03/0x04 Ping/Pong, 0x05 Hello, 0x06 Chunk, 0x07 NEIGHBORS,
  0x08/0x09/0x0a BlobWant/BlobPart/BlobMiss (SHA-256, слайсы, `MAX_BLOB` 64 МБ);
  full-mesh с релеем через соседей, resync по векторам при обрыве, пинги 5s,
  ретраи с бэкоффом. Инициатор = меньший peer-id, glare-токены, `sid` попыток.
- **Хаб только знакомит** (`/signal/<room>?peer=<id>`, `proto=1`):
  `welcome/peers/join/leave/signal/gone/error`, ping 20s, binary refused
  (1003), пустые комнаты исчезают сразу, лимиты 1024 комнат / 64 пира,
  peer-id `6..64 [A-Za-z0-9_-]`. Rust `review-host` и Workers `review-hub`
  wire-совместимы. Линк переживает смерть хаба.
- **Блобы между пирами** по хешу (наш phase A, развитый): `BLOB_WANT/PART/MISS`,
  префетч, пейсинг за живыми правками, скам-байты скипаются по SHA-256.
- **Выбор хабов:** self → LAN/mDNS → `VITE_HUBS` → Nostr (дефолт вкл,
  ephemeral kind 21078, AES-GCM seal) → custom → `#hub=` инвайты.
- **TURN:** свой Cloudflare `/turn` (24ч креды, `TURN_KEY_ID/TOKEN` в секретах
  Worker), пиры делятся только `turn.cloudflare.com`; ручной coturn через
  `turn:host:3478|user|pass`; STUN дефолт Google+CF; `[]` = LAN-only.
- **RelayLink:** после failed direct фреймы идут через Nostr-релеи (батчи
  24 КБ, медленно, но правки/курсоры живут). Диагностика: NAT-check
  (`ok/symmetric/blocked`), copy diagnostics, причина смерти линка в UI.

## 4. Тесты и деплой

- `npm test` (без браузера, но нужен cargo: `p2p-test.mjs` гоняет меш против
  реального review-host), `test:e2e` (2 headless Chromium, смерть хаба SIGKILL),
  `test:cf` (`wrangler dev` или живой хаб), `test:desktop` (нужен дисплей),
  `test:relay` (только публичные релеи, нужен интернет).
- Деплой `scripts/deploy.sh hub|spa|all`: хаб → аккаунт amicus
  (`2f8144b0…`), SPA → zpro (`3058d81d…`); live хаб
  `wss://review-hub.amicus-vamicus.workers.dev`. zpro-прод линией не тронут.
- На голой Windows нужно: Node 22, Rust stable (cargo), Playwright Chromium,
  для live — wrangler login/token. Той же нехватки тулчейна, что у нас.

## 5. Риски и открытые пункты (из их HANDOFF + свои находки)

- **Known limits (их):** картинка видна, только пока онлайн хоть один держатель
  байтов; старые доски держат инлайн до одиночной компакции.
- **Нет проверки подписи обновлений** (см. п.1) — принять осознанно или чинить.
- **Бинари unsigned** — SmartScreen/`xattr` танцы для каждого репетитора.
- Открыто: board-with-a-friend по инструкции, strict networks (их хендофф еще
  советует свой coturn, хотя 0.16.4 закрыл это CF TURN — текст устарел).
- **Красная линия:** `Land it` (мерж в `dev-warexpor`) и удаление `review-sync`
  на zpro — только по слову владельца. Наша ветка этого не касается.

## 7. Подпись обновлений — разбор (2026-10-19, наша ветка, их код не трогаем)

Как сейчас: приложение качает `.exe/.dmg/.AppImage/.deb` с GitHub Releases и
ставит без какой-либо проверки подписи. Доверие держится на двух вещах: TLS
(файл точно с GitHub, а не подменен по дороге) и имя файла.

Чего не хватает: доказательства, что файл собрал именно наш CI, а не кто-то,
получивший доступ. Сценарии: угнанный токен с правом пуша тегов (релизный
workflow публикует prerelease по тегу сам), компрометация аккаунта, вредоносный
PR в сам workflow. Последствие максимальное: тихая установка чужого кода на
машины репетиторов (exe ставится молча с `/S`, AppImage перезаписывает себя).

Варианты чинки (все требуют решения владельца+друга, т.к. меняют их релизный
конвейер; здесь только проекты, их ветка не тронута):
- A. Подпись артефактов отдельным ключом (minisign/signify): CI подписывает,
  приложение проверяет подпись перед установкой. Дешево, кроссплатформенно,
  ключ хранится вне репозитория.
- B. Платформенные проверки вместо своей криптографии: Authenticode на Windows,
  `codesign -v`/Gatekeeper на macOS, хеш-контроль AppImage. Сложнее, зависит
  от ОС, но использует системное доверие.
- C. Переезд на electron-updater: там verify из коробки, но это переписывание
  их рабочего механизма — самый тяжелый вариант.
- D. Ничего не делать осознанно: риск принят, mitigating factor — теги пушит
  узкий круг, релизы prerelease. Зафиксировать решение письменно.

## 8. Поддержка браузер ↔ приложение (2026-10-19, наша ветка)

Проверено чтением их кода и `docs/DESKTOP.md`. Все ниже — про одну версию линии
(0.16.x): меш и хаб-протокол свои, со старым сайтом (1.0.x, y-webrtc + DO)
несовместимы ни по одному проводу.

- **Приложение ↔ приложение (интернет):** `review://board/<id>` инвайт → встреча
  через встроенные хабы (CF + Nostr, только sealed handshake) → дальше напрямую.
  Работает по дизайну.
- **Приложение → браузер без приложения (LAN):** `http://<lan-ip>:4455/board/<id>`.
  Хитрость: браузер грузит UI с самого приложения (тот же http-origin), поэтому
  `ws://` на хаб не режется браузером как mixed content. Прямой линк. Работает.
- **Браузер (их сборка) ↔ приложение:** тот же код → меш общий, если есть общий
  хаб (`VITE_HUBS` в билде или `#hub=` хинт в ссылке). Работает при общем хабе.
- **https-страница ↔ LAN-хаб:** браузер запрещает (`blocked` в UI). Обход —
  только через wss-хабы (CF, Nostr). По дизайну, не чинится.
- **Старый сайт ↔ новая линия:** несовместимы полностью (меш, хаб, синк разные).
  Мост только файлами, и то в одну сторону нормально: старый v1-файл новое
  открывает; новый v2-файл с медиа старый не откроет (доски без медиа всегда
  v1 — ходят туда-сюда).
- **Одноклассники в LAN с приложением:** mDNS — хост виден в Connection → Hubs
  сам, отдельная ссылка не нужна.
- **Android:** только инструкция по SDK в доке, не запускалось. Не работает.

## 6. Что забираем (обновление PORT-PLAN)

- P1 showcase `boards/` — в силе.
- Практика e2e + CI-сборка installers — главный рецепт против нашего
  тулчейн-блокера (сборка в облаке, а не на машине).
- Диагностика сети в UI, изоляция облачных экспериментов на отдельном аккаунте.
- Их `review-host` + hub-протокол — референс нашему Шагу 2в.
- Tauri остается документированной альтернативой (их выбор — Electron).
