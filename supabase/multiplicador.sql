-- Ejecutar en Supabase > SQL Editor.
-- Multiplicador de lotaje para el copiador de cuentas MT5API_DEV (distinto
-- del riesgo_porcentaje que usa el copiador de LOCAL_TERMINAL): lote_destino
-- = lote_maestra * multiplicador. Default 1.0 = copia exacta.

alter table cuentas_mt5 add column if not exists multiplicador numeric not null default 1.0;
