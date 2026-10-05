-- ══════════════════════════════════════════════════════════════════
-- NLT Charts Trader — conectar cuentas MT5 y operar desde el gráfico (producto de pago).
--   1) cuentas_mt5.tipo_cuenta admite 'CHARTS' (cuentas conectadas desde el gráfico; los copiadores y Guardian solo miran
--      MAESTRA/DESTINO/GUARDIAN, así que no las tocan ni cuentan contra el límite de Copy System).
--   2) Plan CHARTS_TRADER_MONTHLY (producto 'indicator', se activa solo al confirmarse el pago, sin usuario de TradingView).
--      Nace INACTIVO y con precio de ejemplo: el admin lo edita y lo activa desde Admin Center → Planes.
--   3) chart_trade_log: registro de cada intento de operar (quién, qué cuenta, qué se pidió, qué respondió el broker).
-- ADITIVO. RLS activa sin policies de cliente (solo el backend).
-- ══════════════════════════════════════════════════════════════════
alter table public.cuentas_mt5 drop constraint if exists cuentas_mt5_tipo_cuenta_check;
alter table public.cuentas_mt5 add constraint cuentas_mt5_tipo_cuenta_check
  check ((tipo_cuenta)::text = any (array['MAESTRA'::text, 'DESTINO'::text, 'GUARDIAN'::text, 'CHARTS'::text]));

insert into public.plans (id, producto, nombre, descripcion, precio, billing_period, max_cuentas, popular, activo, orden, features)
values ('CHARTS_TRADER_MONTHLY', 'indicator', 'NLT Charts Trader',
        'Conecta tus cuentas MT5 al gráfico y opera desde ahí. Incluye crear tus propios indicadores (NLT Script).',
        29.99, 'monthly', 3, false, false, 50,
        '["Conecta hasta 3 cuentas MT5","Opera desde el gráfico: compra, venta, SL/TP y cierre","Lote calculado según tu riesgo","Crea tus propios indicadores (NLT Script)"]'::jsonb)
on conflict (id) do nothing;

create table if not exists public.chart_trade_log (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid,
  action text not null,
  request jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists chart_trade_log_user_idx on public.chart_trade_log (user_id, created_at desc);
alter table public.chart_trade_log enable row level security;

-- ── Actualización: mapeo de símbolos por cuenta + plan abierto a $10/mes ──
alter table public.cuentas_mt5 add column if not exists symbol_map jsonb not null default '{}'::jsonb;
update public.plans set precio = 10.00, activo = true, updated_at = now() where id = 'CHARTS_TRADER_MONTHLY';
