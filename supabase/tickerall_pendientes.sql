-- Ejecutar en Supabase > SQL Editor.
-- Tracking de órdenes PENDIENTES (LIMIT/STOP) copiadas de la maestra a cada
-- destino en TickerAll -- tabla separada de historial_operaciones a propósito:
-- historial_operaciones es el ledger de TRADES reales (con profit/loss),
-- mientras que una pendiente puede cancelarse sin haber sido nunca un trade.
-- Mezclarlas ensuciaría las estadísticas de historial.html.
create table if not exists tickerall_pendientes_copiadas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cuenta_id uuid not null references cuentas_mt5(id) on delete cascade,
  login_numero bigint not null,
  ticket_maestra bigint not null,
  ticket_destino bigint not null,
  symbol text not null,
  tipo text not null check (tipo in ('BUY_LIMIT','SELL_LIMIT','BUY_STOP','SELL_STOP')),
  volumen numeric not null,
  precio numeric not null,
  sl numeric,
  tp numeric,
  estado text not null default 'PENDIENTE' check (estado in ('PENDIENTE','CANCELADA','EJECUTADA')),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

alter table tickerall_pendientes_copiadas enable row level security;

drop policy if exists "select propio o admin" on tickerall_pendientes_copiadas;
create policy "select propio o admin" on tickerall_pendientes_copiadas for select
  using (auth.uid() = user_id or auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com');
