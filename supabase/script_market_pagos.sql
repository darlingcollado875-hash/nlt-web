-- ══════════════════════════════════════════════════════════════════
-- NLT Script — venta de indicadores (cobro por Whop; el pago llega a NLT y se reparte con el creador). ADITIVO.
-- RLS activa sin policies de cliente (solo el backend).
-- ══════════════════════════════════════════════════════════════════
alter table public.user_scripts add column if not exists price_usd numeric(8,2) check (price_usd is null or (price_usd >= 2 and price_usd <= 200));
alter table public.user_scripts add column if not exists billing text not null default 'monthly' check (billing in ('monthly','one_time'));
alter table public.user_scripts add column if not exists blocked boolean not null default false;

create table if not exists public.script_purchases (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique,
  script_id uuid not null references public.user_scripts(id) on delete restrict,
  buyer_user_id uuid not null references auth.users(id) on delete cascade,
  seller_user_id uuid not null references auth.users(id) on delete cascade,
  price_usd numeric(8,2) not null,
  billing text not null check (billing in ('monthly','one_time')),
  commission_pct numeric(5,2) not null,
  status text not null default 'pending' check (status in ('pending','active','cancelled')),
  provider_membership_id text,
  checkout_ref text,
  created_at timestamptz not null default now(),
  activated_at timestamptz
);
create index if not exists script_purchases_buyer_idx on public.script_purchases (buyer_user_id, status);
create index if not exists script_purchases_script_idx on public.script_purchases (script_id, status);
create index if not exists script_purchases_membership_idx on public.script_purchases (provider_membership_id);

create table if not exists public.script_sales (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.script_purchases(id) on delete cascade,
  seller_user_id uuid not null references auth.users(id) on delete cascade,
  payment_id text not null unique,
  gross_usd numeric(8,2) not null,
  commission_pct numeric(5,2) not null,
  creator_share_usd numeric(8,2) not null,
  payout_status text not null default 'pending' check (payout_status in ('pending','paid')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists script_sales_seller_idx on public.script_sales (seller_user_id, payout_status);

create table if not exists public.script_reports (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references public.user_scripts(id) on delete cascade,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 300),
  created_at timestamptz not null default now(),
  unique (script_id, reporter_user_id)
);
alter table public.script_purchases enable row level security;
alter table public.script_sales enable row level security;
alter table public.script_reports enable row level security;
