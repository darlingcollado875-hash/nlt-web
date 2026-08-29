-- ══════════════════════════════════════════════════════════════════
-- NLT AI V1 — user scoping + TradingView connection + entitlements/quota
-- Aplicada a Supabase wjczkcuxptzpayzemttb como migración
-- `nlt_ai_v1_user_scoping_entitlements`.
--
-- Todo ADITIVO y dentro de `nlt_ai`. Cero cambios en `public`.
-- `nlt_user_id` es una referencia BLANDA a auth.users.id (sin FK).
-- Reversible: DROP SCHEMA nlt_ai CASCADE;
-- ══════════════════════════════════════════════════════════════════

alter table nlt_ai.signals      add column if not exists nlt_user_id uuid;
alter table nlt_ai.ai_analysis  add column if not exists nlt_user_id uuid;
create index if not exists ai_analysis_user_idx on nlt_ai.ai_analysis (nlt_user_id, created_at desc);
create index if not exists signals_user_idx     on nlt_ai.signals (nlt_user_id);

create table if not exists nlt_ai.tv_connections (
  id uuid primary key default gen_random_uuid(),
  nlt_user_id uuid not null unique,
  tv_username text,
  webhook_token text not null unique,
  webhook_secret text,
  active boolean not null default true,
  connected_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tv_connections_token_idx on nlt_ai.tv_connections (webhook_token) where active;
create trigger trg_tv_connections_updated_at before update on nlt_ai.tv_connections
  for each row execute function nlt_ai.set_updated_at();

create table if not exists nlt_ai.usage_counters (
  id uuid primary key default gen_random_uuid(),
  nlt_user_id uuid not null,
  period_kind text not null default 'month' check (period_kind in ('month','week','day','all')),
  period_start date not null,
  analyses_used integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (nlt_user_id, period_kind, period_start)
);
create index if not exists usage_counters_user_idx on nlt_ai.usage_counters (nlt_user_id);
create trigger trg_usage_counters_updated_at before update on nlt_ai.usage_counters
  for each row execute function nlt_ai.set_updated_at();

create table if not exists nlt_ai.plan_entitlements (
  plan_id text primary key,
  indicator_access boolean not null default true,
  ai_access boolean not null default false,
  monthly_quota integer,        -- NULL = ilimitado / sin fijar
  history_days integer,         -- NULL = ilimitado
  statistics_access boolean not null default false,
  advanced_features boolean not null default false,
  source text not null default 'seed',
  updated_at timestamptz not null default now()
);
create trigger trg_plan_entitlements_updated_at before update on nlt_ai.plan_entitlements
  for each row execute function nlt_ai.set_updated_at();

create table if not exists nlt_ai.entitlement_overrides (
  nlt_user_id uuid primary key,
  ai_access boolean,
  monthly_quota integer,
  history_days integer,
  statistics_access boolean,
  note text,
  set_by text,
  updated_at timestamptz not null default now()
);
create trigger trg_entitlement_overrides_updated_at before update on nlt_ai.entitlement_overrides
  for each row execute function nlt_ai.set_updated_at();

create table if not exists nlt_ai.user_entitlement_mirror (
  nlt_user_id uuid primary key,
  indicator_access boolean not null default false,
  ai_access boolean not null default false,
  plan_id text,
  monthly_quota integer,
  history_days integer,
  statistics_access boolean not null default false,
  synced_at timestamptz not null default now()
);

alter table nlt_ai.tv_connections          enable row level security;
alter table nlt_ai.usage_counters          enable row level security;
alter table nlt_ai.plan_entitlements       enable row level security;
alter table nlt_ai.entitlement_overrides   enable row level security;
alter table nlt_ai.user_entitlement_mirror enable row level security;
alter table nlt_ai.tv_connections          force row level security;
alter table nlt_ai.usage_counters          force row level security;
alter table nlt_ai.plan_entitlements       force row level security;
alter table nlt_ai.entitlement_overrides   force row level security;
alter table nlt_ai.user_entitlement_mirror force row level security;
revoke all on all tables in schema nlt_ai from anon, authenticated;
