-- Ejecutar en Supabase > SQL Editor (después de elite_signals_quality_tier.sql).
-- CORRECCIÓN DEFINITIVA DE MODELO COMERCIAL: NLT Elite Signals NO es (nunca
-- llegó a anunciarse ni venderse) un producto de pago único ($70, acceso
-- permanente). El modelo real y definitivo es una SUSCRIPCIÓN RECURRENTE
-- normal de $15/mes (igual que Copy System/Academy), con un cupón de
-- lanzamiento ELITE35 que deja el precio en $7.50/mes.
--
-- Esta corrección NO reescribe elite_signals.sql (archivo histórico) --
-- agrega un archivo nuevo que:
--   1. Desactiva el plan viejo ELITE_SIGNALS_ONETIME ($70, one_time).
--   2. Crea el plan nuevo ELITE_SIGNALS_MONTHLY ($15, monthly).
--   3. Repunta el cupón ELITE35 al plan nuevo (50% off, sin restricción de
--      "primer pago" -- mismo motivo ya documentado en elite_signals.sql).
--   4. Elimina la tabla elite_signals_access: el acceso ahora se resuelve
--      100% contra subscriptions_v2(producto='elite_signals'), exactamente
--      igual que Academy/Copy System -- no hace falta (ni debe existir) una
--      tabla de acceso separada para este producto. Confirmado antes de
--      escribir este archivo: 0 filas en producción (tabla nunca llegó a
--      usarse para un acceso real).
--
-- La tabla `elite_signals` (las señales en sí) y `elite_signals_webhook_events`
-- NO se tocan -- son billing-agnósticas, la corrección es puramente de
-- modelo de cobro/acceso.

-- --- 1. Desactivar el plan viejo. No se borra (una orden histórica podría
-- referenciarlo por FK/valor de texto) -- solo se marca inactivo para que
-- deje de ofrecerse. ---
update plans set activo = false where id = 'ELITE_SIGNALS_ONETIME';

-- --- 2. Plan nuevo: $15/mes, billing_period='monthly' -- el flujo genérico
-- de orders/subscriptions_v2 (el mismo que ya usan Copy System/Academy) lo
-- activa sin ningún código especial. ---
insert into plans (id, producto, nombre, descripcion, precio, billing_period, popular, orden, features) values
  ('ELITE_SIGNALS_MONTHLY', 'elite_signals', 'NLT Elite Signals', 'Señales estructuradas de alta calidad, directo en tu dashboard NLT. Suscripción mensual.', 15.00, 'monthly', true, 1,
    '["Señales BUY/SELL con entry, TP y SL","Clasificación por Quality Score (NORMAL/OPTIMA/PERFECTA/ELITE)","Historial completo de señales","Acceso mientras tu suscripción esté activa","Acceso dentro del ecosistema NLT"]'::jsonb)
on conflict (id) do update set
  producto = excluded.producto, nombre = excluded.nombre, descripcion = excluded.descripcion,
  precio = excluded.precio, billing_period = excluded.billing_period, popular = excluded.popular,
  orden = excluded.orden, features = excluded.features, activo = true;

-- --- 3. Repuntar el cupón ELITE35 al plan nuevo: $15 * (1-0.50) = $7.50/mes.
-- first_payment_only=false sin cambios (mismo motivo que elite_signals.sql:
-- no debe rechazar a usuarios con órdenes pagadas de otros productos). ---
update coupons set
  applicable_plans = array['ELITE_SIGNALS_MONTHLY'],
  discount_percentage = 50,
  first_payment_only = false,
  active = true
where code = 'ELITE35';

-- --- 4. Eliminar elite_signals_access -- infraestructura redundante que ya
-- no se usa (el acceso vive en subscriptions_v2). Verificar 0 filas
-- inmediatamente ANTES de correr el DROP de abajo (no ejecutar el DROP si
-- esta cuenta no es 0): ---
-- select count(*) from elite_signals_access;

drop table if exists elite_signals_access;
