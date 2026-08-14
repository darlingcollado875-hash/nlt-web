-- Ejecutar en Supabase > SQL Editor.
-- Arquitectura multimercado: separa CFDs/Forex (MT5) de Futuros. Hoy los 3
-- proveedores existentes (LOCAL_TERMINAL, MT5API_DEV, TICKERALL) son todos
-- CFD -- el default 'CFD' se aplica automáticamente a las cuentas ya
-- existentes, no rompe nada. connector_type/platform NO se agregan como
-- columnas nuevas: la columna 'proveedor' ya cumple ese rol.

alter table cuentas_mt5 add column if not exists market_type text not null default 'CFD'
  check (market_type in ('CFD', 'FUTURES'));
