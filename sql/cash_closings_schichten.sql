-- Barkassen-Abrechnung: Schichtwechsel (Zwischenabrechnung) und Tagesabschluss
-- Einmalig im Supabase-Dashboard unter "SQL Editor" ausführen – VOR dem Push.
-- Bestehende Abrechnungen bleiben unverändert (gelten als Tagesabschluss).

alter table public.cash_closings
    add column if not exists closing_type       text not null default 'final', -- 'shift' = Schichtwechsel, 'final' = Tagesabschluss
    add column if not exists opening_total      numeric(10,2),                 -- Anfangsbestand der Schicht
    add column if not exists opening_source_id  bigint,                        -- Anfangsbestand übernommen aus dieser Zwischenabrechnung
    add column if not exists withdrawal         numeric(10,2) not null default 0, -- optionale Entnahme
    add column if not exists handover_total     numeric(10,2),                 -- Übergabebestand an die nächste Schicht
    add column if not exists balance_at_closing numeric(10,2),                 -- Saldo des Barkeeper-Accounts beim Abrechnen (für die Schichtsumme an der Kasse)
    add column if not exists period_start       timestamptz;                   -- Buchungen ab diesem Zeitpunkt wurden verglichen
