-- Ejecutar en Supabase > SQL Editor.
-- Módulo NLT BROKER -- Broker Partner + Referral + Analytics (Eightcap
-- Partner/IB, hoy). Completamente separado de `affiliates` (programa
-- INTERNO de NLT: usuarios de NLT refiriendo a otros usuarios de NLT) --
-- acá el "referido" es un CLIENTE DE EIGHTCAP, no necesariamente un usuario
-- de NLT, y los eventos (registro/FTD/comisión) los reporta Eightcap por
-- postback, no una acción interna de NLT. Mezclar ambos esquemas sería
-- estructuralmente incorrecto (ver punto 36 del pedido: NLT User != Broker
-- Client != Broker Account != Partner Referral).
--
-- Mismo patrón de RLS que el resto del proyecto: enable row level security
-- SIN policies -- deny-by-default para anon/authenticated, todo el acceso
-- real pasa por NLT_API con la service_role key.

create table if not exists broker_providers (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,                    -- 'eightcap', futuros: 'pepperstone', 'fxcm', etc.
  nombre text not null,
  logo_url text,
  descripcion text,
  markets jsonb not null default '[]'::jsonb,      -- ej ["Forex","CFD","Indices"]
  regulation text,                                  -- texto libre, NUNCA inventar jurisdicción/licencia
  platform text,                                    -- ej "MT4/MT5"
  status text not null default 'COMING_SOON' check (status in ('COMING_SOON','ACTIVE','PAUSED','MAINTENANCE')),
  connection_enabled boolean not null default false, -- "Connect Trading Account" -- desactivado hasta Embedded real
  trading_enabled boolean not null default false,    -- terminal de trading -- desactivado hasta Embedded real
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
alter table broker_providers enable row level security;

create table if not exists broker_campaigns (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references broker_providers(id) on delete cascade,
  campaign_id text not null,
  campaign_name text,
  referral_url text not null,                       -- configurable desde admin, nunca hardcodeada en el frontend
  status text not null default 'ACTIVE' check (status in ('ACTIVE','PAUSED')),
  es_default boolean not null default false,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (broker_id, campaign_id)
);
alter table broker_campaigns enable row level security;
create index if not exists idx_broker_campaigns_broker on broker_campaigns(broker_id);

create table if not exists broker_referral_clicks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,  -- nullable: un visitante sin sesión también puede clickear
  broker_id uuid not null references broker_providers(id) on delete cascade,
  campaign_id uuid references broker_campaigns(id) on delete set null,
  utm_source text, utm_medium text, utm_campaign text, utm_content text,
  sub1 text, sub2 text, sub3 text, sub4 text, sub5 text, sub6 text, sub7 text, sub8 text,
  click_id text not null unique,                    -- generado por NLT, se intenta pasar a Eightcap como sub-id
  creado_en timestamptz not null default now()
);
alter table broker_referral_clicks enable row level security;
create index if not exists idx_broker_clicks_broker on broker_referral_clicks(broker_id);
create index if not exists idx_broker_clicks_user on broker_referral_clicks(user_id);

-- Idempotencia real de postbacks -- mismo molde que payment_webhook_events
-- (pay2commerce.sql): el unique(provider, event_id) es la garantía real,
-- no un chequeo previo con condición de carrera.
create table if not exists broker_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'eightcap',
  event_type text,
  event_id text not null,                           -- external_id, o sha256(raw payload) si Eightcap no manda uno
  external_id text,
  client_id text,
  payload jsonb not null,
  signature_valida boolean not null default true,
  procesado boolean not null default false,
  recibido_en timestamptz not null default now(),
  unique (provider, event_id)
);
alter table broker_webhook_events enable row level security;
create index if not exists idx_broker_webhook_events_client on broker_webhook_events(client_id);

create table if not exists broker_registrations (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references broker_providers(id) on delete cascade,
  webhook_event_id uuid references broker_webhook_events(id) on delete set null,
  external_id text not null,                        -- id de registro/cliente que reporta Eightcap
  client_id text,
  user_id uuid references auth.users(id) on delete set null,  -- correlacionado por click_id/sub1 cuando sea posible
  campaign_id uuid references broker_campaigns(id) on delete set null,
  utm_source text, utm_medium text, utm_campaign text, utm_content text,
  sub1 text, sub2 text, sub3 text, sub4 text, sub5 text, sub6 text, sub7 text, sub8 text,
  country text,
  status text,
  creado_en timestamptz not null default now(),
  unique (broker_id, external_id)
);
alter table broker_registrations enable row level security;
create index if not exists idx_broker_registrations_user on broker_registrations(user_id);
create index if not exists idx_broker_registrations_client on broker_registrations(client_id);

create table if not exists broker_ftds (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references broker_providers(id) on delete cascade,
  registration_id uuid references broker_registrations(id) on delete set null,
  webhook_event_id uuid references broker_webhook_events(id) on delete set null,
  external_id text not null,
  client_id text,
  amount numeric(14,2),
  currency text,
  creado_en timestamptz not null default now(),
  unique (broker_id, external_id)
);
alter table broker_ftds enable row level security;
create index if not exists idx_broker_ftds_registration on broker_ftds(registration_id);

create table if not exists broker_commissions (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references broker_providers(id) on delete cascade,
  registration_id uuid references broker_registrations(id) on delete set null,
  webhook_event_id uuid references broker_webhook_events(id) on delete set null,
  external_id text not null,                        -- transaction_id de Eightcap -- el mismo id se re-usa en Commission Updated
  client_id text,
  order_id text,
  amount numeric(14,2),
  volume numeric(14,2),
  status text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (broker_id, external_id)
);
alter table broker_commissions enable row level security;
create index if not exists idx_broker_commissions_registration on broker_commissions(registration_id);
create index if not exists idx_broker_commissions_status on broker_commissions(status);

create table if not exists broker_transactions (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references broker_providers(id) on delete cascade,
  registration_id uuid references broker_registrations(id) on delete set null,
  webhook_event_id uuid references broker_webhook_events(id) on delete set null,
  external_id text not null,
  client_id text,
  transaction_type text,
  amount numeric(14,2),
  status text,
  creado_en timestamptz not null default now(),
  unique (broker_id, external_id)
);
alter table broker_transactions enable row level security;

-- Mapeo usuario <-> cuenta externa del broker -- HOY siempre NOT_CONNECTED
-- (no existe ninguna conexión real todavía), preparado para cuando exista
-- Eightcap Embedded.
create table if not exists broker_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  broker_id uuid not null references broker_providers(id) on delete cascade,
  external_account_id text,
  status text not null default 'NOT_CONNECTED' check (status in ('NOT_CONNECTED','PENDING','CONNECTED','ERROR')),
  connected_at timestamptz,
  creado_en timestamptz not null default now(),
  unique (user_id, broker_id)
);
alter table broker_accounts enable row level security;

create table if not exists broker_sync_logs (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid references broker_providers(id) on delete set null,
  tipo text not null,
  detalle jsonb,
  creado_en timestamptz not null default now()
);
alter table broker_sync_logs enable row level security;

-- Seed: Eightcap como único broker real hoy, status ACTIVE (partner/IB
-- aprobado), connection/trading deshabilitados hasta Embedded.
insert into broker_providers (codigo, nombre, descripcion, markets, platform, status, connection_enabled, trading_enabled)
values (
  'eightcap', 'Eightcap',
  'Broker partner de NLT. Servicios de brokerage provistos por Eightcap de forma independiente.',
  '["Forex","CFD","Indices","Commodities"]'::jsonb,
  'MT4/MT5', 'ACTIVE', false, false
)
on conflict (codigo) do nothing;
