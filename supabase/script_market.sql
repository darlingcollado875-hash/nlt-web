-- ══════════════════════════════════════════════════════════════════
-- NLT Script — tienda y accesos privados. ADITIVO. RLS activa sin policies de cliente (solo el backend).
-- Reversible: drop table if exists public.script_grants; alter table public.user_scripts drop column if exists description;
-- ══════════════════════════════════════════════════════════════════
alter table public.user_scripts add column if not exists description text check (description is null or char_length(description) <= 500);
create table if not exists public.script_grants (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references public.user_scripts(id) on delete cascade,
  grantee_user_id uuid not null references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (script_id, grantee_user_id)
);
create index if not exists script_grants_grantee_idx on public.script_grants (grantee_user_id);
create index if not exists user_scripts_listed_idx on public.user_scripts (updated_at desc) where visibility = 'listed';
alter table public.script_grants enable row level security;
