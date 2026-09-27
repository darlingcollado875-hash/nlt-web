-- ══════════════════════════════════════════════════════════════════
-- NLT Charts — acceso PRO: trials del Zone Engine y análisis gratis de
-- Indicator AI.
--
-- ESTADO: NO APLICADA. Rama nlt-charts, pendiente de aprobación (F9).
--
-- Por qué hacen falta estas piezas y no alcanza con lo existente:
--   * El acceso por PLAN se resuelve con lo que ya existe (indicator_orders
--     status='active' + plan_id, ver app/services/charts/pro/access.py). No
--     se crea un segundo sistema de membresías.
--   * No existe ninguna tabla que guarde trials. `indicator_trials` es lo
--     mínimo: una fila por usuario e indicador, con UNIQUE para que el trial
--     sea único aunque lleguen pedidos en paralelo.
--   * Para los análisis gratis de Indicator AI se REUTILIZA
--     nlt_ai.usage_counters (ya en producción), con period_kind='all' como
--     contador de por vida. Solo se agrega una función que incrementa de
--     forma atómica sin pasarse del máximo.
--
-- Todo ADITIVO. RLS activa sin policies de cliente: solo el backend
-- (service_role) lee y escribe, igual que subscriptions_v2 e indicator_orders.
-- Cupo de análisis gratis de NLT AI: UNA sola fuente de verdad (period_kind='all').
-- Se RESERVA 1 antes de mandar el evento (consumir) y se DEVUELVE si al final
-- no hubo análisis con IA (zona ya analizada, sin IA, error). Así un evento
-- analizado = un débito; los usuarios con plan usan solo la cuota mensual del
-- pipeline (period_kind='month'), nunca este contador.
-- Reversible:
--   drop function if exists public.charts_devolver_analisis_ai_gratis(uuid);
--   drop function if exists public.charts_consumir_analisis_ai_gratis(uuid, integer);
--   drop table if exists public.indicator_trials;
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.indicator_trials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  indicator_id text not null,
  trial_started_at timestamptz not null default now(),
  trial_expires_at timestamptz not null,
  -- Guardado para auditoría. El estado REAL lo calcula el backend con la
  -- hora del servidor (ACTIVE hasta trial_expires_at, después EXPIRED);
  -- SUBSCRIBED sale de indicator_orders, no de esta tabla.
  trial_status text not null default 'ACTIVE' check (trial_status in ('ACTIVE', 'EXPIRED')),
  created_at timestamptz not null default now(),
  constraint indicator_trials_unico unique (user_id, indicator_id),
  constraint indicator_trials_fechas check (trial_expires_at > trial_started_at)
);

create index if not exists indicator_trials_user_idx on public.indicator_trials (user_id);

alter table public.indicator_trials enable row level security;
alter table public.indicator_trials force row level security;
revoke all on public.indicator_trials from anon, authenticated;

-- Consume 1 análisis gratis de Indicator AI si quedan. Devuelve cuántos
-- quedan después (>= 0), o -1 si ya no quedaba ninguno (no consume nada).
-- El UPDATE ... WHERE analyses_used < p_max es atómico: dos pedidos en
-- paralelo nunca consumen más que el máximo.
create or replace function public.charts_consumir_analisis_ai_gratis(p_user uuid, p_max integer)
returns integer
language plpgsql
security definer
set search_path = public, nlt_ai
as $$
declare
  v_usados integer;
begin
  if p_max is null or p_max <= 0 then
    return -1;
  end if;
  insert into nlt_ai.usage_counters (nlt_user_id, period_kind, period_start, analyses_used)
  values (p_user, 'all', date '1970-01-01', 0)
  on conflict (nlt_user_id, period_kind, period_start) do nothing;

  update nlt_ai.usage_counters
     set analyses_used = analyses_used + 1
   where nlt_user_id = p_user and period_kind = 'all' and period_start = date '1970-01-01'
     and analyses_used < p_max
  returning analyses_used into v_usados;

  if v_usados is null then
    return -1;
  end if;
  return p_max - v_usados;
end;
$$;

revoke all on function public.charts_consumir_analisis_ai_gratis(uuid, integer) from public, anon, authenticated;
grant execute on function public.charts_consumir_analisis_ai_gratis(uuid, integer) to service_role;

-- Devuelve 1 análisis reservado que no llegó a usarse (nunca baja de 0).
-- Devuelve cuántos quedan usados después.
create or replace function public.charts_devolver_analisis_ai_gratis(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public, nlt_ai
as $$
declare
  v_usados integer;
begin
  update nlt_ai.usage_counters
     set analyses_used = analyses_used - 1
   where nlt_user_id = p_user and period_kind = 'all' and period_start = date '1970-01-01'
     and analyses_used > 0
  returning analyses_used into v_usados;
  return coalesce(v_usados, 0);
end;
$$;

revoke all on function public.charts_devolver_analisis_ai_gratis(uuid) from public, anon, authenticated;
grant execute on function public.charts_devolver_analisis_ai_gratis(uuid) to service_role;

-- Solo lectura: cuántos análisis gratis usó (para mostrar "te quedan N").
create or replace function public.charts_analisis_ai_gratis_usados(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public, nlt_ai
as $$
  select coalesce((select analyses_used from nlt_ai.usage_counters
                    where nlt_user_id = p_user and period_kind = 'all' and period_start = date '1970-01-01'), 0);
$$;

revoke all on function public.charts_analisis_ai_gratis_usados(uuid) from public, anon, authenticated;
grant execute on function public.charts_analisis_ai_gratis_usados(uuid) to service_role;
