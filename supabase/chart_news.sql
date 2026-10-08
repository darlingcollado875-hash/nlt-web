-- NLT News Radar (avisos de noticias económicas en NLT Charts). Ya aplicado en Supabase.
-- chart_news_prefs: qué avisos por push quiere cada usuario (los lee/escribe NLT_API con service_role; RLS sin políticas = sin acceso directo).
-- chart_news_sent: "reclamo" de cada aviso (evento, minutos de anticipación) para que salga una sola vez aunque haya varias instancias.
create table if not exists public.chart_news_prefs (
    user_id uuid primary key,
    push boolean not null default false,
    lead_minutes int not null default 5 check (lead_minutes in (5, 10, 15)),
    impacts text[] not null default '{HIGH}',
    updated_at timestamptz not null default now()
);
create table if not exists public.chart_news_sent (
    event_id text not null,
    lead_minutes int not null,
    sent_at timestamptz not null default now(),
    recipients int not null default 0,
    primary key (event_id, lead_minutes)
);
alter table public.chart_news_prefs enable row level security;
alter table public.chart_news_sent enable row level security;
create index if not exists idx_chart_news_prefs_push on public.chart_news_prefs (push) where push;
