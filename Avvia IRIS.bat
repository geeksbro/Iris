@echo off
setlocal
title IRIS
REM Avvia IRIS: controlla Node.js, installa e prepara IRIS se serve, la apre
REM nel browser. Il lavoro vero e' in scripts\iris.mjs.
cd /d "%~dp0"

if not exist "scripts\iris.mjs" (
  echo.
  echo   IRIS non trova i suoi file.
  echo   Se hai aperto lo ZIP con un doppio clic, prima estrailo: tasto destro
  echo   sul file ZIP, "Estrai tutto...", poi avvia "Avvia IRIS.bat" dalla
  echo   cartella estratta.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   IRIS ha bisogno di Node.js, che su questo computer non risulta installato.
  echo.
  echo   1. Scarica la versione LTS da https://nodejs.org ^(si apre ora nel browser^).
  echo   2. Installala lasciando le opzioni predefinite.
  echo   3. Fai di nuovo doppio clic su "Avvia IRIS.bat".
  echo.
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)

node "scripts\iris.mjs" %*
if errorlevel 1 (
  pause
  exit /b 1
)
endlocal
