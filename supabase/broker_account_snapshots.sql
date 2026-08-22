-- Ejecutar en Supabase > SQL Editor.
-- broker_accounts (ya existente) es el mapeo FUTURO usuario NLT <-> cuenta
-- externa conectada (user_id NOT NULL, pensado para Eightcap Embedded) --
-- no sirve para guardar el reporting de cuentas que Tracknow YA reporta
-- hoy vía GET /financial/accounts (balance, currency, leverage), que no
-- necesariamente corresponden a un usuario de NLT identificado.
--
-- broker_account_snapshots es la tabla de reporting/sync real (Fase 7):
-- un snapshot de cada cuenta que Tracknow reporta bajo esta afiliación,
-- actualizado en cada sincronización -- separado a propósito de
-- broker_accounts para no forzar un user_id que todavía no existe.

create table if not exists broker_account_snapshots (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references broker_providers(id) on delete cascade,
  registration_id uuid references broker_registrations(id) on delete set null,
  external_account_id text not null,
  client_id text,
  status text,
  account_currency text,
  balance numeric(14,2),
  leverage integer,
  creation_date_tracknow text,
  sincronizado_en timestamptz not null default now(),
  unique (broker_id, external_account_id)
);
alter table broker_account_snapshots enable row level security;
create index if not exists idx_broker_account_snapshots_registration on broker_account_snapshots(registration_id);
