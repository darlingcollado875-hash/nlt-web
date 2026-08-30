-- ─────────────────────────────────────────────────────────────────────
-- NLT Indicator AI — planes (SOLO parte B, aprobada por el owner 2026-08-29)
-- Aplicado en Supabase como migración `indicator_ai_plans_part_b`.
--
-- NO se tocan INDICATOR_MONTHLY ($50) ni INDICATOR_LIFETIME ($120): el
-- cambio de precio del indicador base queda pendiente de decisión comercial
-- (implicaciones sobre usuarios existentes / facturación).
--
-- Reversible:  delete from public.plans where id like 'INDICATOR_AI_%';
-- ─────────────────────────────────────────────────────────────────────
insert into public.plans (id, producto, nombre, descripcion, precio, billing_period, activo, orden, popular, features)
values
  ('INDICATOR_AI_MONTHLY', 'indicator', 'NLT Indicator AI (mensual)',
   'NLT Indicator + análisis multi-factor de zona con IA (AI Score, calidad, confluencias, invalidación, contexto histórico) dentro de tu cuenta NLT.',
   29.99, 'monthly', true, 3, true, '[]'::jsonb),
  ('INDICATOR_AI_LIFETIME', 'indicator', 'NLT Indicator AI (anual)',
   'NLT Indicator + análisis multi-factor de zona con IA. Acceso anual.',
   300.00, 'yearly', true, 4, false, '[]'::jsonb)
on conflict (id) do nothing;
