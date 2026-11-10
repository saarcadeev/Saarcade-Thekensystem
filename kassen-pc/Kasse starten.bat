@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Startet die Getränkekasse im Vollbild (Kassen-Mini-PC). Wird beim Anmelden automatisch gestartet.

if not exist "kasse-adresse.txt" (
  echo.
  echo  Die Datei kasse-adresse.txt fehlt. Bitte zuerst "Kassen-PC einrichten.bat" ausführen.
  echo.
  pause
  exit /b 1
)
set /p KASSE_URL=<kasse-adresse.txt

rem 1. Warten, bis das Internet da ist (nach dem Einschalten braucht das WLAN etwas), höchstens 2 Minuten
powershell -NoProfile -Command "for ($i = 0; $i -lt 24; $i++) { try { Invoke-WebRequest -UseBasicParsing -Method Head -TimeoutSec 3 $env:KASSE_URL | Out-Null; break } catch { Start-Sleep 2 } }"

rem 2. Nach hartem Ausschalten (Sicherung raus) keine Leiste "Seiten wiederherstellen?"
set PREFS=%LOCALAPPDATA%\SaarcadeKasse\Default\Preferences
if exist "%PREFS%" powershell -NoProfile -Command "$p = $env:PREFS; $q = [char]34; $t = [IO.File]::ReadAllText($p); $t = $t.Replace('exit_type' + $q + ':' + $q + 'Crashed', 'exit_type' + $q + ':' + $q + 'Normal').Replace('exited_cleanly' + $q + ':false', 'exited_cleanly' + $q + ':true'); [IO.File]::WriteAllText($p, $t)"

rem 3. Kasse als Vollbild-Fenster mit eigenem Edge-Profil (der Kassen-Login bleibt gespeichert).
rem    --kiosk-printing: Abrechnungsbeleg geht ohne Druckdialog an den Standarddrucker (UTAX).
rem    --disable-pinch / overscroll: kein Zoomen und kein Wischen zur vorigen Seite per Touch.
start "" msedge --user-data-dir="%LOCALAPPDATA%\SaarcadeKasse" --no-first-run --no-default-browser-check --hide-crash-restore-bubble --kiosk-printing --disable-pinch --overscroll-history-navigation=0 --start-fullscreen --app=%KASSE_URL%
