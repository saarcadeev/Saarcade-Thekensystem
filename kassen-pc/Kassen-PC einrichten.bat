@echo off
chcp 65001 >nul
rem Einmalige Einrichtung des Kassen-PCs. Fragt nach Administrator-Rechten.
net session >nul 2>nul
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0einrichten.ps1"
echo.
pause
