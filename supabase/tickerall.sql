-- Ejecutar en Supabase > SQL Editor.
-- Agrega TICKERALL como proveedor válido (reemplaza a MT5API_DEV como
-- proveedor terminal-less activo, pero se deja MT5API_DEV en el check por
-- si hace falta volver -- no se borra nada existente) y la columna para
-- guardar su accountId.

alter table cuentas_mt5 drop constraint if exists cuentas_mt5_proveedor_check;
alter table cuentas_mt5 add constraint cuentas_mt5_proveedor_check
  check (proveedor in ('LOCAL_TERMINAL', 'MT5API_DEV', 'TICKERALL'));

alter table cuentas_mt5 add column if not exists tickerall_account_id text;
