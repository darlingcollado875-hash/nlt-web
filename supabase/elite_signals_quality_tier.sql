-- Ejecutar en Supabase > SQL Editor (después de elite_signals_webhook.sql).
-- CAMBIO DE REGLA DE NEGOCIO: antes solo se publicaban señales con
-- quality_score >= 90 (binario: se ve o no se ve). Ahora se publican todas
-- las señales con score >= 70, clasificadas en 4 niveles de calidad:
--   70-79 -> NORMAL   80-89 -> OPTIMA   90-94 -> PERFECTA   95-100 -> ELITE
--
-- IMPORTANTE (colisión de nombres evitada a propósito): la tabla YA TIENE
-- una columna `status` que es el CICLO DE VIDA de la señal (ACTIVE/TP_HIT/
-- SL_HIT/CANCELLED/EXPIRED) -- el pedido llama "status" al nivel de calidad,
-- pero reutilizar ese nombre pisaría un concepto ya existente y no
-- relacionado. Se usa `quality_tier` para el nivel de calidad, dejando
-- `status` intacto para el ciclo de vida.
--
-- `quality_tier` es una GENERATED COLUMN (STORED): Postgres la calcula
-- automáticamente a partir de quality_score en cada INSERT/UPDATE -- es
-- estructuralmente imposible que backend/frontend la desincronicen o la
-- manden con un valor manual (Postgres directamente rechaza un INSERT que
-- intente escribirla). Esto es "el backend calcula automáticamente, nunca
-- el frontend" llevado al nivel más fuerte posible: ni siquiera un bug en
-- el backend podría escribir un quality_tier que no corresponda al score.

-- --- Ensancha el piso de quality_score: antes >=0, ahora >=70 (las
-- señales <70 ya no se publican -- ver validación en
-- app/api/routes/elite_signals_webhook.py, que las rechaza ANTES de
-- intentar este INSERT, así que este CHECK es la segunda capa de defensa,
-- no la primera). Tabla vacía en producción (0 filas, confirmado) -- sin
-- riesgo de datos huérfanos. ---
alter table elite_signals drop constraint if exists elite_signals_quality_score_check;
alter table elite_signals add constraint elite_signals_quality_score_check
  check (quality_score >= 70 and quality_score <= 100);

alter table elite_signals add column if not exists quality_tier text generated always as (
  case
    when quality_score >= 95 then 'ELITE'
    when quality_score >= 90 then 'PERFECTA'
    when quality_score >= 80 then 'OPTIMA'
    when quality_score >= 70 then 'NORMAL'
    else null
  end
) stored;

create index if not exists idx_elite_signals_quality_tier on elite_signals(quality_tier);
