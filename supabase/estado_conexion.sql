-- Ejecutar en Supabase > SQL Editor.
-- Soporta el heartbeat del motor: cuándo se confirmó por última vez el
-- estado real de cada cuenta, y si el motor completo sigue vivo.

alter table cuentas_mt5 add column if not exists ultimo_heartbeat timestamptz;

create table if not exists motor_status (
  id int primary key default 1,
  ultimo_ciclo timestamptz,
  ciclo_numero bigint,
  constraint solo_una_fila check (id = 1)
);
alter table motor_status enable row level security;

drop policy if exists "select publico" on motor_status;
create policy "select publico" on motor_status for select
  using (true);
-- Solo el motor (service_role, que ignora RLS) escribe en motor_status;
-- cualquier usuario logueado puede leerlo para saber si el motor está vivo.
