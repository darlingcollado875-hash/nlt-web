-- Ejecutar en Supabase > SQL Editor (después de plans.sql y billing.sql).
-- NLT Elite Signals: PAGO ÚNICO ($70, o $35 con cupón ELITE35), acceso
-- PERMANENTE hasta que un admin lo revoque. Reutiliza el checkout genérico
-- existente (orders + coupons) para el cobro real -- Pay2Commerce no tiene
-- ningún endpoint de cobro único de verdad (confirmado en
-- pay2commerce_checkout.py/indicator_orders.py: su API real solo expone
-- suscripciones recurrentes), así que el cobro se hace con el mismo truco
-- que ya usa NLT Academy para su propio plan one_time (crear la orden como
-- billing_period='monthly' para que Pay2Commerce acepte cobrar de verdad),
-- pero con una corrección que Academy NO tiene: apenas se verifica el
-- primer cobro, se CANCELA esa suscripción en Pay2Commerce (ver
-- app/services/orders.py::activar_pago) para que nunca vuelva a cobrar.
-- El acceso en sí NO se guarda en subscriptions_v2 (esa tabla vive atada a
-- next_billing_date/renovación) sino en elite_signals_access, calcada de
-- academy_access (permanente por diseño, admin-revocable).

-- --- Actualiza el copy del plan INDICATOR_MONTHLY, que ya existe en
-- producción con "NLT Elite Signals" listado como incluido (era solo
-- marketing, sin tabla ni endpoint detrás). Ahora que Elite Signals es su
-- propio producto pago, se quita esa mención para que ningún cliente de
-- Indicator piense que ya lo tiene sin pagar de nuevo. UPDATE explícito
-- (no un INSERT ... on conflict do nothing) porque la fila YA EXISTE en
-- producción y el INSERT de plans.sql no la tocaría. ---
update plans set
  descripcion = 'NLT Tools, con actualizaciones mensuales.',
  features = '["NLT Tools","Actualizaciones mensuales"]'::jsonb
where id = 'INDICATOR_MONTHLY';

-- --- Ensanchar el CHECK de plans.producto -- único cambio de schema
-- imprescindible, mismo patrón aditivo ya usado en pay2commerce.sql para
-- orders_status_check (agregar 'refunded'). subscriptions_v2.producto NO
-- tiene CHECK constraint (confirmado en repository.py), así que no
-- necesita ningún cambio acá. ---
alter table plans drop constraint if exists plans_producto_check;
alter table plans add constraint plans_producto_check
  check (producto in ('copy_system', 'indicator', 'academy', 'community', 'elite_signals'));

-- --- Plan: precio oficial $70, PAGO ÚNICO (billing_period='one_time', ya
-- permitido por el CHECK existente de plans -- mismo valor que usan
-- INDICATOR_LIFETIME/ACADEMY_BASIC). El precio de lanzamiento de $35 para
-- comunidad NO es un plan aparte -- es el cupón ELITE35 de abajo (50% off),
-- para que el precio público en `plans` nunca cambie y el especial se
-- pueda desactivar/expirar desde Admin sin tocar código. ---
insert into plans (id, producto, nombre, descripcion, precio, billing_period, popular, orden, features) values
  ('ELITE_SIGNALS_ONETIME', 'elite_signals', 'NLT Elite Signals', 'Señales estructuradas de alta calidad (Quality Score 90%+), directo en tu dashboard NLT. Pago único, acceso permanente.', 70.00, 'one_time', true, 1,
    '["Señales BUY/SELL con entry, TP y SL","Prioridad a señales con Quality Score 90%+","Historial completo de señales","Pago único -- acceso permanente","Acceso dentro del ecosistema NLT"]'::jsonb)
on conflict (id) do nothing;

-- --- Cupón de lanzamiento para comunidad: $70 * (1-0.50) = $35. Mismo
-- patrón que NLT20/NLT30/NLT50 en billing.sql -- controlado 100% desde
-- Admin (activar/desactivar/expirar), nunca un segundo precio público.
-- first_payment_only=FALSE a propósito (corrección post-auditoría): ese
-- flag chequea usuario_tiene_orden_pagada(), que mira CUALQUIER orden
-- pagada del usuario en CUALQUIER producto -- si fuera true, rechazaría a
-- cualquier miembro de la comunidad que ya paga Copy System/Academy/
-- Indicator, que es justo el público al que apunta este cupón.
-- applicable_plans ya restringe el descuento a este único plan, así que no
-- hace falta la restricción global de "primer pago". expires_at se deja
-- NULL acá (sin fecha de corte todavía definida) -- ajustar antes de
-- anunciar el código en el canal de comunidad. ---
insert into coupons (code, discount_percentage, active, first_payment_only, applicable_plans)
values ('ELITE35', 50, true, false, array['ELITE_SIGNALS_ONETIME'])
on conflict (code) do nothing;

-- --- Acceso PERMANENTE, calcado 1:1 de academy_access.sql (mismo motivo:
-- subscriptions_v2 no sirve para "permanente hasta que se revoque", solo
-- para "vigente hasta next_billing_date"). Una fila por usuario. ---
create table if not exists elite_signals_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  tipo_acceso text not null default 'manual' check (tipo_acceso in ('purchase', 'manual')),
  estado text not null default 'ACTIVE' check (estado in ('ACTIVE', 'REVOKED')),
  origen_orden_id uuid,  -- referencia informativa a orders.id -- sin FK, no siempre viene de una orden
  creado_por text,       -- 'system' si vino de un pago, email del admin si fue manual
  notas_admin text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table elite_signals_access enable row level security;

drop trigger if exists trg_elite_signals_access_updated_at on elite_signals_access;
create trigger trg_elite_signals_access_updated_at
  before update on elite_signals_access
  for each row execute function set_actualizado_en_orders();

-- --- La señal en sí (BUY/SELL, entry/SL/TP, Quality Score, timeframe,
-- estado). origen='manual' cubre el lanzamiento (alta desde Admin);
-- origen='webhook' queda reservado para cuando exista la integración real
-- de TradingView/Signal Engine (ver TODO en admin_elite_signals.py) --
-- NO se inventa ese endpoint todavía. ---
create table if not exists elite_signals (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  symbol text not null,
  direction text not null check (direction in ('BUY', 'SELL')),
  entry numeric,
  stop_loss numeric,
  take_profit numeric,
  quality_score numeric not null check (quality_score >= 0 and quality_score <= 100),
  timeframe text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'TP_HIT', 'SL_HIT', 'CANCELLED', 'EXPIRED')),
  origen text not null default 'manual' check (origen in ('manual', 'webhook')),
  creado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table elite_signals enable row level security;
create index if not exists idx_elite_signals_status on elite_signals(status);
create index if not exists idx_elite_signals_created on elite_signals(created_at desc);
-- sin policies de select/insert/update para authenticated/anon => deny
-- total (service_role de NLT_API siempre puede, ignora RLS) -- mismo
-- patrón "deny por defecto" del resto de billing.sql/broker.sql.

drop trigger if exists trg_elite_signals_updated_at on elite_signals;
create trigger trg_elite_signals_updated_at
  before update on elite_signals
  for each row execute function set_actualizado_en_orders();
