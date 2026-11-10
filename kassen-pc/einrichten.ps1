# Richtet einen Windows-PC als Kassen-PC an der Theke ein (einmalig, als Administrator).
# Wird von „Kassen-PC einrichten.bat“ gestartet. Kann gefahrlos mehrmals ausgeführt werden.

$ErrorActionPreference = 'Continue'
$ordner = Split-Path -Parent $MyInvocation.MyCommand.Path
$start = Join-Path $ordner 'Kasse starten.bat'
$adressDatei = Join-Path $ordner 'kasse-adresse.txt'

function Schritt($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "   OK: $text" -ForegroundColor Green }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Bitte als Administrator starten (Doppelklick auf "Kassen-PC einrichten.bat").' -ForegroundColor Red
    exit 1
}

Schritt 'Adresse der Kasse'
$alt = ''
if (Test-Path $adressDatei) { $alt = ([IO.File]::ReadAllText($adressDatei)).Trim() }
if ($alt) { Write-Host "   Bisher: $alt   (Enter = so lassen)" }
do {
    $url = (Read-Host '   Adresse der Kasse eingeben, z. B. https://....vercel.app/kasse').Trim()
    if (-not $url) { $url = $alt }
    $gueltig = $url -match '^https://\S+$'
    if (-not $gueltig) { Write-Host '   Die Adresse muss mit https:// beginnen.' -ForegroundColor Red }
} until ($gueltig)
[IO.File]::WriteAllText($adressDatei, $url, [Text.Encoding]::ASCII)
Ok "gespeichert: $url"

Schritt 'Energie: Bildschirm und PC nie automatisch ausschalten'
powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change disk-timeout-ac 0
Ok 'Bildschirm, Standby und Festplatte: nie'

Schritt 'Schnellstart und Ruhezustand ausschalten (besser bei hartem Stromabschalten)'
powercfg /hibernate off
New-Item -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled -Value 0 -Type DWord
Ok 'Schnellstart aus'

Schritt 'Ein/Aus-Knopf am PC: kurz drücken = herunterfahren'
# Untergruppe „Netzschalter und Zuklappen“ / Einstellung „Netzschalteraktion“, 3 = Herunterfahren
powercfg /setacvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 7648efa3-dd9c-4e3e-b566-50f929386280 3
powercfg /setdcvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 7648efa3-dd9c-4e3e-b566-50f929386280 3
powercfg /setactive SCHEME_CURRENT
Ok 'Knopf fährt herunter (Kontrolle: siehe Anleitung)'

Schritt 'Windows Update: kein automatischer Neustart, solange jemand angemeldet ist'
$wu = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
New-Item -Path $wu -Force | Out-Null
Set-ItemProperty -Path $wu -Name NoAutoRebootWithLoggedOnUsers -Value 1 -Type DWord
$wu2 = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate'
Set-ItemProperty -Path $wu2 -Name SetActiveHours -Value 1 -Type DWord
Set-ItemProperty -Path $wu2 -Name ActiveHoursStart -Value 10 -Type DWord
Set-ItemProperty -Path $wu2 -Name ActiveHoursEnd -Value 4 -Type DWord
Ok 'Updates werden geladen, der Neustart wartet (Nutzungszeit 10-4 Uhr)'

Schritt 'Benachrichtigungen und Bildschirmschoner aus'
New-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications' -Name ToastEnabled -Value 0 -Type DWord
Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name ScreenSaveActive -Value '0'
Ok 'Benachrichtigungen und Bildschirmschoner aus'

Schritt 'Touch: kein Wischen vom Bildschirmrand (öffnet sonst Windows-Menüs)'
$ui = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\EdgeUI'
New-Item -Path $ui -Force | Out-Null
Set-ItemProperty -Path $ui -Name AllowEdgeSwipe -Value 0 -Type DWord
Ok 'Rand-Wischen aus (wirkt nach dem Neustart)'

Schritt 'Edge: keine Begrüßungsseiten, kein Passwort-Speichern'
$edge = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge'
New-Item -Path $edge -Force | Out-Null
Set-ItemProperty -Path $edge -Name HideFirstRunExperience -Value 1 -Type DWord
Set-ItemProperty -Path $edge -Name PasswordManagerEnabled -Value 0 -Type DWord
Set-ItemProperty -Path $edge -Name TranslateEnabled -Value 0 -Type DWord
Ok 'Edge startet ohne Begrüßung und Übersetzungs-/Passwort-Fragen'

Schritt 'Autostart: Kasse startet nach dem Anmelden von selbst'
if (Test-Path $start) {
    $autostart = [Environment]::GetFolderPath('Startup')
    $wsh = New-Object -ComObject WScript.Shell
    $lnk = $wsh.CreateShortcut((Join-Path $autostart 'Saarcade Kasse.lnk'))
    $lnk.TargetPath = $start
    $lnk.WorkingDirectory = $ordner
    $lnk.WindowStyle = 7
    $lnk.Save()
    Ok "Verknüpfung im Autostart-Ordner angelegt ($autostart)"
} else {
    Write-Host "   FEHLER: $start nicht gefunden" -ForegroundColor Red
}

Write-Host ''
Write-Host 'Fertig. Bitte noch die Schritte aus EINRICHTUNG-KASSEN-PC.md erledigen' -ForegroundColor Yellow
Write-Host '(Drucker, Touch-Tastatur, BIOS "AC Recovery") und dann neu starten.' -ForegroundColor Yellow
