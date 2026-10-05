-- Baja de correos de anuncios (Admin Center → Notificaciones). Solo afecta a los anuncios masivos.
-- ADITIVO. RLS activa sin policies de cliente (solo el backend). Reversible: drop table if exists public.email_optouts;
create table if not exists public.email_optouts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.email_optouts enable row level security;
