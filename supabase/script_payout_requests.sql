-- NLT Script: cobros de los creadores de indicadores (ya aplicado en Supabase, documentado aquí).
-- El cobro de cada venta entra a Whop; a los creadores NLT les paga por fuera y lo marca aquí.
create table if not exists public.script_payout_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  method text not null,
  details text not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.script_payout_requests (
  id uuid primary key default gen_random_uuid(),
  seller_user_id uuid not null references auth.users(id) on delete cascade,
  amount_usd numeric(12,2) not null check (amount_usd > 0),
  method text not null,
  details text not null,
  status text not null default 'pending' check (status in ('pending','paid','rejected')),
  note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
create index if not exists script_payout_requests_seller_idx on public.script_payout_requests (seller_user_id, created_at desc);
create index if not exists script_payout_requests_status_idx on public.script_payout_requests (status, created_at desc);
alter table public.script_payout_profiles enable row level security;
alter table public.script_payout_requests enable row level security;
alter table public.script_sales add column if not exists payout_request_id uuid references public.script_payout_requests(id) on delete set null;
alter table public.script_sales drop constraint if exists script_sales_payout_status_check;
alter table public.script_sales add constraint script_sales_payout_status_check check (payout_status in ('pending','requested','paid'));
create index if not exists script_sales_request_idx on public.script_sales (payout_request_id);
