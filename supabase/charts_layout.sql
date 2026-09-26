-- ══════════════════════════════════════════════════════════════════
-- NLT Charts — preferencias del gráfico guardadas en la cuenta.
--
-- ESTADO: NO APLICADA. Rama nlt-charts, pendiente de aprobación.
--
-- Una fila por usuario con el "layout" del gráfico: símbolo, temporalidad,
-- indicadores y su configuración, colores de velas, dibujos por símbolo,
-- watchlist/favoritos y estado de los paneles. Así se ve igual en otro
-- dispositivo. El navegador lo sigue guardando también en localStorage
-- (caché y respaldo si esta tabla todavía no existe).
--
-- Son PREFERENCIAS DE DIBUJO, nunca permisos: el acceso PRO lo decide el
-- backend con indicator_orders / indicator_trials, jamás con este JSON.
--
-- ADITIVO. RLS activa sin policies de cliente: solo el backend
-- (service_role) lee y escribe, igual que indicator_trials.
-- Reversible:
--   drop table if exists public.charts_layouts;
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.charts_layouts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  layout jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  -- el backend ya rechaza cuerpos de más de 1 MB; esto es la red de la base
  constraint charts_layouts_tamano check (pg_column_size(layout) <= 2000000),
  constraint charts_layouts_objeto check (jsonb_typeof(layout) = 'object')
);

alter table public.charts_layouts enable row level security;
alter table public.charts_layouts force row level security;
revoke all on public.charts_layouts from anon, authenticated;
