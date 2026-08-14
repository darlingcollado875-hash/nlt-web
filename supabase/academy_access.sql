-- Ejecutar en Supabase > SQL Editor.
-- Academy Access: tabla propia con expiración/nivel/tipo de acceso
-- gestionable desde Admin Center -- reemplaza a "derivar todo de
-- subscriptions_v2" (services/academy_access.py::tiene_acceso_academy),
-- que no soportaba acceso permanente, acceso manual con fecha, ni niveles
-- (BASIC/PRO/VIP), ni registrar el último acceso real.
--
-- Una fila vigente por usuario (user_id unique) -- se actualiza in-place
-- en vez de acumular historial, igual que subscriptions_v2.

create extension if not exists pgcrypto;

create table if not exists academy_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  nivel text not null default 'BASIC' check (nivel in ('BASIC', 'PRO', 'VIP')),
  tipo_acceso text not null default 'manual' check (tipo_acceso in ('subscription', 'manual', 'purchase')),
  fecha_inicio timestamptz not null default now(),
  fecha_expiracion timestamptz,  -- null = acceso permanente
  estado text not null default 'ACTIVE' check (estado in ('ACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED')),
  origen_orden_id uuid,  -- referencia informativa a orders.id (producto=academy) -- sin FK, no siempre viene de una orden
  ultimo_acceso timestamptz,
  creado_por text,   -- email del admin si fue manual, 'system' si vino de una orden pagada
  notas_admin text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table academy_access enable row level security;
create index if not exists idx_academy_access_estado on academy_access(estado);

create or replace function set_actualizado_en_academy_access()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_academy_access_updated_at on academy_access;
create trigger trg_academy_access_updated_at
  before update on academy_access
  for each row execute function set_actualizado_en_academy_access();
