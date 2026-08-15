-- Ejecutar en Supabase > SQL Editor.
-- Perfiles sociales de Comunidad: follow/unfollow entre usuarios + insignia
-- de verificado. Extiende community_profiles (creada a mano en el editor de
-- Supabase -- no hay un community.sql versionado en el repo, ver nota abajo)
-- sin duplicar ninguna estructura existente.
--
-- Mismo patrón deny-por-defecto que el resto de tablas de negocio: RLS
-- habilitada sin policies, todo el acceso real pasa por NLT_API
-- (service_role). Followers/following se calculan con count='exact' al leer
-- (NLT_API/app/services/repository.py), no con columnas denormalizadas --
-- evita el problema de reparación que ya existe con community_posts.likes_count.

create extension if not exists pgcrypto;

-- ============================================================
-- community_follows -- relación de follow entre usuarios.
-- check(follower <> followed) y unique(follower, followed): auto-follow y
-- duplicados se rechazan a nivel de base, no solo en el backend.
-- ============================================================
create table if not exists community_follows (
  id uuid primary key default gen_random_uuid(),
  follower_user_id uuid not null references auth.users(id) on delete cascade,
  followed_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (follower_user_id <> followed_user_id),
  unique (follower_user_id, followed_user_id)
);
create index if not exists idx_community_follows_follower on community_follows(follower_user_id);
create index if not exists idx_community_follows_followed on community_follows(followed_user_id);
alter table community_follows enable row level security;

-- ============================================================
-- Insignia de verificado -- exclusiva del Global Admin (ver
-- NLT_API/app/services/community_access.py::set_verificado_comunidad, único
-- método que escribe esta columna). default false: no afecta ningún perfil
-- existente.
-- ============================================================
alter table community_profiles add column if not exists verified boolean not null default false;
