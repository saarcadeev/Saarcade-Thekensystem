# Saarcade Highscores – Anleitung

Eigenständiges kleines Programm, **unabhängig von Supabase und Vercel**.
Es läuft auf dem Notebook im Museum. Die Daten liegen in einer einzigen Datei.

| Seite | Adresse | Wofür |
|---|---|---|
| Eingabe | `http://localhost:8080/eingabe` | Scores eintragen (Notebook oder Handy) |
| Anzeige | `http://localhost:8080/anzeige` | Beamer: alle Flipper mit Top 5, scrollt automatisch |
| Verwaltung | `http://localhost:8080/verwaltung` | Flipper anlegen, Doppelte zusammenführen, Scores korrigieren, Einstellungen |

---

## 1. Einmalig: Notebook im Museum einrichten

1. **Python installieren:** <https://www.python.org/downloads/> → gelber Knopf „Download Python“.
   Beim Installieren unten **„Add python.exe to PATH“ anhaken**, dann „Install Now“.
2. **Programm aufs Notebook holen:** In GitHub Desktop das Repository klonen
   (oder den Ordner `highscore` per USB-Stick kopieren – mehr braucht es nicht).
3. **Energiesparen aus:** Einstellungen → System → Energie → Bildschirm und Energiesparmodus →
   bei Netzbetrieb überall **„Nie“**.
4. **Beamer als erweiterten Bildschirm:** Windows-Taste + P → **„Erweitern“**.
5. **WLAN als „Privat“ einstellen** (sonst kommen Handys nicht durch): Einstellungen →
   Netzwerk und Internet → WLAN → (euer WLAN) → Netzwerkprofiltyp **„Privates Netzwerk“**.

## 2. Starten

Doppelklick auf **`Highscore starten.bat`** im Ordner `highscore`. Dann passiert Folgendes:

- Ein schwarzes Fenster „Saarcade Highscore-Server“ geht auf. **Dieses Fenster offen lassen**
  (minimieren ist ok). Darin steht auch die Adresse für Handys.
- Die Eingabe öffnet sich im normalen Browser.
- Die Beamer-Anzeige öffnet sich als eigenes Vollbild-Fenster.

Beim **allerersten Start** fragt Windows, ob Python ins Netzwerk darf →
**„Private Netzwerke“ anhaken → Zulassen**.

**Anzeige auf dem falschen Bildschirm?** Ins Anzeige-Fenster klicken, dann
**Windows-Taste + Umschalt + Pfeil rechts** (oder links). Vollbild an/aus: **F11**.

**Erster Start der Verwaltung:** Beim ersten Aufruf von `/verwaltung` legst du das
Admin-Passwort fest. Bitte direkt nach der Einrichtung machen.

**Flipper anlegen:** Verwaltung → Flipper → alle Namen in das Feld kopieren (eine Zeile pro Flipper) → Anlegen.
Gibt es einen Flipper doppelt (z. B. zwei „Star Wars“), bitte unterscheiden: „Star Wars (Data East)“, „Star Wars (Stern)“.

## 3. Bedienung

**Eingabe**
- Ab 2 Buchstaben erscheinen Vorschläge. Antippen oder mit Pfeiltasten + Enter wählen.
- Neu anlegen über „＋ … neu anlegen“. Gibt es schon einen ähnlichen Namen, fragt das
  Programm nach („Jochn“ → „Meintest du Jochen?“).
- Nach dem Speichern bleibt der Flipper gewählt (praktisch, wenn mehrere nacheinander spielen).
  Angezeigt wird der Platz im Monat, im Jahr und ewig.
- **Tippfehler?** 10 Minuten lang gibt es „Rückgängig“. Danach in der Verwaltung unter „Scores“ korrigieren.
- Ist die Punktzahl mehr als 5-mal so hoch wie der bisherige Rekord, fragt das Programm nach.

**Beamer**
- Alle aktiven Flipper alphabetisch („The …“ wird ignoriert, also *The Addams Family* unter A).
- Rechts unten (Maus bewegen) wählst du **Wechselnd / Monat / Jahr / Ewig**. Die Wahl
  bleibt gespeichert. Tasten 1–4 gehen auch.
- Klick auf einen Flipper: alle Scores mit Datum. Zurück nach 10 Sekunden oder per Klick.
- Klick auf einen Spielernamen: sein bestes Ergebnis auf jedem Flipper mit seinem Platz
  in der ewigen Liste (beste Plätze zuerst). Ebenfalls 10 Sekunden.
- Neue Einträge erscheinen nach spätestens 10 Sekunden. 24 Stunden lang steht „NEU“ daneben.

**Handy**
- Am einfachsten: den **QR-Code oben rechts am Beamer** scannen. Er nimmt automatisch die
  aktuelle WLAN-Adresse des Notebooks – ändert sich die IP, passt sich der QR-Code beim nächsten
  Start von selbst an. Ausblenden oder feste Adresse: Verwaltung → Einstellungen.
- Oder im Museums-WLAN die Adresse aufrufen, die im schwarzen Server-Fenster steht, z. B.
  `http://192.168.178.23:8080/eingabe` (steht auch in der Verwaltung unter „Sicherung“).
- Tipp für später: `…/eingabe?flipper=Medieval Madness` wählt den Flipper schon vor. Damit
  kann man an jedem Gerät einen QR-Code aufkleben.

## 4. Daten und Sicherung

- Die Datenbank ist **`highscore\daten\highscores.db`**. Sie wird **nicht** zu GitHub hochgeladen.
- Jeden Tag legt der Server automatisch eine Kopie in `highscore\daten\sicherungen` an (60 Tage).
- Zusätzlich: Verwaltung → Sicherung → „Datenbank herunterladen“ (z. B. auf USB-Stick).
  Dort gibt es auch eine Excel-Liste (.csv) mit allen Scores.
- **Wiederherstellen:** Server-Fenster schließen, gesicherte Datei nach
  `highscore\daten\highscores.db` kopieren (alte ersetzen), neu starten.

## 5. Später: Umzug auf einen eigenen Server

- Das Programm braucht nur Python 3 und läuft unverändert auch unter Linux:
  `python3 server.py --port 8080`.
- Die Datenbank-Datei einfach mitnehmen.
- Soll es später PostgreSQL oder MySQL werden: Alle Datenbankzugriffe stehen in `server.py`
  und benutzen normales SQL. Die Tabellen sind oben in `server.py` beschrieben (`SCHEMA`).
- Fürs Internet (Eintragen von unterwegs) braucht es dann HTTPS und eventuell eine Eingabe-PIN.
  Im Museums-WLAN ist die Eingabe bewusst ohne Login.

## Technik in Kürze

- `server.py` – Webserver und Datenbank (nur Python-Standardbibliothek, keine Installation)
- `web/` – die Seiten (`eingabe.html`, `anzeige.html`, `verwaltung.html`, `gemeinsam.js`, `basis.css`, `logo.png`)
- Einstellungen (Spalten, Tempo, Pausen …) in der Verwaltung unter „Einstellungen“
- Test mit eigener Datei: `py server.py --port 8090 --db C:\pfad\test.db`
