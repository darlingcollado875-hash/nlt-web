-- NLT Bot Supreme -- Fase 4 (Customer Dashboard). Extiende el cache
-- puramente informativo de nlt_bot_licenses (ver nlt_bot_licenses.sql)
-- con lo que necesita GET /bot/mi-licencia para mostrar "dispositivos
-- usados/máximo" y "cuentas usadas/máximo" sin pegarle al License Server
-- en cada request. Mismo criterio que status_cache/status_cache_synced_at
-- (ya existentes): NUNCA autoritativo -- el dato real vive en
-- GET /v1/admin/licenses/{id} (AdminLicenseView.devices/accounts/
-- max_devices/max_accounts, ver license_server/app/schemas.py, congelado,
-- no modificado). Esta migración solo agrega columnas a una tabla que ya
-- es 100% del lado Ecosystem -- no toca nada del Bot ni del License Server.

alter table nlt_bot_licenses
  add column if not exists devices jsonb not null default '[]'::jsonb,
  add column if not exists accounts jsonb not null default '[]'::jsonb,
  add column if not exists max_devices integer,
  add column if not exists max_accounts integer;
