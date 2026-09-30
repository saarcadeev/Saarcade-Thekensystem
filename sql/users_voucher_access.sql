-- Verzehrkarten nur für freigeschaltete Barkeeper-Accounts
-- Einmalig im Supabase-Dashboard unter "SQL Editor" ausführen.

alter table public.users
    add column if not exists voucher_access boolean not null default false;
