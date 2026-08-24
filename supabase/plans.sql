-- Ejecutar en Supabase > SQL Editor.
-- Migra el catálogo de planes de un dict hardcodeado en Python
-- (NLT_API/app/core/plans.py) a una tabla real, para que Admin pueda
-- crear/editar/activar planes sin un deploy de código.
--
-- Tabla ÚNICA para todo el ecosistema (no una tabla separada por producto):
-- columna `producto` distingue copy_system / indicator / academy / community.
-- Esto es lo que permite que /plans (el "centro comercial" de NLT) muestre
-- los planes de todos los productos sin duplicar el modelo de CRUD.
--
-- Los 5 planes CFD se insertan con los MISMOS ids/precios/features que ya
-- tenía core/plans.py -- esto es una migración de almacenamiento, no un
-- cambio de negocio. orders.plan y subscriptions_v2.plan siguen siendo
-- texto libre comparado contra plans.id, sin FK nueva (evita romper filas
-- existentes si algún día se borra un plan viejo).
--
-- RLS: mismo patrón "deny por defecto" del resto de billing.sql, con UNA
-- excepción real y necesaria: los planes ACTIVOS se pueden leer público
-- (sin sesión) porque /plans es una página comercial, no autenticada.

create table if not exists plans (
  id text primary key,
  producto text not null check (producto in ('copy_system', 'indicator', 'academy', 'community')),
  nombre text not null,
  descripcion text,
  precio numeric(10,2) not null,
  billing_period text not null default 'monthly' check (billing_period in ('monthly', 'yearly', 'one_time')),
  max_cuentas int,
  popular boolean not null default false,
  activo boolean not null default true,
  orden int not null default 0,
  features jsonb not null default '[]'::jsonb,
  mercados text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table plans enable row level security;

create policy "select planes activos publico" on plans
  for select using (activo = true);
-- sin policies de insert/update/delete para authenticated/anon => solo
-- NLT_API (service_role) puede escribir, igual que el resto de billing.

drop trigger if exists trg_plans_updated_at on plans;
create trigger trg_plans_updated_at
  before update on plans
  for each row execute function set_actualizado_en_orders();

-- --- Copy System: mismos 5 planes, mismos precios, misma featureset ---
insert into plans (id, producto, nombre, precio, billing_period, max_cuentas, popular, orden, features, mercados) values
  ('STARTER', 'copy_system', 'Starter', 9.99, 'monthly', 2, false, 1,
    '["Copiado automático","Dashboard","Historial de operaciones","Gestión básica de cuentas","Soporte básico"]'::jsonb, array['CFD']),
  ('TRADER', 'copy_system', 'Trader', 19.99, 'monthly', 5, false, 2,
    '["Todo Starter","Multiplicador de lotaje","Configuración de riesgo","Filtros de símbolos","Hasta 5 cuentas MT5"]'::jsonb, array['CFD']),
  ('PRO', 'copy_system', 'Pro', 34.99, 'monthly', 10, true, 3,
    '["Todo Trader","Configuraciones avanzadas","Prioridad de ejecución","Logs detallados","Soporte prioritario","Hasta 10 cuentas MT5"]'::jsonb, array['CFD']),
  ('ELITE', 'copy_system', 'Elite', 59.99, 'monthly', 25, false, 4,
    '["Todo Pro","Mayor prioridad","Configuraciones avanzadas","Soporte prioritario","Hasta 25 cuentas MT5"]'::jsonb, array['CFD']),
  ('BUSINESS', 'copy_system', 'Business', 99.99, 'monthly', 50, false, 5,
    '["Todo Elite","Hasta 50 cuentas MT5","Máxima prioridad","Soporte prioritario","Diseñado para traders con múltiples cuentas/comunidades pequeñas"]'::jsonb, array['CFD'])
on conflict (id) do nothing;

-- --- Indicator: precios reales confirmados en nextleveltrading0.framer.website ---
-- "NLT Elite Signals" se quitó de acá (ver nlt-web/supabase/elite_signals.sql):
-- ahora es su propio producto pago ($70/mes), no un item incluido en este plan.
insert into plans (id, producto, nombre, descripcion, precio, billing_period, popular, orden, features) values
  ('INDICATOR_MONTHLY', 'indicator', 'Acceso Mensual', 'NLT Tools, con actualizaciones mensuales.', 50.00, 'monthly', false, 1,
    '["NLT Tools","Actualizaciones mensuales"]'::jsonb),
  ('INDICATOR_LIFETIME', 'indicator', 'Acceso Vitalicio', 'Todos los beneficios del plan mensual, de por vida, con prioridad de acceso al NLT AI Bot.', 120.00, 'one_time', true, 2,
    '["Todo lo del plan mensual","Acceso vitalicio","Prioridad NLT AI Bot"]'::jsonb)
on conflict (id) do nothing;

-- --- Academy: precio inicial confirmado directamente por el usuario ---
insert into plans (id, producto, nombre, precio, billing_period, orden, features) values
  ('ACADEMY_BASIC', 'academy', 'Academy', 10.00, 'one_time', 1, '[]'::jsonb)
on conflict (id) do nothing;
