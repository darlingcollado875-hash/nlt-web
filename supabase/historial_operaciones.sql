-- Ejecutar en Supabase > SQL Editor.
-- Tabla real de historial de operaciones copiadas (hoy historial.html estaba vacío
-- porque no existía). El motor la escribe con la service_role key (nunca necesita
-- policy de insert/update para el usuario); el usuario solo la LEE.
create table if not exists historial_operaciones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cuenta_id uuid references cuentas_mt5(id) on delete set null,
  login_numero bigint not null,
  ticket bigint not null,
  ticket_maestra bigint,
  symbol text not null,
  tipo text not null check (tipo in ('BUY','SELL')),
  volumen numeric not null,
  precio_apertura numeric,
  sl numeric,
  tp numeric,
  estado text not null default 'ABIERTA' check (estado in ('ABIERTA','CERRADA')),
  profit numeric,
  fecha_apertura timestamptz not null default now(),
  fecha_cierre timestamptz
);

alter table historial_operaciones enable row level security;

drop policy if exists "select propio o admin" on historial_operaciones;
create policy "select propio o admin" on historial_operaciones for select
  using (auth.uid() = user_id or auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com');
