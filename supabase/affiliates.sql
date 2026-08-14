-- Ejecutar en Supabase > SQL Editor.
-- Sistema de afiliados NLT: afiliados, códigos, referidos, comisiones,
-- reglas de comisión y payouts. Mismo patrón que billing.sql: RLS
-- deny-por-defecto para authenticated/anon -- todo el acceso real pasa
-- por NLT_API (service_role), nunca directo desde el navegador.
--
-- No duplica usuarios/órdenes/productos:
--  - affiliate_referrals.referred_user_id referencia auth.users directo.
--  - affiliate_commissions.order_id referencia orders.id o
--    indicator_orders.id según order_source -- este proyecto tiene DOS
--    sistemas de órdenes reales y separados (Copy System/Academy vs
--    Indicator, ver services/orders.py y services/indicator_orders.py),
--    así que no existe una única FK posible; la integridad se valida en
--    services/affiliates.py, no en la base.
--  - affiliate_commission_rules referencia plans.producto/plans.id, el
--    catálogo ya existente (ver core/plans.py) -- no se inventa una lista
--    de productos aparte.

create extension if not exists pgcrypto;

create or replace function set_actualizado_en_affiliates()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- affiliates -- 1 fila por afiliado
-- ============================================================
create table if not exists affiliates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  nombre text not null,
  estado text not null default 'active' check (estado in ('active', 'suspended')),
  metodo_pago_config jsonb,  -- { "metodo": "paypal", "email": "..." } | { "metodo": "usdt", "wallet": "...", "red": "..." } -- libre, ver payouts
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table affiliates enable row level security;

drop trigger if exists trg_affiliates_updated_at on affiliates;
create trigger trg_affiliates_updated_at
  before update on affiliates
  for each row execute function set_actualizado_en_affiliates();

-- ============================================================
-- affiliate_codes -- un afiliado puede tener varios códigos (uno
-- principal + campañas puntuales que arme el admin)
-- ============================================================
create table if not exists affiliate_codes (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references affiliates(id) on delete cascade,
  codigo text unique not null,  -- siempre mayúsculas -- normalizado en services/affiliates.py
  activo boolean not null default true,
  es_principal boolean not null default false,
  tipo text not null default 'referral_only' check (tipo in ('referral_only', 'discount_only', 'referral_discount')),
  descuento_pct numeric(5,2) check (descuento_pct is null or (descuento_pct > 0 and descuento_pct <= 100)),
  created_at timestamptz not null default now()
);
alter table affiliate_codes enable row level security;
create index if not exists idx_affiliate_codes_affiliate on affiliate_codes(affiliate_id);

-- ============================================================
-- affiliate_referrals -- la atribución real: qué afiliado/código trajo a
-- qué usuario. UNIQUE en referred_user_id: un usuario solo puede tener UN
-- afiliado asociado para siempre -- el primero en confirmarse gana, nunca
-- se pisa (ver services/affiliates.py::atribuir_referido).
-- ============================================================
create table if not exists affiliate_referrals (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references affiliates(id) on delete cascade,
  affiliate_code_id uuid references affiliate_codes(id) on delete set null,
  referred_user_id uuid not null unique references auth.users(id) on delete cascade,
  atribuido_en timestamptz not null default now()
);
alter table affiliate_referrals enable row level security;
create index if not exists idx_affiliate_referrals_affiliate on affiliate_referrals(affiliate_id);

-- ============================================================
-- affiliate_commission_rules -- % o monto fijo, configurable por producto
-- y/o plan específico (nunca hardcodeado en código). Resolución en
-- services/affiliates.py: plan_id exacto > producto > fila global
-- (producto y plan_id null).
-- ============================================================
create table if not exists affiliate_commission_rules (
  id uuid primary key default gen_random_uuid(),
  producto text,  -- null = aplica a cualquier producto salvo que exista una regla más específica
  plan_id text,   -- null = aplica a todo el producto, no a un plan puntual
  tipo text not null default 'percentage' check (tipo in ('percentage', 'fixed')),
  valor numeric(10,2) not null,  -- porcentaje (0-100) si tipo=percentage, monto USD si tipo=fixed
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- NULLS NOT DISTINCT (Postgres 15+): un UNIQUE normal trata cada NULL
  -- como distinto de sí mismo, así que sin esto la fila global (producto y
  -- plan_id ambos null) no quedaría protegida contra duplicados.
  unique nulls not distinct (producto, plan_id)
);
alter table affiliate_commission_rules enable row level security;

drop trigger if exists trg_affiliate_commission_rules_updated_at on affiliate_commission_rules;
create trigger trg_affiliate_commission_rules_updated_at
  before update on affiliate_commission_rules
  for each row execute function set_actualizado_en_affiliates();

-- Regla global default: 10% para lo que no tenga una regla más específica.
-- Editable/desactivable desde el Admin Center apenas exista la UI.
insert into affiliate_commission_rules (producto, plan_id, tipo, valor)
values (null, null, 'percentage', 10)
on conflict (producto, plan_id) do nothing;

-- ============================================================
-- affiliate_payouts -- solicitudes de retiro del afiliado
-- ============================================================
create table if not exists affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references affiliates(id) on delete cascade,
  monto numeric(10,2) not null,
  metodo text not null,  -- 'paypal' | 'bank_transfer' | 'usdt' | 'other'
  datos_metodo jsonb,    -- snapshot del método al momento de pedir el payout
  estado text not null default 'PENDING' check (estado in ('PENDING', 'APPROVED', 'REJECTED', 'PAID')),
  referencia_transaccion text,
  notas_admin text,
  solicitado_en timestamptz not null default now(),
  procesado_en timestamptz,
  procesado_por text  -- email del admin
);
alter table affiliate_payouts enable row level security;
create index if not exists idx_affiliate_payouts_affiliate on affiliate_payouts(affiliate_id);
create index if not exists idx_affiliate_payouts_estado on affiliate_payouts(estado);

-- ============================================================
-- affiliate_commissions -- una fila por venta atribuida a un afiliado.
-- unique(order_source, order_id): una orden nunca genera dos comisiones
-- -- idempotencia real a nivel de base, no solo de buena fe en el código
-- (mismo criterio que payment_webhook_events.unique(provider, event_id)).
-- ============================================================
create table if not exists affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references affiliates(id) on delete cascade,
  referral_id uuid not null references affiliate_referrals(id) on delete cascade,
  affiliate_code_id uuid references affiliate_codes(id) on delete set null,
  order_source text not null check (order_source in ('orders', 'indicator_orders')),
  order_id uuid not null,
  producto text not null,
  monto_venta numeric(10,2) not null,
  tipo_comision text not null check (tipo_comision in ('percentage', 'fixed')),
  valor_comision numeric(10,2) not null,
  monto_comision numeric(10,2) not null,
  estado text not null default 'PENDING' check (estado in ('PENDING', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED')),
  payout_id uuid references affiliate_payouts(id) on delete set null,
  created_at timestamptz not null default now(),
  aprobado_en timestamptz,
  pagado_en timestamptz,
  unique (order_source, order_id)
);
alter table affiliate_commissions enable row level security;
create index if not exists idx_affiliate_commissions_affiliate on affiliate_commissions(affiliate_id);
create index if not exists idx_affiliate_commissions_estado on affiliate_commissions(estado);
create index if not exists idx_affiliate_commissions_payout on affiliate_commissions(payout_id);
