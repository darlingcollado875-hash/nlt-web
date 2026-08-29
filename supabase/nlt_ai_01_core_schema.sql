-- ══════════════════════════════════════════════════════════════════
-- NLT AI ZONE INTELLIGENCE ENGINE — CORE SCHEMA (V1)
-- Aplicada a Supabase wjczkcuxptzpayzemttb como migración `nlt_ai_core_schema`.
-- Aislamiento total: schema dedicado `nlt_ai`, cero FKs a `public`,
-- RLS forzado y SIN políticas -> solo BYPASSRLS (backend) accede.
-- Reversible: DROP SCHEMA nlt_ai CASCADE;
-- ══════════════════════════════════════════════════════════════════

create schema if not exists nlt_ai;
comment on schema nlt_ai is 'NLT AI Zone Intelligence Engine. Aislado de NLT Web. Backend FastAPI vía conexion Postgres directa.';

create or replace function nlt_ai.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

-- ai_analysis es append-only: reanalizar la misma zona = nuevo analysis_id.
create or replace function nlt_ai.guard_ai_analysis_immutable()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'DELETE') then
    raise exception 'nlt_ai.ai_analysis es append-only: no se permite DELETE (id=%)', old.id;
  end if;
  if (tg_op = 'UPDATE') then
    if old.status in ('complete','ai_invalid','failed') then
      raise exception 'nlt_ai.ai_analysis id=% en estado terminal (%): snapshot inmutable, crea un nuevo analysis_id', old.id, old.status;
    end if;
  end if;
  return new;
end; $$;

create table nlt_ai.model_versions (
  id uuid primary key default gen_random_uuid(),
  component text not null check (component in ('fusion_weights','probability_engine','classifier')),
  version text not null,
  config jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  unique (component, version)
);

create table nlt_ai.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'system',
  version text not null,
  body text not null,
  model_hint text,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (name, version)
);

create table nlt_ai.zones (
  id uuid primary key default gen_random_uuid(),
  zone_key text not null unique,
  symbol text not null,
  venue text,
  timeframe text not null,
  direction text not null check (direction in ('LONG','SHORT')),
  kind text not null check (kind in ('OB','FVG','MANUAL','BREAKER','MITIGATION','OTHER')),
  is_manual boolean not null default false,
  zone_top numeric not null,
  zone_bot numeric not null,
  zone_mid numeric generated always as ((zone_top + zone_bot) / 2.0) stored,
  created_bar_time timestamptz,
  indicator_version text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  analysis_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);
create index zones_symbol_tf_idx on nlt_ai.zones (symbol, timeframe);
create index zones_last_seen_idx on nlt_ai.zones (last_seen_at desc);

