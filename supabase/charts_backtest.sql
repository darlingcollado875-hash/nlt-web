-- NLT Backtest Lab (NLT Charts) -- presets de estrategia y registro de backtests.
-- SIN APLICAR en producción. Probar primero en staging (NLT_API/scripts/staging_charts).
--
-- Un preset guarda SOLO configuración (estrategia + ejecución), nunca velas.
-- Un run guarda la metadata para auditoría/reproducibilidad (versión del motor y de la
-- estrategia, fuente de datos, zona horaria, parámetros, hash del dataset) y el resumen.
-- Acceso: el backend usa service_role; RLS deja a cada usuario leer solo lo suyo.

create table if not exists public.charts_backtest_presets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  strategy    jsonb not null default '{}'::jsonb,
  execution   jsonb not null default '{}'::jsonb,
  version     text not null default '1',
  shared      boolean not null default false,         -- preparado para compartir (sin marketplace todavía)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, name)
);
create index if not exists charts_backtest_presets_user_idx on public.charts_backtest_presets (user_id, updated_at desc);

alter table public.charts_backtest_presets enable row level security;
drop policy if exists "presets propios (lectura)" on public.charts_backtest_presets;
create policy "presets propios (lectura)" on public.charts_backtest_presets
  for select using (auth.uid() = user_id);

create table if not exists public.charts_backtest_runs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  run_key           text not null,                     -- hash reproducible (símbolo, tf, rango, config, fuente, versión)
  symbol            text not null,
  timeframe         text not null,
  range_start       timestamptz not null,
  range_end         timestamptz not null,
  engine_version    text not null,
  strategy_version  text not null,
  data_source       text not null,                     -- ej. tickerall:primary
  data_source_changes jsonb not null default '[]'::jsonb,
  timezone          jsonb not null,                    -- {timestamps, broker_server_rule, sessions}
  parameters        jsonb not null,                    -- estrategia + ejecución
  dataset_hash      text not null,
  dataset           jsonb not null,                    -- velas, warm-up, primera/última, huecos
  metrics           jsonb,
  status            text not null check (status in ('done','error','cancelled')),
  created_at        timestamptz not null default now()
);
create index if not exists charts_backtest_runs_user_idx on public.charts_backtest_runs (user_id, created_at desc);
create index if not exists charts_backtest_runs_key_idx on public.charts_backtest_runs (run_key);

alter table public.charts_backtest_runs enable row level security;
drop policy if exists "runs propios (lectura)" on public.charts_backtest_runs;
create policy "runs propios (lectura)" on public.charts_backtest_runs
  for select using (auth.uid() = user_id);
