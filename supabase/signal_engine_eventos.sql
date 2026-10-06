-- NLT Signal Engine automático: auditoría de cada evento detectado (idempotente por vela). Se aplica en Supabase.
create table if not exists public.signal_engine_eventos (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    modo text not null,
    symbol text not null,
    timeframe text not null,
    evento text not null,
    direccion text not null,
    setup text,
    quality int,
    entry numeric, sl numeric, tp1 numeric, tp2 numeric,
    bar_ts bigint not null,
    entry_ts bigint not null,
    resultado text,
    unique (symbol, timeframe, evento, bar_ts, entry_ts)
);
alter table public.signal_engine_eventos enable row level security;
create index if not exists idx_signal_engine_eventos_created on public.signal_engine_eventos (created_at desc);
