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
