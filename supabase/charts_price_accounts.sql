-- Ejecutar en Supabase > SQL Editor.
-- NLT Charts: login de las cuentas de PRECIOS (principal / respaldo) para que la API las reconecte sola cuando TickerAll las enfría.
-- La contraseña va CIFRADA (Fernet, la misma clave que las cuentas del copiador) y solo la lee el servidor: sin políticas = nadie del
-- navegador puede leerla ni escribirla (solo el service role de la API, a través de /admin/charts/price-accounts).
create table if not exists charts_price_accounts (
  role text primary key check (role in ('primary', 'backup')),
  login text not null,
  server text not null,
  password_encriptada text not null,
  account_id text,                       -- el accountId de TickerAll de la última conexión (así sobrevive a un reinicio)
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table charts_price_accounts enable row level security;