create table nlt_ai.signals (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid references nlt_ai.zones(id),
  idempotency_key text unique,
  schema_version text,
  indicator_version text,
  event text,
  symbol text,
  timeframe text,
  mode text,
  source_ip text,
  raw_payload jsonb not null,
  normalized jsonb,
  status text not null default 'received'
    check (status in ('received','normalized','context_built','scored','analyzed','complete','failed','skipped','duplicate')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index signals_zone_idx on nlt_ai.signals (zone_id);
create index signals_status_idx on nlt_ai.signals (status);
create index signals_received_idx on nlt_ai.signals (received_at desc);
create index signals_symbol_idx on nlt_ai.signals (symbol);

create table nlt_ai.market_context (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references nlt_ai.signals(id),
  zone_id uuid references nlt_ai.zones(id),
  builder_version text not null,
  context jsonb not null,
  providers jsonb not null default '{}'::jsonb,
  data_gaps text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index market_context_signal_idx on nlt_ai.market_context (signal_id);

create table nlt_ai.quant_scores (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references nlt_ai.signals(id),
  context_id uuid references nlt_ai.market_context(id),
  engine_version text not null,
  structure_score numeric, liquidity_score numeric, location_score numeric,
  momentum_score numeric, confluence_score numeric, historical_score numeric,
  historical_status text not null default 'ok' check (historical_status in ('ok','data_insufficient')),
  nlt_quant_score numeric,
  components jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index quant_scores_signal_idx on nlt_ai.quant_scores (signal_id);

create table nlt_ai.ai_analysis (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references nlt_ai.zones(id),
  signal_id uuid not null references nlt_ai.signals(id),
  context_id uuid references nlt_ai.market_context(id),
  quant_id uuid references nlt_ai.quant_scores(id),
  status text not null default 'pending' check (status in ('pending','complete','ai_invalid','failed','skipped')),
  symbol text, timeframe text,
  model text, prompt_version text, probability_engine_version text,
  fusion_version text, classifier_version text,
  ai_called boolean not null default false,
  ai_raw jsonb, ai_repair_used boolean not null default false, ai_error text,
  tokens_in integer, tokens_out integer, cost_usd_est numeric,
  direction text, bias text, setup_valid boolean,
  quality text, category text, risk_level text, rr_quality text, verdict text,
  v13_score numeric, nlt_quant_score numeric, claude_ai_score numeric, final_ai_score numeric,
  scores jsonb not null default '{}'::jsonb,
  score_provenance jsonb not null default '{}'::jsonb,
  confluences text[] not null default '{}',
  warnings text[] not null default '{}',
  confirmation_required text[] not null default '{}',
  invalidation text[] not null default '{}',
  data_gaps text[] not null default '{}',
  explanation text,
  snapshot jsonb not null default '{}'::jsonb,
  analysis_ts timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index ai_analysis_zone_idx on nlt_ai.ai_analysis (zone_id);
create index ai_analysis_signal_idx on nlt_ai.ai_analysis (signal_id);
create index ai_analysis_status_idx on nlt_ai.ai_analysis (status);
create index ai_analysis_created_idx on nlt_ai.ai_analysis (created_at desc);
create index ai_analysis_symbol_idx on nlt_ai.ai_analysis (symbol);
create trigger trg_ai_analysis_immutable
  before update or delete on nlt_ai.ai_analysis
  for each row execute function nlt_ai.guard_ai_analysis_immutable();

create table nlt_ai.trade_outcomes (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null unique references nlt_ai.ai_analysis(id),
  zone_id uuid references nlt_ai.zones(id),
  entry numeric, stop_loss numeric, take_profit numeric, r_target numeric,
  result text not null default 'pending' check (result in ('win','loss','breakeven','timeout','cancelled','pending')),
  r_multiple numeric, mfe numeric, mae numeric, time_to_outcome_sec bigint,
  resolved_by text check (resolved_by in ('manual','market_data_provider','nlt_web_readonly')),
  resolved_at timestamptz, notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trade_outcomes_result_idx on nlt_ai.trade_outcomes (result);
create trigger trg_trade_outcomes_updated_at
  before update on nlt_ai.trade_outcomes
  for each row execute function nlt_ai.set_updated_at();

create table nlt_ai.system_logs (
  id bigint generated always as identity primary key,
  signal_id uuid, analysis_id uuid,
  level text not null default 'info' check (level in ('debug','info','warn','error')),
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index system_logs_signal_idx on nlt_ai.system_logs (signal_id);
create index system_logs_created_idx on nlt_ai.system_logs (created_at desc);

-- RLS forzado, sin políticas.
alter table nlt_ai.model_versions  enable row level security;
alter table nlt_ai.prompt_versions enable row level security;
alter table nlt_ai.zones           enable row level security;
alter table nlt_ai.signals         enable row level security;
alter table nlt_ai.market_context  enable row level security;
alter table nlt_ai.quant_scores    enable row level security;
alter table nlt_ai.ai_analysis     enable row level security;
alter table nlt_ai.trade_outcomes  enable row level security;
alter table nlt_ai.system_logs     enable row level security;
alter table nlt_ai.model_versions  force row level security;
alter table nlt_ai.prompt_versions force row level security;
alter table nlt_ai.zones           force row level security;
alter table nlt_ai.signals         force row level security;
alter table nlt_ai.market_context  force row level security;
alter table nlt_ai.quant_scores    force row level security;
alter table nlt_ai.ai_analysis     force row level security;
alter table nlt_ai.trade_outcomes  force row level security;
alter table nlt_ai.system_logs     force row level security;

revoke all on all tables in schema nlt_ai from anon, authenticated;
revoke all on schema nlt_ai from anon, authenticated;
