-- Ejecutar en Supabase > SQL Editor (después de elite_signals_quality_tier.sql).
-- Conexión con NLT Signal Engine V3.13 -- ver auditoría en el reporte de
-- esta corrección. Dos cambios de schema:
--
-- 1. Columna `setup` (texto libre, ej. "Breakout", "Reversal", "Pullback
--    Continuation" -- ver f_alertJSON() en NLT_Signal_Engine_V3.13.pine).
--    Sin CHECK constraint a propósito: V3.13 puede agregar nuevos setups
--    en el futuro sin requerir otra migración acá.
--
-- 2. quality_tier pasa de 4 a 5 niveles (se angosta OPTIMA a 80-85 y se
--    agrega STRONG 86-89, pedido explícito de la corrección V3.13).
--    Postgres NO permite ALTER de la expresión de una generated column --
--    hay que DROP + re-ADD. Se recalcula sola para cualquier fila
--    existente (0 filas confirmadas en producción antes de correr esto).

alter table elite_signals add column if not exists setup text;

drop index if exists idx_elite_signals_quality_tier;
alter table elite_signals drop column if exists quality_tier;
alter table elite_signals add column quality_tier text generated always as (
  case
    when quality_score >= 95 then 'ELITE'
    when quality_score >= 90 then 'PERFECTA'
    when quality_score >= 86 then 'STRONG'
    when quality_score >= 80 then 'OPTIMA'
    when quality_score >= 70 then 'NORMAL'
    else null
  end
) stored;

create index if not exists idx_elite_signals_quality_tier on elite_signals(quality_tier);
