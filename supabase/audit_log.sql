-- Ejecutar en Supabase > SQL Editor.
-- Audit log genérico para acciones administrativas (afiliados, academy
-- access, payouts, etc). Antes de esto no existía ninguna tabla de audit
-- log genérica -- payment_events es lo más parecido pero está scopeada a
-- orders. Mismo patrón deny-por-defecto que el resto de tablas de negocio:
-- todo pasa por NLT_API (service_role).

create extension if not exists pgcrypto;

create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,       -- email del admin
  accion text not null,      -- 'afiliado_suspendido', 'academy_acceso_concedido', etc -- texto libre, sin enum
  entidad text not null,     -- 'affiliate' | 'affiliate_code' | 'affiliate_payout' | 'academy_access' | ...
  entidad_id text,
  detalle jsonb,
  created_at timestamptz not null default now()
);
alter table admin_audit_log enable row level security;
create index if not exists idx_admin_audit_log_entidad on admin_audit_log(entidad, entidad_id);
