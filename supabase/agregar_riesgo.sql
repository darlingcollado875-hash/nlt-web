-- Ejecutar en Supabase > SQL Editor. Agrega el % de riesgo por operación,
-- configurable en la cuenta Maestra, usado para calcular el lotaje de cada Destino.
alter table cuentas_mt5 add column if not exists riesgo_porcentaje numeric default 1.0;
