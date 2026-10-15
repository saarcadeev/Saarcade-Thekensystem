# Umbau Kleidungsverwaltung – Plan

Stand: 15.10.2026. Abgestimmt mit Jochen (Admin). Diese Datei ist die Grundlage für
weitere Arbeitssitzungen. Erledigte Etappen abhaken.

## Grundregeln

- **Kasse (`kasse.html`) nicht anfassen.** Läuft auf dem Raspberry Pi, muss datensparsam bleiben.
- Bestehende Funktionen nicht verändern; jede Etappe einzeln hochladbar und lauffähig.
- Datenbank-Änderungen als SQL-Datei in `sql/`, **vor** dem Push im Supabase SQL Editor ausführen.

## Rollen

| Wer | Gerät | Aufgaben |
|---|---|---|
| Mitglieder | private Geräte | bestellen (`kleidung.html`) |
| Oli (Rolle `kleidung`) | nur Handy, wenig IT-affin | drucken, Pakete packen, abholbereit melden, ausgeben (`kleidung-verwaltung.html`) |
| Jochen (Admin) | Notebook | Artikel, Wareneingang, Bestellbedarf, Abrechnung (`admin-kleidung.html`) |

## Entscheidungen

**Zahlung**
- Bestellseite: **SEPA vorausgewählt**, Hinweis „möglichst Lastschrift beibehalten, Einzug sobald
  abholbereit“. Überweisung und PayPal bleiben wählbar. Das System weiß nicht verlässlich, wer
  Lastschrift hat (sepa_active ist nicht maßgeblich).
- Hinweistext (gelbe Box) auf der Bestellseite im Admin änderbar (Setting `clothing_order_notice`).

**Status pro Artikel (Position), nicht pro Bestellung**
1. Bestellt (Mitglied) → **Bestand wird sofort abgebucht** (darf negativ werden)
2. Fehlt / zurückgestellt (Oli oder Admin)
3. Abholbereit (Oli) → erscheint bei Admin unter „Abzurechnen“; Oli schreibt WhatsApp außerhalb des Systems
4. Berechnet (Admin)
5. Ausgegeben (Oli)
- Größe/Farbe ändern (Oli oder Admin): alten Bestand zurückbuchen, neuen abbuchen.
- Stornieren: Bestand zurückbuchen.
- Fertiges darf ausgegeben werden, Rest bleibt zurückgestellt.

**Pakete**
- Alle offenen Artikel eines Mitglieds (auch aus mehreren Bestellungen) = **ein Paket**.
- Artikel einer Bestellung sind einzeln weiterschaltbar (trennbar).

**Bestand**
- Im Lager nur fertig bedruckte Teile. Wareneingang bucht nur der Admin.
- Bestand je Artikel + Größe, **Farbe pro Artikel zuschaltbar** (heute: Schwarz/Grau = eigene Artikel).
- Negativer Bestand erlaubt, rot markiert.
- Mitglieder sehen keinen Bestand und dürfen alles bestellen.

**Freimitglieder-Shirts** (Liste bleibt manuell, Familienregel nicht automatisierbar)
- Bestand wird erst bei „ausgeliefert“ gemindert.
- Fehlen Artikel/Größe/Farbe, werden sie beim Klick auf „ausgeliefert“ abgefragt.

**Oli (Handy)**
- Karten pro Mitglied (Paket), große Buttons, Preise sichtbar.
- Größe und Farbe änderbar.
- Druckliste: Artikel / Farbe / Größe / Anzahl (Motive sind überall gleich).

**Admin**
- Eine zentrale Seite `admin-kleidung.html`.
- **„Abzurechnen“** (wichtigste Übersicht): abholbereite, noch nicht berechnete Artikel je Mitglied,
  mit Zahlungsart. Ausgabe: **SEPA-Datei (wie bisher in admin.html) und Liste/CSV**, Haken „Berechnet“.
- „Bestellbedarf“: offene Artikel minus Bestand.
- Kleidungsbereiche in `admin.html` erst ausblenden, wenn das Neue läuft.

**Bestehende Daten**
- Offene Bestellungen: alle Artikel starten als „Bestellt“. Ausgelieferte bleiben unverändert.

## Etappen

- [x] **1 – Bestellseite** (15.10.2026): SEPA vorausgewählt + Hinweis; Hinweistext im Admin änderbar.
      Zusätzlich: Fehler in `PUT /api/settings` behoben (löschte alle Einstellungen).
- [ ] **2 – Datenbank & Server**: Positionen-Tabelle (Status je Artikel), Bestand mit optionaler
      Farbe, Abbuchung bei Bestellung, Übernahme offener Bestellungen, API-Endpunkte.
- [ ] **3 – Olis Handy-Seite**: Pakete, Abholbereit / Fehlt / Ausgegeben, Größe/Farbe ändern,
      Druckliste, Freimitglieder mit Bestandsabbuchung.
- [ ] **4 – Admin**: Abzurechnen (SEPA + CSV, Haken „Berechnet“), Bestellbedarf, Bestand mit Farbe;
      danach Kleidungsbereiche in `admin.html` aufräumen.
