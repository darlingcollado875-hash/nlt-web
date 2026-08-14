-- Ejecutar en Supabase > SQL Editor.
-- Tablas nuevas para NLT_API (backend FastAPI tipo MetaApi), pensadas para
-- EXTENDER el esquema ya existente (cuentas_mt5, historial_operaciones),
-- no duplicarlo -- así nlt-web y NLT_Copier siguen funcionando sin tocarlos.

-- Columnas que le faltan a cuentas_mt5 para cubrir "trading_accounts" del plan.
alter table cuentas_mt5 add column if not exists nombre_cuenta text;
alter table cuentas_mt5 add column if not exists equity_actual numeric;
alter table cuentas_mt5 add column if not exists profit_actual numeric;

-- Estado de conexión/salud, separado de los datos de la cuenta: quién es
-- el worker que la tiene conectada, cuándo dio señal de vida por última
-- vez, y el detalle del último error si lo hubo. cuentas_mt5.estado sigue
-- siendo la fuente rápida para la UI; esta tabla es el detalle operativo.
create table if not exists account_connections (
  cuenta_id uuid primary key references cuentas_mt5(id) on delete cascade,
  estado text not null default 'PENDIENTE',
  worker_pid int,
  ultimo_heartbeat timestamptz,
  detalle_error text,
  actualizado_en timestamptz not null default now()
);
alter table account_connections enable row level security;

drop policy if exists "select propio o admin" on account_connections;
create policy "select propio o admin" on account_connections for select
  using (
    exists (
      select 1 from cuentas_mt5 c
      where c.id = account_connections.cuenta_id
        and (c.user_id = auth.uid() or auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com')
    )
  );
-- Solo el backend (service_role, ignora RLS) escribe aquí.

-- Log granular de eventos detectados por el Event Listener: apertura,
-- modificación de SL/TP, cierre. Separado de historial_operaciones
-- ("trades") porque una misma operación puede generar varios eventos
-- a lo largo de su vida.
create table if not exists trade_events (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references cuentas_mt5(id) on delete cascade,
  ticket bigint not null,
  tipo_evento text not null check (tipo_evento in ('ABIERTA', 'SL_MODIFICADO', 'TP_MODIFICADO', 'CERRADA')),
  symbol text,
  volumen numeric,
  precio numeric,
  sl numeric,
  tp numeric,
  profit numeric,
  creado_en timestamptz not null default now()
);
alter table trade_events enable row level security;

drop policy if exists "select propio o admin" on trade_events;
create policy "select propio o admin" on trade_events for select
  using (
    exists (
      select 1 from cuentas_mt5 c
      where c.id = trade_events.cuenta_id
        and (c.user_id = auth.uid() or auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com')
    )
  );

create index if not exists idx_trade_events_cuenta on trade_events(cuenta_id, ticket);

-- Foto de las posiciones ABIERTAS ahora mismo (el worker la reescribe cada
-- ciclo). Es lo que responde GET /accounts/{id}/data para "posiciones" --
-- FastAPI no puede pedirle esto a MT5 en vivo (ver restricción técnica del
-- plan: solo el proceso worker tiene la sesión IPC), así que necesita un
-- lugar donde leer el último estado conocido.
create table if not exists cuenta_posiciones (
  cuenta_id uuid not null references cuentas_mt5(id) on delete cascade,
  ticket bigint not null,
  symbol text not null,
  tipo text not null,
  volumen numeric not null,
  precio_apertura numeric,
  sl numeric,
  tp numeric,
  profit numeric,
  actualizado_en timestamptz not null default now(),
  primary key (cuenta_id, ticket)
);
alter table cuenta_posiciones enable row level security;

drop policy if exists "select propio o admin" on cuenta_posiciones;
create policy "select propio o admin" on cuenta_posiciones for select
  using (
    exists (
      select 1 from cuentas_mt5 c
      where c.id = cuenta_posiciones.cuenta_id
        and (c.user_id = auth.uid() or auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com')
    )
  );

-- Igual que cuenta_posiciones pero para órdenes PENDIENTES (mt5.orders_get(),
-- distinto de las posiciones ya abiertas).
create table if not exists cuenta_ordenes (
  cuenta_id uuid not null references cuentas_mt5(id) on delete cascade,
  ticket bigint not null,
  symbol text not null,
  tipo text not null,
  volumen numeric not null,
  precio numeric,
  sl numeric,
  tp numeric,
  actualizado_en timestamptz not null default now(),
  primary key (cuenta_id, ticket)
);
alter table cuenta_ordenes enable row level security;

drop policy if exists "select propio o admin" on cuenta_ordenes;
create policy "select propio o admin" on cuenta_ordenes for select
  using (
    exists (
      select 1 from cuentas_mt5 c
      where c.id = cuenta_ordenes.cuenta_id
        and (c.user_id = auth.uid() or auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com')
    )
  );
