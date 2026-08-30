-- Ejecutar en Supabase > SQL Editor.
-- NLT "Contact us" -- chat de soporte entre cualquier usuario logueado y el
-- equipo NLT. NO es el sistema de DM de Community (community_dm.sql): ese es
-- estrictamente 1-a-1 (user_a_id/user_b_id fijos) y exige membresía activa
-- (requiere_membresia) -- acá se busca justo lo contrario: CUALQUIER usuario
-- logueado, tenga o no una suscripción, y CUALQUIER miembro del equipo con
-- el permiso "soporte" puede responder (no hay asignación 1-a-1 que
-- preservar). Por eso es una tabla nueva, no una reutilización de esa.
--
-- Una conversación única y perpetua por usuario (no "tickets"/threads/
-- prioridad/tags) -- pedido explícito de mantenerlo simple, mismo espíritu
-- que Elite Signals/Partners ("no un CRM gigante").

create table if not exists support_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references support_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  -- 'user' | 'team' -- de qué lado se ve el mensaje sin tener que resolver
  -- permisos de nuevo en cada render. sender_id sigue siendo siempre la
  -- persona real (para auditoría) -- el frontend del cliente muestra el
  -- lado 'team' como "Equipo NLT" genérico, nunca expone qué admin respondió.
  sender_role text not null check (sender_role in ('user', 'team')),
  content text not null,
  -- Idempotencia de envío -- mismo patrón que community_dm.sql
  -- (client_message_id + UNIQUE, ver community_dm.py::_crear_mensaje_directo_idempotente,
  -- catch de la violación real en vez de check-then-insert).
  client_message_id text,
  read_at timestamptz,      -- puesto por el lado OPUESTO al sender
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (conversation_id, sender_id, client_message_id)
);

alter table support_conversations enable row level security;
alter table support_messages enable row level security;
-- sin policies de select/insert/update para authenticated/anon => deny total
-- (service_role de NLT_API siempre puede, ignora RLS) -- mismo patrón "deny
-- por defecto" que partners.sql/elite_signals.sql/billing.sql. El frontend
-- NUNCA habla directo con Supabase para esto -- todo pasa por FastAPI.

create index if not exists idx_support_conversations_updated on support_conversations(updated_at desc);
create index if not exists idx_support_messages_conversation on support_messages(conversation_id, created_at desc);
-- Badge de no-leídos del lado equipo (cross-conversación) y del lado usuario.
create index if not exists idx_support_messages_unread on support_messages(sender_role, read_at) where read_at is null and deleted_at is null;

drop trigger if exists trg_support_conversations_updated_at on support_conversations;
create trigger trg_support_conversations_updated_at
  before update on support_conversations
  for each row execute function set_actualizado_en_orders();

-- --- Ensanchar community_notifications_type_check para los 2 tipos nuevos
-- ("support_message_new": usuario -> equipo con permiso "soporte",
-- "support_reply": equipo -> usuario) -- mismo patrón aditivo ya usado para
-- "partner_application_new" en partners.sql. Sin esto, notify_users_bulk()/
-- notify_user() fallan en silencio (nunca tumban el evento real, ver
-- notifications.py) con "violates check constraint
-- community_notifications_type_check".
alter table community_notifications drop constraint if exists community_notifications_type_check;
alter table community_notifications add constraint community_notifications_type_check
  check (type = ANY (ARRAY[
    'comment'::text, 'reply'::text, 'reaction'::text, 'mention'::text, 'announcement'::text, 'certificate'::text,
    'new_dm'::text, 'elite_signal_new'::text, 'elite_signal_tp'::text, 'elite_signal_sl'::text,
    'elite_signal_cancelled'::text, 'elite_signal_expired'::text, 'academy_lesson_completed'::text,
    'academy_certificate'::text, 'payment_confirmed'::text, 'payment_failed'::text, 'subscription_renewal'::text,
    'subscription_cancelled'::text, 'promotion'::text, 'new_feature'::text, 'partner_application_new'::text,
    'support_message_new'::text, 'support_reply'::text
  ]));
