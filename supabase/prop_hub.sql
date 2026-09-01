-- NLT Prop Hub -- directorio/comparador de prop firms EXTERNAS (Institutional
-- Funding, PropCapital, FundedProfit, y más en el futuro), con salida por
-- referral. Dominio DISTINTO del "NLT Funded" existente (propfirm.html +
-- propfirm_challenge_configs/propfirm_orders): ese es NLT vendiendo SU
-- PROPIO challenge con checkout real dentro de NLT vía un único partner de
-- infraestructura; Prop Hub es un directorio de MUCHAS empresas externas
-- donde el checkout NUNCA ocurre dentro de NLT -- el CTA final abre la web
-- oficial de la empresa vía enlace de referral. Ninguna tabla de esta
-- migración se cruza con `propfirm_*` ni la modifica.
--
-- Columnas planas (nunca jsonb para datos núcleo, mismo criterio que
-- plans.sql/propfirm_challenge_configs) + una tabla hija `prop_hub_challenges`
-- porque cada challenge (tamaño de cuenta) de un partner tiene sus propios
-- fee/type/platform/target/drawdown/payout -- un partner puede ofrecer
-- varios challenges distintos, no uno solo.
--
-- REGLA DE CONFIANZA (pedido explícito): `is_recommended` es un flag
-- controlado EXPLÍCITAMENTE por Admin, nunca calculado automáticamente por
-- existir una comisión/afiliación. `status='Partner'` (la relación comercial)
-- y `is_recommended=true` (NLT probó y recomienda) son cosas DISTINTAS a
-- propósito -- ver docstring del pedido: "NO mostrar Recommended solo porque
-- la empresa paga comisión."

create table if not exists prop_hub_partners (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  logo_url text,
  status text not null default 'Partner' check (status in ('Partner','Tested','Recommended')),
  is_tested boolean not null default false,
  is_recommended boolean not null default false,
  description text,
  platforms text[],
  official_url text,
  min_account numeric(12,2),
  max_account numeric(12,2),
  profit_split_percent numeric(5,2),
  payout_info text,
  discount_percent numeric(5,2),
  discount_code text,
  affiliate_url text,
  rules_url text,
  terms_url text,
  support_url text,
  review_summary text,

  -- "NLT Experience" -- el detail page solo la muestra si challenge_status
  -- no es null (pedido explícito: "Solo mostrar si existe"). NUNCA se
  -- fabrica -- queda null hasta que NLT realmente documente la experiencia.
  challenge_status text check (challenge_status in ('in_progress','passed','failed','funded')),
  payout_status text check (payout_status in ('none','requested','paid')),
  payout_amount numeric(12,2),
  payout_proof_url text,
  video_urls text[],
  screenshots text[],
  advantages text[],       -- "Things we liked"
  considerations text[],   -- "Things to consider"

  featured boolean not null default false,
  sort_order int not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists prop_hub_challenges (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references prop_hub_partners(id) on delete cascade,
  account_size numeric(12,2) not null,
  fee numeric(10,2),
  challenge_type text,     -- '1-Step','2-Step','Instant', texto libre (igual que propfirm_challenge_configs.leverage)
  platform text,
  target_percent numeric(5,2),
  max_daily_loss_percent numeric(5,2),
  max_drawdown_percent numeric(5,2),
  payout_rules text,
  activo boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(partner_id, account_size, challenge_type)
);

-- Tracking mínimo (no existía ninguna infraestructura de analytics/eventos
-- genérica en el proyecto antes de esto -- confirmado). Pensada para
-- inserts en BATCH desde el frontend (un solo POST con varios eventos),
-- nunca un request por card/impression.
create table if not exists prop_hub_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('impression','view_detail','click_cta','copy_code')),
  partner_id uuid references prop_hub_partners(id) on delete set null,
  user_id uuid,
  source_page text,
  campaign text,
  created_at timestamptz not null default now()
);

-- RLS: mismo patrón deny-by-default que plans.sql -- la única excepción
-- real es lectura pública de filas activas, porque /funded es una landing
-- pública sin login (igual que /propfirm). Los inserts de prop_hub_events
-- SIEMPRE pasan por el backend (service_role) -- nunca el frontend inserta
-- directo a Supabase, por eso no tiene ninguna policy de INSERT.
alter table prop_hub_partners enable row level security;
create policy "select partners activos publico" on prop_hub_partners for select using (activo = true);

alter table prop_hub_challenges enable row level security;
create policy "select challenges activos publico" on prop_hub_challenges for select using (activo = true);

alter table prop_hub_events enable row level security;
-- sin policies -- solo service_role (backend) puede leer/escribir.

create index if not exists idx_prop_hub_partners_slug on prop_hub_partners(slug);
create index if not exists idx_prop_hub_partners_activo on prop_hub_partners(activo) where activo = true;
create index if not exists idx_prop_hub_challenges_partner on prop_hub_challenges(partner_id);
create index if not exists idx_prop_hub_events_partner on prop_hub_events(partner_id);
create index if not exists idx_prop_hub_events_created on prop_hub_events(created_at desc);

-- Seed inicial: SOLO los 3 partners reales confirmados por el pedido, y
-- SOLO los campos que el pedido confirmó explícitamente para cada uno.
-- Todo lo demás (logo, official_url, platforms, profit_split, payout_info,
-- affiliate_url de PropCapital/FundedProfit) queda NULL a propósito -- se
-- completa desde el panel Admin cuando esté confirmado, nunca se fabrica.
-- Ninguno queda is_recommended=true (regla de confianza de arriba).
insert into prop_hub_partners (slug, name, status, is_tested, is_recommended, discount_code) values
  ('institutional-funding', 'Institutional Funding', 'Partner', false, false, 'NLT10'),
  ('propcapital', 'PropCapital', 'Partner', false, false, null),
  ('fundedprofit', 'FundedProfit', 'Partner', false, false, null)
on conflict (slug) do nothing;

-- Institutional Funding: "NLT challenge $25K" + "community giveaway 10 x $10K 2-Step".
insert into prop_hub_challenges (partner_id, account_size, challenge_type)
select id, 25000, 'NLT Challenge' from prop_hub_partners where slug = 'institutional-funding'
union all
select id, 10000, 'Community Giveaway 2-Step' from prop_hub_partners where slug = 'institutional-funding'
union all
select id, 25000, 'NLT Challenge' from prop_hub_partners where slug = 'propcapital'
on conflict (partner_id, account_size, challenge_type) do nothing;
