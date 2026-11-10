# Kassen-Mini-PC an der Theke einrichten

Ersetzt den Raspberry Pi an der Theke. Ziel: **Strom an → nach etwa einer Minute ist die Kasse
im Vollbild da**, ohne Anmelden. Strom einfach abschalten (Sicherung raus) ist erlaubt.

Die Kasse selbst ändert sich nicht – sie läuft weiter über Vercel/Supabase, der PC zeigt sie nur an.
Für den Dell OptiPlex 3060 Micro geschrieben, passt für jeden Windows-11-PC. Dauer: etwa 1 Stunde.

**Mitbringen:** Tastatur + Maus (nur für die Einrichtung), Netzwerkkabel oder WLAN-Stick,
den Ordner `kassen-pc` aus dem Repo `Saarcade-Thekensystem` (per Cloud oder USB-Stick),
die **Adresse der Kasse** (die Vercel-Adresse, unter der heute die Kasse läuft, mit `/kasse` am Ende)
und die **Zugangsdaten eines Barkeepers** für den ersten Kassen-Login.

> Tipp: Den Raspberry Pi nicht wegwerfen – er ist eine prima **Ersatz-Kasse**, falls der PC einmal ausfällt.

---

## 1. Anschließen

- Touch-Monitor per **HDMI** an den PC **und** sein **USB-Kabel** (für den Touch) in eine USB-Buchse.
  Hat der PC nur DisplayPort frei: Adapter DisplayPort → HDMI (ca. 10 €).
- Barcode-Scanner per USB.
- Netzwerkkabel zum Router (stabiler als WLAN) oder den WLAN-Stick.
- Für die Einrichtung: Tastatur und Maus.

## 2. BIOS: nach Stromausfall automatisch einschalten

1. PC einschalten und sofort mehrmals **F2** drücken, bis das BIOS-Menü erscheint.
2. **Power Management** → **AC Recovery** → **Power On**.
3. **Apply** → **OK** → **Exit**.

## 3. Windows: Konto ohne Passwort (für automatische Anmeldung)

- **Windows fragt beim ersten Start nach Sprache usw.:** Bei „Wie möchten Sie dieses Gerät einrichten?“ →
  **Für Arbeit oder Schule einrichten** → **Anmeldeoptionen** → **Stattdessen der Domäne beitreten** →
  Name `Theke`, **Passwort leer lassen**. Datenschutz-Fragen alle auf **Nein**.
- **Schon eingerichtet und es fragt nach einem Passwort:** Einstellungen → Konten → Anmeldeoptionen →
  Kennwort → Ändern → neues Passwort **leer lassen**.
- **Windows verlangt zwingend ein Microsoft-Konto:** erst damit einrichten, dann unter Einstellungen →
  Konten → Andere Benutzer → „Benutzer ohne Microsoft-Konto hinzufügen“ ein Konto `Theke` ohne
  Passwort anlegen, zum **Administrator** machen und ab hier dort weitermachen.

## 4. Windows-Updates einmal komplett

Einstellungen → **Windows Update** → Nach Updates suchen → installieren → neu starten → wiederholen,
bis „Sie sind auf dem neuesten Stand“ erscheint.

## 5. Drucker UTAX 3206ci einrichten

1. Der UTAX muss eingeschaltet und im selben Netzwerk sein.
2. Einstellungen → **Bluetooth und Geräte** → **Drucker und Scanner** → **Gerät hinzufügen**.
   Den UTAX in der Liste auswählen → **Gerät hinzufügen**. Windows lädt den Treiber selbst.
   *Findet Windows ihn nicht:* auf <https://www.utax.de> unter Service/Support → Downloads nach
   „3206ci“ suchen und den **KX-Treiber** für Windows installieren.
3. Weiter unten **„Windows soll Standarddrucker verwalten“ ausschalten**.
4. Den UTAX anklicken → **Als Standard festlegen** → **Testseite drucken**.

Die Kasse druckt den Abrechnungsbeleg später **ohne Druckdialog direkt auf den Standarddrucker**.

## 6. Touch prüfen

