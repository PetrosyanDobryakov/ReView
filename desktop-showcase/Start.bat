@echo off
chcp 65001 >nul
title ReView - запуск приложения
rem One-click launcher: double-click this file. No console knowledge needed.
rem Expects this folder to sit inside the ReView checkout (..\package.json).

pushd "%~dp0.."

echo ============================================
echo  ReView - запуск приложения
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ОШИБКА] Node.js не найден.
  echo Скачай LTS с https://nodejs.org и запусти этот файл снова.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do echo Node: %%v

if not exist "node_modules" (
  echo Библиотеки не установлены, ставлю (один раз, может занять пару минут)...
  call npm ci
  if errorlevel 1 (
    echo [ОШИБКА] Не удалось установить библиотеки.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo Открываю приложение в браузере...
start "" "http://localhost:5173/"
echo.
echo Приложение запускается. Это окно НЕ закрывай пока работаешь.
echo Для выхода закрой это окно или нажми Ctrl+C.
echo --------------------------------------------
echo.

call npm run dev

echo.
echo Приложение остановлено. Можно закрывать окно.
pause
