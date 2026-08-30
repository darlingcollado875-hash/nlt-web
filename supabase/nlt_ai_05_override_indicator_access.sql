-- ─────────────────────────────────────────────────────────────────────
-- nlt_ai.entitlement_overrides: columna indicator_access (BETA/QA)
-- Aplicado como migración `nlt_ai_override_indicator_access`.
--
-- Permite que un solo override active a un beta tester de punta a punta
-- (indicador base + IA) sin depender de una compra real en
-- public.indicator_orders. Aditivo, aislado en el schema nlt_ai.
--
-- Reversible:  alter table nlt_ai.entitlement_overrides drop column indicator_access;
-- ─────────────────────────────────────────────────────────────────────
alter table nlt_ai.entitlement_overrides
  add column if not exists indicator_access boolean;

comment on column nlt_ai.entitlement_overrides.indicator_access is
  'Override de acceso al indicador base para BETA/QA. NULL = no override (se usa membership_access / mirror).';
