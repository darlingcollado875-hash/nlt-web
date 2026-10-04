-- Ejecutar en Supabase > SQL Editor.
-- Coordina Desk: espacio interno de coordinación administrativa (solo admins).
-- Una sola tabla genérica de documentos JSON identificados por (collection, id);
-- las colecciones válidas las fija la allowlist de NLT_API
-- (app/services/coordina.py::COLECCIONES): team, items, affiliates, meetings,
-- contracts, payments, publications, launches, devChanges, academyClasses, reports.
--
-- RLS: mismo patrón deny-por-defecto que el resto de tablas de negocio (ver
-- admin_permissions.sql, community_chat.sql): RLS habilitada y CERO políticas
-- para anon/authenticated. Todo el acceso real pasa por NLT_API (service_role),
-- que exige requiere_permiso("coordina") -- Global Admin o admin secundario con
-- el módulo "coordina" habilitado. Nunca se accede desde el navegador directo.

create table if not exists coordina_records (
  collection text not null,
  id text not null,
  data jsonb not null default '{}',
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (collection, id)
);

alter table coordina_records enable row level security;
-- sin policies => deny total para anon/authenticated.

create index if not exists idx_coordina_records_activos on coordina_records(collection, created_at) where deleted_at is null;
