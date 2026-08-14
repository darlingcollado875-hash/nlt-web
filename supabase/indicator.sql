-- Ejecutar en Supabase > SQL Editor (después de plans.sql).
-- Tabla separada para las órdenes de NLT Indicator -- NO reutiliza `orders`
-- (esa es de Copy System/subscriptions_v2) ni mezcla nada con cuentas_mt5,
-- siguiendo el mismo principio de aislamiento ya aplicado a Futures.

create table if not exists indicator_orders (
  id uuid primary key default gen_random_uuid(),
  order_id text unique not null,                 -- mismo patrón NLT-YYYYMMDD-XXXXX que orders
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references plans(id),
  tradingview_username text not null,
  original_amount numeric(10,2) not null,
  discount_amount numeric(10,2) not null default 0,
  final_amount numeric(10,2) not null,
  currency text not null default 'USD',
  payment_provider text not null default 'pay2commerce',
  payment_reference text,
  provider_customer_id text,
  provider_subscription_id text,
  provider_transaction_id text,
  -- 'awaiting_payment' es un estado técnico (recién creada la orden, antes
  -- de que el pago se confirme) que no pediste explícitamente en tu lista
  -- de 5 estados -- lo agrego porque la orden necesita existir ANTES del
  -- pago para poder guardar el TradingView username del checkout. Los 5
  -- estados que sí pediste (pending/approved/rejected/active/cancelled)
  -- son exactamente los que ve Admin.
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment', 'pending', 'approved', 'rejected', 'active', 'cancelled')),
  test_mode boolean not null default false,        -- true = pago simulado, nunca un cobro real
  admin_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table indicator_orders enable row level security;
create index if not exists idx_indicator_orders_user on indicator_orders(user_id);
create index if not exists idx_indicator_orders_status on indicator_orders(status);
-- sin policies de select/insert/update para authenticated/anon => deny total,
-- mismo patrón "todo pasa por NLT_API service_role" del resto de billing.

drop trigger if exists trg_indicator_orders_updated_at on indicator_orders;
create trigger trg_indicator_orders_updated_at
  before update on indicator_orders
  for each row execute function set_actualizado_en_orders();

-- ============================================================
-- ecosystem_content -- CMS mínimo real (no HTML hardcodeado) para la
-- página /ecosystem. Empieza con la sección de videos (la única marcada
-- como placeholder hoy); se puede extender a más secciones después sin
-- cambiar la forma de la tabla.
-- ============================================================
create table if not exists ecosystem_content (
  id uuid primary key default gen_random_uuid(),
  seccion text not null,                          -- 'videos' por ahora; más secciones después
  tipo text not null check (tipo in ('video', 'imagen', 'texto')),
  titulo text,
  contenido text,                                  -- texto libre, o URL si tipo es video/imagen
  orden int not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table ecosystem_content enable row level security;
create policy "select contenido activo publico" on ecosystem_content
  for select using (activo = true);

drop trigger if exists trg_ecosystem_content_updated_at on ecosystem_content;
create trigger trg_ecosystem_content_updated_at
  before update on ecosystem_content
  for each row execute function set_actualizado_en_orders();
