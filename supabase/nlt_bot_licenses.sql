-- NLT Bot Supreme -- índice del lado Ecosystem de las licencias emitidas
-- por el NLT License Server (proyecto separado, congelado, ver
-- RATIFIED INTEGRATION CONTRACT v1). Esta tabla NUNCA es autoridad sobre
-- si una licencia es válida -- esa autoridad es 100% del License Server
-- (GET /v1/admin/licenses/{id}, y del lado del Bot, LicenseClient.validate/
-- heartbeat). `status_cache` es puramente informativo (dashboard +
-- reconciliación), nunca se usa para decidir entitlement -- el entitlement
-- real sigue siendo subscriptions_v2.status='active' + producto='nlt_bot'.
--
-- Existe porque el License Server no tiene lookup por customer/email
-- (BLOCKER-INT-1, confirmado real en la auditoría, no resoluble sin tocar
-- el License Server congelado) -- el Ecosystem mantiene su propio índice
-- desde el momento en que crea cada licencia, nunca necesita "buscarla"
-- después. NO es un segundo sistema de licencias paralelo: nunca decide
-- validez, solo recuerda el mapeo user_id -> license_server_id que el
-- License Server mismo no puede resolver.
--
-- No hay columna `subscription_id` separada a propósito: subscriptions_v2
-- tiene PK compuesta (user_id, producto) -- (user_id, producto) de esta
-- tabla YA ES la referencia equivalente, agregar una columna más sería
-- duplicar información redundante.

create table if not exists nlt_bot_licenses (
  id uuid primary key default gen_random_uuid(),

  -- Identidad del cliente -- mismo FK real que ya usa subscriptions_v2.
  user_id uuid not null references auth.users(id) on delete cascade,
  producto text not null default 'nlt_bot',

  -- Orden que originó esta licencia -- nullable a propósito: el flujo de
  -- soporte (admin crea una licencia a mano, ej. cliente pagó por
  -- transferencia) no siempre tiene una orden real detrás.
  order_id uuid references orders(id),

  -- Mapeo hacia el License Server (congelado, nunca modificado por esta
  -- migración). license_server_id es el `License.id` (entero) que
  -- devuelve POST /v1/admin/licenses -- UNIQUE acá porque un mismo
  -- license_server_id nunca debería aparecer en 2 filas de este lado.
  license_server_id integer not null,
  license_key text not null,

  -- Estado informativo, refrescado por el job de reconciliación
  -- (Fase 7, todavía no implementada) o al consultar el dashboard
  -- (Fase 4). NUNCA se usa para autorizar nada -- ver docstring arriba.
  status_cache text not null default 'ACTIVE'
    check (status_cache in ('ACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED')),
  status_cache_synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- LA constraint fundamental del contrato: 1 usuario + 1 producto = 1
  -- licencia. Es también la garantía real de idempotencia de
  -- crear_licencia_si_aplica() (Fase 3, todavía no implementada) --
  -- ante una condición de carrera, el segundo INSERT falla acá, nunca
  -- se crean 2 licencias reales en el License Server para el mismo
  -- usuario+producto.
  unique(user_id, producto),
  unique(license_server_id),
  unique(license_key)
);

create index if not exists idx_nlt_bot_licenses_order on nlt_bot_licenses(order_id);
create index if not exists idx_nlt_bot_licenses_license_server_id on nlt_bot_licenses(license_server_id);
create index if not exists idx_nlt_bot_licenses_producto on nlt_bot_licenses(producto);

-- RLS: tabla puramente backend -- el frontend NUNCA la consulta directo
-- contra Supabase (siempre a través de NLT_API, que ya verifica auth real
-- vía JWT). Mismo patrón que prop_hub_events: sin policies, solo
-- service_role lee/escribe.
alter table nlt_bot_licenses enable row level security;
