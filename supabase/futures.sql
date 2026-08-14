-- Ejecutar en Supabase > SQL Editor.
-- Módulo FUTURES -- completamente separado de cuentas_mt5 (CFD/Forex) a
-- propósito: el vocabulario es genuinamente distinto (contratos, tick
-- size/value, contract multiplier, exchange, contract month -- no hay
-- "lotes" ni "broker_server" ni contraseña de terminal). Tener tablas
-- propias hace que la mezcla CFD<->Futures sea estructuralmente imposible
-- (un motor de Futures ni siquiera puede leer una fila de cuentas_mt5),
-- no solo prevenida por una validación en runtime.

create table if not exists cuentas_futures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo_cuenta text not null check (tipo_cuenta in ('MASTER', 'SLAVE')),
  proveedor text not null default 'MOCK_FUTURES' check (proveedor in ('MOCK_FUTURES', 'TRADOVATE')),
  nombre_cuenta text,
  provider_account_id text,
  balance_actual numeric,
  equity_actual numeric,
  margen_usado numeric,
  margen_disponible numeric,
  multiplicador numeric not null default 1.0,
  estado text not null default 'PENDIENTE',
  ultimo_heartbeat timestamptz,
  creado_en timestamptz not null default now()
);
alter table cuentas_futures enable row level security;

drop policy if exists "select propio o admin" on cuentas_futures;
create policy "select propio o admin" on cuentas_futures for select
  using (auth.uid() = user_id or auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com');
-- Solo el backend (service_role, ignora RLS) escribe -- mismo patrón que cuentas_mt5.

-- Posiciones/operaciones Futures -- separada de historial_operaciones (CFD)
-- por el mismo motivo: contratos/tick size/contract multiplier no tienen
-- equivalente en una fila pensada para lotes de MT5.
create table if not exists futures_posiciones (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references cuentas_futures(id) on delete cascade,
  ticket_maestra text,
  ticket text,
  contract_symbol text not null,
  exchange text,
  contract_month text,
  direction text not null check (direction in ('LONG', 'SHORT')),
  contracts numeric not null,
  precio_entrada numeric,
  precio_salida numeric,
  stop_loss numeric,
  take_profit numeric,
  tick_size numeric,
  tick_value numeric,
  contract_multiplier numeric,
  pnl numeric,
  estado text not null default 'ABIERTA' check (estado in ('ABIERTA', 'CERRADA', 'RECHAZADA')),
  fecha_apertura timestamptz not null default now(),
  fecha_cierre timestamptz
);
alter table futures_posiciones enable row level security;

drop policy if exists "select propio o admin" on futures_posiciones;
create policy "select propio o admin" on futures_posiciones for select
  using (
    exists (
      select 1 from cuentas_futures c
      where c.id = futures_posiciones.cuenta_id
        and (c.user_id = auth.uid() or auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com')
    )
  );

create index if not exists idx_futures_posiciones_cuenta on futures_posiciones(cuenta_id, ticket_maestra);

-- Log de eventos (apertura/modificación/cierre/rechazo/reconexión) --
-- equivalente a trade_events pero del lado Futures, y también sirve para
-- auditar el motor MOCK durante las pruebas.
create table if not exists futures_eventos (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references cuentas_futures(id) on delete cascade,
  tipo_evento text not null,
  detalle jsonb,
  creado_en timestamptz not null default now()
);
alter table futures_eventos enable row level security;

drop policy if exists "select propio o admin" on futures_eventos;
create policy "select propio o admin" on futures_eventos for select
  using (
    exists (
      select 1 from cuentas_futures c
      where c.id = futures_eventos.cuenta_id
        and (c.user_id = auth.uid() or auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com')
    )
  );
