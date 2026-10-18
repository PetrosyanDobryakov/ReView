# desktop-showcase — всё для запуска в одном месте

```
desktop-showcase/
├── Start.bat      ← двойной клик: запустить приложение (Windows)
├── start.py       ← то же для Mac/Linux: python3 start.py
├── README.md      ← этот файл
├── boards/        ← твои доски (.review файлы): хранить и переносить
└── releases/      ← сюда приедут установщики (.exe/.dmg), когда будут готовы
```

## Запуск

- Windows: двойной клик по **`Start.bat`**. Нужен только Node.js LTS
  (https://nodejs.org). Всё остальное батник сделает сам и откроет
  приложение в браузере. Окно не закрывай, пока работаешь.
- Mac / Linux: `python3 start.py`.
- Проверка без запуска: `python3 start.py --check`.

Адрес приложения: http://localhost:5173/

## Доски

Кидай `.review` файлы в `boards/` и забирай их оттуда на другой компьютер.
Подробности — в `boards/README.md`.

## Установщики

Пока в разработке. Как появятся — лягут в `releases/`
(точнее, ссылки на GitHub Releases). Статус — в `docs/DESKTOP-PLAN.md`.
