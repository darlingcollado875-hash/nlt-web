-- ══════════════════════════════════════════════════════════════════
-- NLT Charts — alertas de precio 24/7 (corren en el servidor, con el gráfico cerrado).
--
-- Una fila por alerta. El backend (app/services/chart_alerts.py) revisa cada ~20 s los
-- símbolos con alertas activas y avisa por Web Push cuando se cumple la condición.
-- Son avisos, no permisos ni órdenes: jamás ejecutan operaciones.
--
-- ADITIVO. RLS activa sin policies de cliente: solo el backend (service_role).
-- Reversible:  drop table if exists public.chart_alerts;
-- ══════════════════════════════════════════════════════════════════
create table if not exists public.chart_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  condition text not null check (condition in ('cross','cross_up','cross_down','gt','lt')),
  level numeric not null,
  trigger text not null default 'once' check (trigger in ('once','every_time')),
  note text,
  active boolean not null default true,
  last_price numeric,
  last_checked_ms bigint,
  triggered_count integer not null default 0,
  last_triggered_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists chart_alerts_user_idx on public.chart_alerts (user_id, created_at desc);
create index if not exists chart_alerts_activas_idx on public.chart_alerts (symbol) where active;
alter table public.chart_alerts enable row level security;
