-- Ejecutar en Supabase > SQL Editor.
-- Habilita RITHMIC como proveedor válido de cuentas_futures -- mismo patrón
-- ya usado en tickerall.sql para agregar TICKERALL a cuentas_mt5 (dropear y
-- recrear el check en vez de tocar la definición original de futures.sql,
-- que ya corrió en producción).
alter table cuentas_futures drop constraint if exists cuentas_futures_proveedor_check;
alter table cuentas_futures add constraint cuentas_futures_proveedor_check
  check (proveedor in ('MOCK_FUTURES', 'TRADOVATE', 'RITHMIC'));
