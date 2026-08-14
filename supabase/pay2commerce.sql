-- Ejecutar en Supabase > SQL Editor.
-- Columnas para relacionar cada orden con sus IDs reales en Pay2Commerce
-- (cliente, suscripción, transacción) -- payment_reference ya existía pero
-- era un solo campo genérico; esto separa cada concepto real de su API
-- (customer_id, subscription_id, invoice/transaction id) para poder
-- consultarlos de vuelta sin ambigüedad.

alter table orders add column if not exists provider_customer_id text;
alter table orders add column if not exists provider_subscription_id text;
alter table orders add column if not exists provider_transaction_id text;

-- 'refunded' es un estado real que faltaba en el check constraint.
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('pending', 'payment_verification', 'paid', 'failed', 'cancelled', 'expired', 'refunded'));

-- subscriptions_v2 también necesita el vínculo con la suscripción real de
-- Pay2Commerce para poder pausar/cancelar/reactivar desde su API.
alter table subscriptions_v2 add column if not exists provider text default 'manual';
alter table subscriptions_v2 add column if not exists provider_customer_id text;
alter table subscriptions_v2 add column if not exists provider_subscription_id text;

-- Log de webhooks entrantes de Pay2Commerce -- idempotencia real (un mismo
-- evento procesado dos veces nunca debe re-activar nada) + auditoría del
-- payload firmado tal cual llegó. event_id es lo mejor-esfuerzo que se pudo
-- extraer del payload (o un hash del body si el payload no trae un id
-- explícito -- el esquema exacto del evento todavía no está confirmado por
-- documentación de Pay2Commerce, solo los nombres de los 4 tipos de evento).
create table if not exists payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'pay2commerce',
  event_id text not null,
  event_type text,
  order_id uuid references orders(id),
  raw_payload jsonb not null,
  signature_valida boolean not null default true,
  recibido_en timestamptz not null default now(),
  unique (provider, event_id)
);
