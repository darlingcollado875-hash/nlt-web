-- Ejecutar en Supabase > SQL Editor.
-- NLT Charts: fuentes ADICIONALES de precios (cripto en vivo con Binance; índices/metales/energía con una cuenta práctica de OANDA).
-- El token de OANDA va CIFRADO (Fernet) y solo lo lee el servidor: sin políticas = nada del navegador lo ve ni lo escribe.
create table if not exists charts_fuentes_extra (
  source text primary key check (source in ('binance', 'oanda')),
  enabled boolean not null default true,
  token_encriptado text,
  account_id text,
  env text not null default 'practice' check (env in ('practice', 'live')),
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table charts_fuentes_extra enable row level security;
