-- NLT Bot Supreme -- Fase 7 (License Sync / Reconciliation), ver RATIFIED
-- INTEGRATION CONTRACT v1. Dos cambios, ambos 100% del lado Ecosystem
-- (nunca tocan license_server/ ni src/nlt_bot/, congelados):

-- 1) suspended_by_ecosystem_at -- marca de ORIGEN de una suspensión,
-- necesaria para decidir con seguridad si una reactivación automática
-- corresponde (ver app/services/nlt_bot_license_sync.py). Se pone cuando
-- el job de sync suspende una licencia por falta de vigencia de
-- subscriptions_v2; se limpia (null) cuando: (a) el mismo job la
-- reactiva, o (b) un admin cambia el estado a mano desde el Admin Panel
-- (Fase 6, ver nlt_bot_admin.py::cambiar_status) -- un admin tocando la
-- licencia es SIEMPRE una "acción administrativa independiente" que
-- anula el origen automático. Sin esta columna, el job no tendría forma
-- segura de distinguir "yo la suspendí, puedo reactivarla" de "un admin
-- la suspendió por otro motivo, no me corresponde tocarla" -- ver
-- RATIFIED INTEGRATION CONTRACT v1 §7H.
alter table nlt_bot_licenses
  add column if not exists suspended_by_ecosystem_at timestamptz;

-- 2) Fila única de configuración/estado del job -- mismo patrón exacto
-- que economic_calendar_settings (id=1 fijo, last_attempt_at persistido
-- para sobrevivir reinicios de Railway sin disparar un re-sync
-- inmediato cada vez que el proceso se reinicia).
create table if not exists nlt_bot_license_sync_settings (
  id int primary key default 1,
  last_attempt_at timestamptz,
  last_run_at timestamptz,
  last_run_status text check (last_run_status in ('ok', 'error', 'partial')),
  last_error text,
  last_run_summary jsonb,
  constraint nlt_bot_license_sync_settings_singleton check (id = 1)
);
insert into nlt_bot_license_sync_settings (id) values (1) on conflict (id) do nothing;

alter table nlt_bot_license_sync_settings enable row level security;
-- Sin policies -- tabla puramente backend, mismo criterio que el resto
-- de nlt_bot_licenses (solo service_role, nunca el cliente directo).
