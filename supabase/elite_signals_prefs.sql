-- Pares que cada suscriptor de Elite Signals quiere recibir. Vacío / sin fila = recibe todos.
create table if not exists public.elite_signals_prefs (
    user_id uuid primary key references auth.users(id) on delete cascade,
    symbols text[] not null default '{}',
    updated_at timestamptz not null default now()
);
alter table public.elite_signals_prefs enable row level security;
