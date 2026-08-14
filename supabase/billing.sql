-- Ejecutar en Supabase > SQL Editor.
-- Sistema real de monetización: cupones, órdenes, suscripciones pagadas,
-- auditoría de pagos. Reemplaza a perfiles.plan/solicitudes_plan como
-- fuente de verdad del plan (esas tablas quedan intactas, ya no se usan
-- para esto -- ver subscriptions_v2 abajo).
--
-- RLS: acceso "deny por defecto" para authenticated/anon -- ninguna de estas
-- tablas se lee/escribe directo desde el navegador. TODO pasa por NLT_API
-- (service_role, ignora RLS), que es quien calcula precios/descuentos/
-- estados reales. Esto es intencional: nunca confiar en el frontend para
-- estos datos (precio, descuento, estado de pago, límite de cuentas).

create extension if not exists pgcrypto;

-- ============================================================
-- coupons
-- ============================================================
create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  discount_percentage numeric(5,2) not null check (discount_percentage > 0 and discount_percentage <= 100),
  active boolean not null default true,
  first_payment_only boolean not null default true,
  expires_at timestamptz,
  max_uses int,
  uses_count int not null default 0,
  applicable_plans text[],  -- null = aplica a todos los planes
  created_at timestamptz not null default now()
);
alter table coupons enable row level security;
-- sin policies de select/insert/update para authenticated/anon => deny total
-- (service_role de NLT_API siempre puede, ignora RLS)

insert into coupons (code, discount_percentage, first_payment_only)
values ('NLT20', 20, true), ('NLT30', 30, true), ('NLT50', 50, true)
on conflict (code) do nothing;

-- ============================================================
-- orders
-- ============================================================
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_id text unique not null,  -- NLT-YYYYMMDD-XXXXX, generado en backend
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null,
  billing_period text not null default 'monthly' check (billing_period in ('monthly', 'yearly')),
  original_amount numeric(10,2) not null,
  discount_amount numeric(10,2) not null default 0,
  final_amount numeric(10,2) not null,
  currency text not null default 'USD',
  coupon_code text,
  payment_provider text not null default 'uglycash',
  payment_reference text,
  status text not null default 'pending'
    check (status in ('pending', 'payment_verification', 'paid', 'failed', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);
alter table orders enable row level security;
create index if not exists idx_orders_user on orders(user_id);
create index if not exists idx_orders_status on orders(status);

create or replace function set_actualizado_en_orders()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_orders_updated_at on orders;
create trigger trg_orders_updated_at
  before update on orders
  for each row execute function set_actualizado_en_orders();

-- ============================================================
-- subscriptions_v2 -- reemplaza perfiles.plan como fuente de verdad del
-- plan PAGADO. perfiles se mantiene solo para email/nombre (login).
-- ============================================================
create table if not exists subscriptions_v2 (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text,
  billing_period text not null default 'monthly' check (billing_period in ('monthly', 'yearly')),
  status text not null default 'pending'
    check (status in ('active', 'pending', 'past_due', 'cancelled', 'expired')),
  start_date timestamptz,
  next_billing_date timestamptz,
  max_accounts int not null default 0,
  price numeric(10,2),
  coupon_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table subscriptions_v2 enable row level security;

drop trigger if exists trg_subscriptions_v2_updated_at on subscriptions_v2;
create trigger trg_subscriptions_v2_updated_at
  before update on subscriptions_v2
  for each row execute function set_actualizado_en_orders();

-- ============================================================
-- payment_events -- auditoría: quién hizo qué, cuándo, a qué orden
-- ============================================================
create table if not exists payment_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  actor text not null,  -- email del admin, o 'system'
  accion text not null,  -- 'orden_creada', 'pago_confirmado', 'pago_rechazado'
  estado_anterior text,
  estado_nuevo text,
  referencia_pago text,
  created_at timestamptz not null default now()
);
alter table payment_events enable row level security;
create index if not exists idx_payment_events_order on payment_events(order_id);
