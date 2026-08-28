-- Ejecutar en Supabase > SQL Editor.
-- NLT Business Development Foundation -- primera capa de partnerships de
-- negocio (empresas: brokers, prop firms, tech vendors, media, educación),
-- NO afiliados individuales (eso ya existe en affiliate_*, dominio
-- totalmente distinto -- ver services/affiliates.py) y NO los "broker
-- partners" de broker.html (esos son la tabla `brokers`, regulados, que el
-- usuario conecta para operar -- dominio de trading, no de negocio).
--
-- Un solo modelo (`partners`) cubre tanto el PROSPECT (llega por el form
-- público de become-partner.html, is_public=false por default) como el
-- PARTNER publicado (is_public=true, aparece en partners.html) -- la
-- diferencia es de estado, no de tabla, tal como pidió el usuario ("un
-- prospecto no debe aparecer públicamente... Prospect -> Partner, entonces
-- puede publicarse").
--
-- Separación pública/privada real: el endpoint público (GET /partners) solo
-- lee company_name/description/logo_url/website/category/public_status de
-- filas con is_public=true -- nunca los campos de contacto/notas/pipeline,
-- ni siquiera con una policy de RLS (deny-by-default de siempre, mismo
-- patrón que elite_signals.sql/billing.sql -- la separación la hace el
-- código de FastAPI, service_role, no PostgREST directo).

create table if not exists partners (
  id uuid primary key default gen_random_uuid(),

  -- --- Datos de la empresa (lo único que se muestra en público) ---
  company_name text not null,
  description text,
  website text,
  logo_url text,
  category text check (category in ('trading', 'funding', 'technology', 'education', 'media', 'strategic')),
  public_status text check (public_status in ('Partner', 'Strategic Partner', 'Technology Partner', 'Funding Partner', 'Trading Partner')),
  is_public boolean not null default false,

  -- --- Pipeline interno (nunca expuesto por el endpoint público) ---
  internal_status text not null default 'NEW' check (internal_status in (
    'NEW', 'CONTACTED', 'REPLIED', 'MEETING', 'NEGOTIATING', 'PARTNER', 'ACTIVE', 'PAUSED', 'REJECTED'
  )),
  notes text,

  -- --- Contacto (privado) ---
  contact_name text,
  contact_email text,
  contact_role text,
  country text,

  -- --- Datos del formulario "Become a Partner" (privados, opcionales) ---
  partnership_type text check (partnership_type in (
    'Broker', 'Prop Firm', 'Technology', 'Trading Platform', 'Payment Provider',
    'Market Data', 'Education', 'Media', 'Creator', 'Strategic Partner', 'Other'
  )),
  what_offer text,
  what_looking_for text,
  message text,
  monthly_reach text,              -- texto libre a propósito -- "no exigir métricas si no son necesarias"
  existing_affiliate_program text,
  budget_sponsorship text,
  partnership_proposal text,

  -- --- Analytics mínimo (Fase 14: preparar estructura, no el dashboard) ---
  source text not null default 'become_partner_form',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table partners enable row level security;
-- sin policies de select/insert/update para authenticated/anon => deny
-- total (service_role de NLT_API siempre puede, ignora RLS) -- mismo patrón
-- "deny por defecto" que elite_signals.sql/billing.sql. El frontend público
-- NUNCA habla directo con Supabase para esto -- todo pasa por FastAPI.

create index if not exists idx_partners_is_public on partners(is_public) where is_public = true;
create index if not exists idx_partners_internal_status on partners(internal_status);
create index if not exists idx_partners_category on partners(category);
create index if not exists idx_partners_created on partners(created_at desc);
-- Para el throttle de 24h del formulario público (buscar por email +
-- ventana de tiempo) -- ver services/partners.py::_excede_rate_limit.
create index if not exists idx_partners_contact_email on partners(contact_email);

drop trigger if exists trg_partners_updated_at on partners;
create trigger trg_partners_updated_at
  before update on partners
  for each row execute function set_actualizado_en_orders();

-- --- Ensanchar community_notifications_type_check para el nuevo tipo
-- "partner_application_new" (ver services/notifications.py) -- mismo
-- patrón aditivo ya usado para plans_producto_check en elite_signals.sql.
-- Confirmado real: sin esto, notify_users_bulk() falla en silencio (el
-- propio diseño de notifications.py nunca deja que una notificación
-- fallida tumbe el evento real) con
-- "violates check constraint community_notifications_type_check" -- se
-- reproduce y se corrige acá, no se documenta como TODO. ---
alter table community_notifications drop constraint if exists community_notifications_type_check;
alter table community_notifications add constraint community_notifications_type_check
  check (type = ANY (ARRAY[
    'comment'::text, 'reply'::text, 'reaction'::text, 'mention'::text, 'announcement'::text, 'certificate'::text,
    'new_dm'::text, 'elite_signal_new'::text, 'elite_signal_tp'::text, 'elite_signal_sl'::text,
    'elite_signal_cancelled'::text, 'elite_signal_expired'::text, 'academy_lesson_completed'::text,
    'academy_certificate'::text, 'payment_confirmed'::text, 'payment_failed'::text, 'subscription_renewal'::text,
    'subscription_cancelled'::text, 'promotion'::text, 'new_feature'::text, 'partner_application_new'::text
  ]));