- Einmal auf den Bildschirm tippen: Der Mauszeiger muss genau dorthin springen.
- **Taucht beim Antippen eines Eingabefelds eine Windows-Bildschirmtastatur auf, die stört:**
  Einstellungen → Zeit und Sprache → **Eingabe** → **Bildschirmtastatur** →
  „Bildschirmtastatur anzeigen“ auf **Nie**. (Nur ändern, wenn sie wirklich stört – wird an der Kasse
  Text getippt, kann sie nützlich sein.)

## 7. Programm-Ordner kopieren

Den Ordner `kassen-pc` nach **`C:\Saarcade-Kasse`** kopieren (also `C:\Saarcade-Kasse\Kasse starten.bat` usw.).

## 8. Einrichtungs-Skript starten

Doppelklick auf **`Kassen-PC einrichten.bat`** → Administrator-Frage mit **Ja**. Im blauen Fenster:

1. **Adresse der Kasse** eingeben (z. B. `https://….vercel.app/kasse`) → Enter.
2. Das Skript stellt dann ein: Bildschirm/PC nie aus, **Schnellstart aus**, **Knopf = Herunterfahren**,
   **kein Update-Neustart** während des Betriebs, **Benachrichtigungen aus**, **kein Wischen vom
   Bildschirmrand** (öffnet sonst Windows-Menüs), Edge ohne Begrüßung, **Autostart der Kasse**.
3. „Fertig“ → eine Taste drücken.

> „Der Computer wurde durch Windows geschützt“: **Weitere Informationen** → **Trotzdem ausführen**.

## 9. Erster Start

1. **Neu starten.** Windows meldet sich ohne Passwort an, die Kasse öffnet sich im Vollbild.
2. Beim ersten Mal erscheint die **Kassen-Anmeldung** → mit einem Barkeeper- oder Admin-Zugang anmelden.
   Die Anmeldung bleibt danach gespeichert, auch nach Neustart und Stromabschalten.

## 10. Testen

1. Kasse wie gewohnt bedienen: antippen, **Barcode-Scanner** ausprobieren. (Eine echte Testbuchung
   danach wie gewohnt im Admin-Bereich korrigieren.)
2. **Drucken:** Beim nächsten echten Kassenabschluss prüfen, ob der Beleg ohne Rückfrage aus dem UTAX kommt.
   (Kommt doch ein Druckdialog: einfach „Drucken“ antippen – das funktioniert genauso.)
3. **Strom-Test:** Stecker ziehen, 10 Sekunden warten, einstecken. Der PC startet von selbst,
   nach etwa einer Minute ist die Kasse wieder da – ohne neue Anmeldung.

## Laufender Betrieb

- **Ausschalten:** Am liebsten kurz auf den Ein/Aus-Knopf drücken; Strom abschalten geht aber auch.
- **Windows-Updates: alle 4–6 Wochen einmal tagsüber** (z. B. vor der Öffnung): Tastatur anschließen,
  **Alt+F4** schließt die Kasse → Start → Ein/Aus → **„Aktualisieren und neu starten“** → warten, bis die
  Kasse wieder da ist. In dieser Zeit **nicht** den Strom abschalten.
- **Kasse hängt:** Ein/Aus-Knopf kurz drücken (fährt herunter), dann wieder einschalten.

## Wenn etwas nicht klappt

| Problem | Lösung |
|---|---|
| Weiße Seite / „Keine Verbindung“ nach dem Einschalten | Internet weg? Netzwerkkabel/WLAN prüfen, dann Knopf drücken und neu starten |
| Kasse nicht im Vollbild | Tastatur: **F11** |
| Kasse will wieder eine Anmeldung | einfach neu anmelden (passiert z. B. nach „Abmelden“ in der Kasse) |
| Andere Kassen-Adresse | `Kassen-PC einrichten.bat` erneut starten, neue Adresse eingeben |
| Beleg wird nicht gedruckt | Ist der UTAX an und Standarddrucker (Schritt 5)? Testseite drucken |
| Touch trifft daneben | Systemsteuerung → „Tablet PC-Einstellungen“ → **Kalibrieren** |
| PC startet nach Stromausfall nicht | BIOS-Einstellung aus Schritt 2 prüfen |
