# Saarcade-Thekensystem – Hinweise für Claude

Thekensystem (Getränkekasse) und Kleidungsverwaltung des Saarcade e.V. (Flipper- und
Arcademuseum). Ansprechpartner: Jochen (Admin, Kassenwart). Kommunikation auf Deutsch,
Jochen ist kein Entwickler: Schritte für GitHub Desktop/Supabase konkret erklären.

## Zuerst lesen

- `KLEIDUNG-PLAN.md` – laufender Umbau der Kleidungsverwaltung (Entscheidungen + Etappen)
- `ERINNERUNGEN.md` – offene Punkte (u. a. Sicherheit der API, PINs, 1000-Zeilen-Grenze)

## Aufbau

- `public/` – statische Seiten (Vercel). `api/index.js` – ein Node-Handler für alle `/api/...`-Routen.
- Datenbank: Supabase (Zugriff mit anon-Key). Claude hat **keinen** Zugriff aufs Supabase-Dashboard.
- Seiten:
  - `kasse.html` – Getränkekasse am **Raspberry Pi 4 (Chromium Kiosk)**. Datensparsam halten,
    keine Blur-/Dauer-Animationen. Nur ändern, wenn ausdrücklich gewünscht.
  - `admin.html` – großer Admin-Bereich (Getränke, Abrechnung, SEPA, Einstellungen, Barkassen-Abrechnungen).
  - `kleidung.html` – Mitglieder bestellen Vereinskleidung (private Geräte).
  - `admin-kleidung.html` – **eine Seite für Kleidung** (seit 19.10.2026), Menü links (Handy: ☰).
    Rolle `kleidung` (Oli, **nur Handy**, wenig IT-affin): Pakete, Druckliste, Freimitglieder, Bestand
    (Zugang buchen, nicht korrigieren), Bestellbedarf. Rolle `admin` zusätzlich Artikel, Bestellungen, Abzurechnen.
  - `kleidung-verwaltung.html` – nur noch Weiterleitung auf `admin-kleidung.html` (alte Lesezeichen).
  - `barkasse-beleg.js` – gemeinsamer Druckbeleg (Kasse + Admin).
- `sql/` – SQL-Dateien, die Jochen im Supabase **SQL Editor** ausführt.

## Arbeitsweise

- Dateien **gezielt mit Edit ändern**, nie große Dateien komplett neu schreiben
  (`admin.html` ~320 KB, `kasse.html` ~230 KB).
- Bestehende Funktionen nicht verändern, ohne es anzukündigen. Gefundene Fehler melden.
- Git ist nicht im PATH. Das Git von GitHub Desktop nutzen (Versionsordner ändert sich bei Updates):
  ```powershell
  $g = Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe" | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
  & $g status -sb
  ```
- **Commit und Push macht Jochen selbst in GitHub Desktop.** Claude pusht nur nach ausdrücklicher
  Zustimmung. Nach dem Push deployt Vercel automatisch (1–2 Minuten).
- Datenbank-Änderungen: SQL-Datei in `sql/` anlegen, Jochen führt sie **vor** dem Push aus.
- Testen lokal: `.claude/launch.json` (nicht im Repo) startet `py -m http.server 8765 --directory public`.
  Die API läuft lokal nicht; im Browser-Pane `apiCall`/`fetch` per JavaScript mit Testdaten ersetzen.
  Login-Seiten umgehen: `localStorage.kasseLogin` / `adminLogin` setzen (nur localhost).
- Nach jeder Änderung kurz sagen: welche Dateien, ob SQL nötig, dann „committen + Push origin“.

## Bekannte Eigenheiten

- `PUT /api/settings` ergänzt/aktualisiert nur noch (früher wurden alle Einstellungen gelöscht, behoben 15.10.2026).
- Supabase liefert standardmäßig max. 1000 Zeilen pro Abfrage.
- Barkassen-Abrechnung (`cash_closings`): `closing_type` 'shift' (Schichtwechsel) / 'final' (Tagesabschluss).
  Anfangsbestand der Folgeschicht = `handover_total` der letzten Zwischenabrechnung des Tages; der
  Kassenabschluss vergleicht nur Buchungen seit der letzten Abrechnung (`since`). Das grüne Feld zeigt
  für Barkeeper Saldo minus `balance_at_closing` (Schichtsumme; liegt der Saldo darüber, wurde im Admin
  abgerechnet → normaler Saldo). Überschuss → Trinkgeldkasse (wird vom Übergabebestand abgezogen).
  Kein Abschöpfen beim Tagesabschluss – macht Jochen zu Hause. Wechselgeld-Tabelle = Anfangsbestand.
- In `kasse.html` steht am Ende des ersten `<style>` ein verirrtes `` `; `` – neue CSS-Regeln **davor** einfügen.
