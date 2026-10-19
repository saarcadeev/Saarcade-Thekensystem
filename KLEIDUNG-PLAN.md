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

## Ist-Stand (technisch, vor Etappe 2)

- Tabellen: `clothing_items` (name, emoji, price, sizes[], colors[], available, image_url, pdf_url, sort_order),
  `clothing_orders` (member_id, member_name, **items als JSONB-Array**, payment_method, total, status,
  notes, billed, delivered_at), `clothing_stock` (clothing_item_id, size, quantity – **ohne Farbe**),
  `clothing_billings` (billing_number, order_ids[], member_ids[], total_amount), `free_shirts`
  (first_name, last_name, size, color, notes, delivered, delivered_at – **ohne Artikel-Bezug**).
- Item im JSON: `product_id, name, emoji, size, color, quantity, price, total`.
- Status heute pro Bestellung, uneinheitlich: `pending`, `paid`, `shipped`, `completed`, `cancelled`.
  `admin.html` nutzt paid/shipped/completed (completed = bezahlt + ausgeliefert);
  `admin-kleidung.html` und Olis Seite nutzen completed = ausgeliefert + Feld `billed`.
- `PUT /api/clothing-orders/{id}` mit status `completed` bucht Bestand ab (min. 0).
- SEPA-Abrechnung Kleidung in `admin.html` (Seite „Kleidungsabrechnung“): nimmt Bestellungen mit
  status `pending` + payment_method `sepa`, IBAN aus `users`, erzeugt `clothing_billings` + SEPA-Datei.
- Oli-Login: `/api/login` mit Rolle `kleidung` (oder `admin`), Sitzung in sessionStorage.

## Stand nach Etappe 2 (technisch)

Entscheidungen (16.10.2026): eine Position **pro Stück**; „Berechnet“ ist ein eigenes Feld
(`billed`), unabhängig vom Status; offene Bestellungen wurden bei der Übernahme vom Bestand abgebucht.

- **`clothing_order_positions`**: order_id, item_index (Stelle im items-JSON), member_id/-name,
  clothing_item_id, item_name, emoji, size, color, price, payment_method,
  status (`bestellt`, `fehlt`, `abholbereit`, `ausgegeben`, `storniert`), billed, billed_at, billing_id,
  ready_at, delivered_at, notes, stock_booked/stock_size/stock_color (womit abgebucht wurde).
- `clothing_stock.color` (leer = ohne Farbe), `clothing_items.stock_by_color` (Bestand je Farbe an/aus).
  Farbe zählt beim Bestand nur, wenn `stock_by_color` an ist. Umschalten bucht nichts um (Etappe 4 beachten).
- `free_shirts`: + clothing_item_id, stock_booked/-size/-color. „Ausgeliefert“ bucht ab, wenn ein Artikel eingetragen ist.
- SQL-Funktionen: `clothing_stock_adjust`, `clothing_stock_color`, `clothing_position_stock`,
  `clothing_free_shirt_stock`, `clothing_order_create_positions`.
- Übernahme: pending/confirmed → bestellt, paid → bestellt + berechnet, shipped → ausgegeben (nicht berechnet).
  completed/cancelled ohne Positionen (alte Bestellungen); „Unbezahlt“ in `admin-kleidung.html` zeigt sie weiter über `billed`.

**API**
- `POST /clothing-orders`: wie bisher + Positionen anlegen und abbuchen (Fehler dabei verhindern die Bestellung nicht).
- `PUT /clothing-orders/{id}` (alte Seiten): items → Größe/Farbe umbuchen; cancelled → offene Stücke storniert + zurückgebucht;
  shipped/completed → offene Stücke ausgegeben; paid, billed, shipped→completed → berechnet. Ohne Positionen: alte Abbuchung.
- `DELETE /clothing-orders/{id}`: offene Stücke zurückbuchen.
- `GET /clothing-positions?open=1&unbilled=1&status=a,b&member_id=&order_id=` (seitenweise, keine 1000er-Grenze).
- `PUT /clothing-positions/{id}` `{status, size, color, notes, billed, billing_id}` – bucht Bestand passend.
- `POST /clothing-positions/update` `{ids:[…], status?, notes?, billed?, billing_id?}` – mehrere auf einmal (Paket).
- Nach jeder Positionsänderung wird die Bestellung angeglichen: alles ausgegeben → completed, alles storniert → cancelled,
  alles berechnet → billed = true.
