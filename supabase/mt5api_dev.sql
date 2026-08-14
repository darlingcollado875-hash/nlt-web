-- Ejecutar en Supabase > SQL Editor.
-- Soporta el proveedor MT5API.dev (terminal-less) como alternativa a
-- LOCAL_TERMINAL, reutilizando cuentas_mt5 y las tablas ya creadas hoy
-- (account_connections, trade_events, cuenta_posiciones, cuenta_ordenes)
-- en vez de duplicar un esquema paralelo.

alter table cuentas_mt5 add column if not exists proveedor text not null default 'LOCAL_TERMINAL'
  check (proveedor in ('LOCAL_TERMINAL', 'MT5API_DEV'));
alter table cuentas_mt5 add column if not exists mt5api_account_id text;

-- Para cuentas MT5API_DEV, password_encriptada puede quedar NULL: MT5API.dev
-- guarda la contraseña cifrada con su propio KMS y nunca la devuelve, así
-- que NLT_API no necesita conservar una copia después de crear la cuenta.
alter table cuentas_mt5 alter column password_encriptada drop not null;

-- Suscripciones (Free / Pay-as-you-go / Membership) -- tabla separada de
-- perfiles a propósito, para dejar más limpio un futuro billing real
-- (Stripe u otro). Límite de cuentas configurable, no hardcodeado.
create table if not exists subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pay_as_you_go', 'membership')),
  limite_cuentas_live int not null default 1,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
alter table subscriptions enable row level security;

drop policy if exists "select propio o admin" on subscriptions;
create policy "select propio o admin" on subscriptions for select
  using (auth.uid() = user_id or auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com');

drop policy if exists "update solo admin" on subscriptions;
create policy "update solo admin" on subscriptions for update
  using (auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com')
  with check (auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com');
