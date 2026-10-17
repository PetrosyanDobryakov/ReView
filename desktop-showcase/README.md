# desktop-showcase — запуск в один клик

## Сейчас (веб-версия из исходников)

- Windows: двойной клик по **`Start.bat`** — сам проверит Node.js, докачает библиотеки (один раз),
  запустит приложение и откроет его в браузере. Консоль не нужна. Пока работаешь — окно не закрывай.
- Mac / Linux: `python3 start.py` (того же эффекта).
- Проверка без запуска: `python3 start.py --check`.

Нужен только Node.js LTS (https://nodejs.org). Адрес приложения: http://localhost:5173/

## Позже (настоящий десктоп)

Сюда будут выкладываться установщики с автообновлением:

- Windows: `ReView-Setup.exe`
- macOS: `ReView.dmg`
- Linux: `ReView.AppImage` / `.deb`

Бинарники в git не коммитятся — они публикуются через GitHub Releases, здесь лежат только
ссылки и этот лаунчер. Статус сборки — в `docs/DESKTOP-PLAN.md` (ветка `dev-petrosyan-desktop`).
