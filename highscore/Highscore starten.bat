@echo off
chcp 65001 >nul
cd /d "%~dp0"

set PY=
where py >nul 2>nul && set PY=py
if not defined PY where python >nul 2>nul && set PY=python
if not defined PY (
  echo.
  echo  Python ist auf diesem Rechner nicht installiert.
  echo  Bitte von https://www.python.org/downloads/ installieren
  echo  ^(beim Installieren "Add python.exe to PATH" anhaken^).
  echo.
  pause
  exit /b 1
)

rem 1. Server in eigenem Fenster starten (dieses Fenster offen lassen)
start "Saarcade Highscore-Server" %PY% server.py --port 8080
timeout /t 3 /nobreak >nul

rem 2. Eingabe im normalen Browser
start "" "http://localhost:8080/eingabe"

rem 3. Beamer-Anzeige als eigenes Vollbild-Fenster (eigenes Edge-Profil, damit es ein neues Fenster wird)
start "" msedge --user-data-dir="%LOCALAPPDATA%\SaarcadeBeamer" --no-first-run --window-position=1920,0 --start-fullscreen --app=http://localhost:8080/anzeige
