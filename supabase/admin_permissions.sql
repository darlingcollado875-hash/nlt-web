-- Ejecutar en Supabase > SQL Editor.
-- Sistema jerárquico de administración: un único Global Admin (email ==
-- ADMIN_EMAIL en NLT_API/app/core/config.py, sin cambios) con control total
-- sobre admins secundarios de permisos granulares por módulo.
--
-- A propósito esta tabla NO tiene columna "role": el rol se deriva en cada
-- request (ver NLT_API/app/api/deps.py::requiere_permiso) --
-- email == ADMIN_EMAIL -> global_admin; fila aquí con activo=true -> admin;
-- si no -> user. Así ningún UPDATE sobre esta tabla puede producir jamás un
-- valor "global_admin" almacenado en ningún lado -- la identidad del Global
-- Admin nunca depende de una fila de base de datos.
--
-- El Global Admin NUNCA tiene fila acá (los endpoints de otorgar/revocar en
-- admin_global.py rechazan explícitamente apuntar a su propio user_id/email).
--
-- Mismo patrón deny-por-defecto que el resto de tablas de negocio del
-- proyecto (ver affiliates.sql, billing.sql): RLS habilitada sin policies,
-- todo el acceso real pasa por NLT_API (service_role).

create extension if not exists pgcrypto;

create or replace function set_actualizado_en_admin_permissions()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists admin_permissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  permissions jsonb not null default '{}',  -- { "community": true, "academy": true, ... } -- claves = módulos canónicos, filtradas en services/admin_permissions.py antes de persistir
  activo boolean not null default true,     -- false = revocación total preservando la config de permissions (para poder reactivar sin reconfigurar)
  granted_by text,                          -- email del Global Admin que lo otorgó
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table admin_permissions enable row level security;

drop trigger if exists trg_admin_permissions_updated_at on admin_permissions;
create trigger trg_admin_permissions_updated_at
  before update on admin_permissions
  for each row execute function set_actualizado_en_admin_permissions();
