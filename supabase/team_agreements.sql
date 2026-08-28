-- NLT -- Equipo + Roles + Permisos + Acuerdos + Firma Electrónica + Auditoría.
-- 100% aditivo -- no toca ninguna tabla existente. Dominio DISTINTO de
-- admin_permissions.sql (ese es "qué panel /admin/* puede administrar un
-- admin secundario"; este es "qué puede hacer un miembro del equipo con
-- Equipo/Acuerdos/Firma") -- se mantienen paralelos a propósito, no se
-- fusionan (evita mezclar dos conceptos de autorización distintos).
--
-- Reutiliza admin_audit_log (ya existente, ver audit_log.sql/repository.py::
-- registrar_auditoria) para TODOS los eventos de este módulo -- cero tabla
-- de auditoría nueva.
--
-- Mismo patrón de seguridad que el resto del proyecto: RLS habilitada sin
-- policies (deny-by-default), todo el acceso real pasa por NLT_API
-- (service_role). El Global Admin (ADMIN_EMAIL, ver config.py) NUNCA
-- depende de una fila de team_members para su propia autorización -- ver
-- app/services/team_access.py::resolver_rol_equipo, mismo principio que
-- admin_permissions.sql ya documenta para el Global Admin.

create extension if not exists pgcrypto;

create or replace function set_actualizado_en_generico()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- 1) Equipo -----------------------------------------------------------------
-- email/user_id nullable a propósito: un miembro puede existir en el roster
-- (nombre + cargo + slot de firma, ver ANEXO A del Acuerdo Marco) ANTES de
-- tener cuenta/email cargado -- el Super Admin completa el email real más
-- tarde desde la UI para recién ahí poder invitar. team_role NUNCA acepta
-- 'SUPER_ADMIN' como valor almacenable (ver check constraint) -- esa
-- identidad se resuelve SIEMPRE por email == ADMIN_EMAIL en tiempo de
-- request, nunca por una fila acá (mismo principio que admin_permissions).
create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  email text,
  full_name text not null,
  display_title text,               -- ej. "Cofundador / Editor y Supervisor de Página" (ANEXO A, cargo de exhibición)
  team_role text not null default 'MEMBER'
    check (team_role in ('MEMBER','EDITOR','PROGRAMMER','MARKETING','COMMUNITY_MANAGER','CUSTOM')),
  permissions jsonb not null default '{}',  -- claves = TEAM_PERMISSIONS canónicos (team_access.py), filtradas antes de persistir
  activo boolean not null default true,
  invited_by text,
  invited_at timestamptz,
  joined_at timestamptz,            -- se setea cuando user_id se vincula por primera vez (invite aceptado)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_team_members_email on team_members (email) where email is not null;
alter table team_members enable row level security;

drop trigger if exists trg_team_members_updated_at on team_members;
create trigger trg_team_members_updated_at
  before update on team_members
  for each row execute function set_actualizado_en_generico();

-- 2) Acuerdos (familia de documento) ------------------------------------------
create table if not exists agreements (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  created_at timestamptz not null default now()
);
alter table agreements enable row level security;

-- 3) Versiones ---------------------------------------------------------------
-- Una vez 'published' queda inmutable a nivel de aplicación (ver
-- agreements.py::actualizar_version -- rechaza editar si status != 'draft').
-- content_hash = SHA-256 del PDF en el momento de subirlo -- integridad real,
-- nunca confiado solo por nombre de archivo.
create table if not exists agreement_versions (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references agreements(id) on delete cascade,
  version text not null,
  title text not null,
  storage_key text not null,
  content_hash text not null,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  published_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  unique (agreement_id, version)
);
alter table agreement_versions enable row level security;

-- 4) Asignaciones (estado por miembro para una versión) -----------------------
create table if not exists agreement_assignments (
  id uuid primary key default gen_random_uuid(),
  agreement_version_id uuid not null references agreement_versions(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete cascade,
  status text not null default 'PENDIENTE'
    check (status in ('PENDIENTE','VISTO','FIRMADO','REQUIERE_NUEVA_FIRMA')),
  viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agreement_version_id, team_member_id)
);
alter table agreement_assignments enable row level security;

drop trigger if exists trg_agreement_assignments_updated_at on agreement_assignments;
create trigger trg_agreement_assignments_updated_at
  before update on agreement_assignments
  for each row execute function set_actualizado_en_generico();

-- 5) Firmas -- INMUTABLES a propósito (Fase 8: "el registro de una firma NO
-- debe poder editarse"). Nunca se expone un endpoint de edición/borrado en
-- la app, y ADEMÁS se bloquea a nivel de base (defensa en profundidad real,
-- no solo por convención de la aplicación): ningún UPDATE ni DELETE, ni
-- siquiera con service_role, puede tocar una fila ya insertada.
create table if not exists agreement_signatures (
  id uuid primary key default gen_random_uuid(),
  agreement_version_id uuid not null references agreement_versions(id) on delete restrict,
  team_member_id uuid not null references team_members(id) on delete restrict,
  user_id uuid references auth.users(id),
  full_name text not null,
  email text,
  accepted_at timestamptz not null,
  signed_at timestamptz not null default now(),
  ip text,
  user_agent text,
  signature_id text not null unique default (gen_random_uuid()::text),
  document_hash text not null,   -- debe coincidir con agreement_versions.content_hash de ESA versión exacta al momento de firmar
  documento_identidad text,      -- opcional -- preparado para cuando corresponda legalmente (Fase 8), no requerido en v1.0
  created_at timestamptz not null default now(),
  unique (agreement_version_id, team_member_id)
);
alter table agreement_signatures enable row level security;

create or replace function bloquear_modificacion_firma()
returns trigger as $$
begin
  raise exception 'agreement_signatures es inmutable -- no se permite UPDATE ni DELETE sobre una firma ya registrada.';
end;
$$ language plpgsql;

drop trigger if exists trg_agreement_signatures_inmutable_update on agreement_signatures;
create trigger trg_agreement_signatures_inmutable_update
  before update on agreement_signatures
  for each row execute function bloquear_modificacion_firma();

drop trigger if exists trg_agreement_signatures_inmutable_delete on agreement_signatures;
create trigger trg_agreement_signatures_inmutable_delete
  before delete on agreement_signatures
  for each row execute function bloquear_modificacion_firma();

create index if not exists idx_agreement_assignments_version on agreement_assignments (agreement_version_id);
create index if not exists idx_agreement_assignments_member on agreement_assignments (team_member_id);
create index if not exists idx_agreement_signatures_version on agreement_signatures (agreement_version_id);