- `GET /clothing-demand`: je Artikel/Größe/Farbe Bestand, offene Stücke, `missing` (= fehlender Bestand).
- `POST /clothing-stock/book` nimmt optional `color`; `PUT /clothing-items/{id}` nimmt `stock_by_color`.
- `PUT /free-shirts/{id}` nimmt zusätzlich clothing_item_id, size, color.

## Etappen

- [x] **1 – Bestellseite** (15.10.2026): SEPA vorausgewählt; Haken „Ja, ich zahle per Lastschrift“
      zwischen Lastschrift und Überweisung, andere Zahlungsarten erst nach Entfernen des Hakens;
      Hinweistext (gelbe Box) im `admin-kleidung.html` änderbar (Setting `clothing_order_notice`);
      PDF-Upload im Artikel-Fenster von `admin-kleidung.html` ergänzt.
      Zusätzlich: Fehler in `PUT /api/settings` behoben (löschte alle Einstellungen).
- [x] **2 – Datenbank & Server** (16.10.2026): `sql/kleidung_etappe2.sql` + `api/index.js`, Details unten.
- [x] **3 – Olis Handy-Seite** (16.10.2026): `kleidung-verwaltung.html` umgebaut. Seiten bleiben getrennt
      (Oli: Handy-Seite, Jochen: `admin-kleidung.html`). Tab „Pakete“: Karte pro Mitglied, je Stück
      Fertig / Fehlt / Ändern (Größe/Farbe aus dem Artikel) / Stornieren (mit Rückfrage); pro Karte
      „Alles fertig“ und „Ausgeben“ (Haken, was übergeben wird; auch direkt ohne „Fertig“); Filter
      inkl. „Ausgegeben (30 Tage)“ mit Rückgängig. Tab „Druckliste“: umschaltbar „Bestellt + Fehlt“ /
      „Nur Fehlbestand“, Druck-Button. Freimitglieder: fehlen Artikel/Größe, werden sie bei
      „Ausgeliefert“ abgefragt, dann Bestandsabbuchung. Fehler behoben: Mitgliedersuche beim
      Eintragen (fehlendes Hinweisfeld).
- [x] **4 – Admin** (16.10.2026): `admin-kleidung.html`
      - Tab „Abzurechnen“ (ersetzt „Unbezahlt“): Stücke ab „abholbereit“ (auch direkt ausgegebene), noch nicht
        berechnet, je Mitglied + Zahlungsart. SEPA-Datei (eine Lastschrift pro Mitglied, Aufbau wie Getränke:
        Mandat `MANDATE-<Nr>`, Sequenztyp aus Einstellungen, Verwendungszweck mit Artikeln, Umlaute umgeschrieben),
        legt `clothing_billings` an und setzt billed + billing_id. Liste/CSV (Excel, Semikolon). „Berechnet“ von Hand.
        Darunter alte ausgelieferte Bestellungen ohne Positionen.
      - Tab „Bestellbedarf“ (`/clothing-demand`) mit „+ Zugang“.
      - Bestand mit Farbspalte, negativ rot; Artikel: Schalter „Bestand je Farbe führen“; Zugang mit Farbe und für
        Artikel ohne Größe; Korrektur auch negativ.
      - `admin.html`: alte Kleidungsabrechnung zeigt keine Bestellungen mehr, von denen schon Stücke berechnet sind.
- [x] **5 – Aufräumen `admin.html`** (18.10.2026): Menüpunkte „Kleidung“, „Bestellungen“, „Abrechnung Kleidung“
      ausgeblendet (Klasse `legacy-clothing`, nichts gelöscht). Neuer Menüpunkt „👕 Kleidung-Admin ↗“ öffnet
      `admin-kleidung.html`; Dashboard-Karte „Offene Kleidungsbestellungen“ ebenso. Unten im Menü Schalter
      „🗄️ Alte Kleidungsbereiche einblenden/ausblenden“ (pro Browser in localStorage `showLegacyClothing`).
      `admin-kleidung.html` übernimmt eine gültige Admin-Anmeldung aus `admin.html` (localStorage `adminLogin`).
      Hinweis: Die alte Kleidungs-SEPA nutzte `MAND-<Nr>` und `<BIC>NOTPROVIDED</BIC>` (ungültig) – nicht mehr verwenden.
      Später möglich: alten Kleidungs-Code in `admin.html` ganz entfernen, wenn er lange nicht gebraucht wurde.
