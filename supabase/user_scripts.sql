-- ══════════════════════════════════════════════════════════════════
-- NLT Script — scripts (indicadores) que cada usuario escribe en NLT Charts. Requiere el plan NLT Charts Trader (o ser admin).
-- El servidor SOLO guarda el texto: nunca lo ejecuta. Corre en el navegador del dueño dentro de un Web Worker con el intérprete de
-- NLT Script (sin eval, sin red). Los campos visibility / listing quedan listos para la tienda de indicadores (fase 3).
-- ADITIVO. RLS activa sin policies de cliente (solo el backend). Reversible: drop table if exists public.user_scripts;
-- ══════════════════════════════════════════════════════════════════
create table if not exists public.user_scripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  code text not null check (char_length(code) <= 100000),
  version integer not null default 1,
  visibility text not null default 'private' check (visibility in ('private','listed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
create index if not exists user_scripts_user_idx on public.user_scripts (user_id, updated_at desc);
alter table public.user_scripts enable row level security;
