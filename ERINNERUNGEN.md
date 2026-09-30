# Offene Punkte

Notizen für spätere Arbeitssitzungen. Erledigte Punkte bitte löschen.

## Sicherheit der API prüfen (notiert am 30.09.2026)

In `api/index.js` scheint die Schnittstelle Anfragen nach dem Login nicht mit einem
Token zu prüfen, und CORS ist für alle Webseiten freigegeben. Möglicherweise kann
jemand, der die Adresse kennt, Daten (Mitglieder, Buchungen, SEPA-Liste) abrufen oder
ändern, ohne angemeldet zu sein. Noch nicht im Detail geprüft.

## Mitglieder-PINs (notiert am 30.09.2026)

In `public/kasse.html` wird die PIN im Browser verglichen (`validatePin`). Dafür
müssen die PINs aller Mitglieder im Klartext an den Browser geschickt werden, und
`requiresPinCheck` schreibt die PIN zusätzlich in die Browser-Konsole. Besser wäre
ein Vergleich auf dem Server. Gehört zur Sicherheitsprüfung oben.

## Admin-Bereich: 1000-Zeilen-Grenze bei Buchungen (notiert am 30.09.2026)

`public/admin.html` lädt an mehreren Stellen alle Buchungen mit
`/api/transactions?limit=10000`. Supabase liefert standardmäßig aber höchstens
1000 Zeilen. Sobald die Tabelle `transactions` größer ist, fehlen dort ältere
Buchungen, z. B. in der Getränke-Abrechnung. Prüfen: Anzahl Zeilen in `transactions`
im Supabase-Dashboard. Die Kasse nutzt seit dem 30.09.2026 bereits
`?user_id=...` (Server lädt seitenweise, ohne Grenze).

## Admin-Bereich im Saarcade-Design (notiert am 30.09.2026)

Die Kasse hat die Logo-Farben (Magenta/Cyan/Gelb, dunkler Hintergrund). Admin-Bereich
und Login-Seiten sind noch im alten Lila-Design.
