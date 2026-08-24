-- Ejecutar en Supabase > SQL Editor (después de elite_signals.sql).
-- Automatización de ingesta de señales (TradingView / NLT Signal Engine ->
-- webhook -> NLT API -> elite_signals). Reutiliza EXACTAMENTE el mismo
-- molde de idempotencia que broker_webhook_events/propfirm_webhook_events
-- (unique(provider, event_id), nunca un chequeo previo con condición de
-- carrera -- el INSERT falla y se atrapa). Cero tablas nuevas de "eventos"
-- inventadas desde cero: elite_signals_webhook_events es una copia 1:1 del
-- shape real de propfirm_webhook_events (confirmado vía information_schema).

-- --- Ensancha el origen de una señal: hoy solo distinguía 'manual'/
-- 'webhook' (genérico); el pedido explícito es diferenciar quién generó
-- cada señal (MANUAL = admin, TRADINGVIEW / NLT_SIGNAL_ENGINE = webhook
-- real). La tabla está vacía en producción (0 filas, confirmado) así que
-- el cambio de valores es sin riesgo de datos huérfanos. ---
alter table elite_signals drop constraint if exists elite_signals_origen_check;
alter table elite_signals add constraint elite_signals_origen_check
  check (origen in ('MANUAL', 'TRADINGVIEW', 'NLT_SIGNAL_ENGINE'));
alter table elite_signals alter column origen set default 'MANUAL';

-- --- Segunda capa de idempotencia, a nivel de negocio (no solo del
-- webhook crudo) -- mismo patrón ya usado en broker_registrations
-- (unique(broker_id, external_id)): si dos event_id distintos terminaran
-- describiendo la misma señal externa, esto también lo bloquea. Parcial
-- (where not null) porque las señales manuales no siempre traen
-- external_id. ---
create unique index if not exists idx_elite_signals_external_id_unique
  on elite_signals (external_id) where external_id is not null;

-- --- Idempotencia del webhook crudo -- copia exacta del shape de
-- propfirm_webhook_events (mismas columnas, mismo unique(provider,
-- event_id), mismo patrón procesado/processing_error). Todo evento se
-- audita acá, se procese o no (incluidas señales rechazadas por Quality
-- Score bajo -- ver docstring de app/api/routes/elite_signals_webhook.py). ---
create table if not exists elite_signals_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text,
  payload jsonb not null,
  procesado boolean not null default false,
  processing_error text,
  origen_ip text,
  recibido_en timestamptz not null default now(),
  unique (provider, event_id)
);
alter table elite_signals_webhook_events enable row level security;
-- sin policies de select/insert/update para authenticated/anon => deny
-- total (service_role de NLT_API siempre puede, ignora RLS) -- mismo
-- patrón "deny por defecto" del resto de billing.sql/broker.sql/
-- propfirm_webhook_events.
