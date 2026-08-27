-- Ejecutar en Supabase > SQL Editor.
-- Mensajería privada 1-a-1 de NLT Community -- independiente del Chat
-- General (community_messages, ver community_chat.sql). Misma regla de
-- acceso (Community activa), pero autorización POR CONVERSACIÓN distinta:
-- acá NO hay bypass de admin a propósito ("la privacidad es la regla",
-- los admins no leen DMs automáticamente) -- ver community_dm.py.
--
-- RLS: mismo patrón exacto que el resto de community_* (RLS activado,
-- CERO políticas -- toda la autorización real vive en FastAPI).

create table if not exists community_conversations (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_conversations_no_self check (user_a_id <> user_b_id),
  -- Una sola conversación por pareja: user_a_id/user_b_id SIEMPRE se
  -- normalizan (menor UUID primero) antes de insertar, ver
  -- repository.py::obtener_o_crear_conversacion -- este unique es la
  -- garantía real contra condiciones de carrera, no solo buena fe del código.
  constraint community_conversations_unique_pair unique (user_a_id, user_b_id)
);

alter table community_conversations enable row level security;
create index if not exists idx_community_conversations_user_a on community_conversations(user_a_id);
create index if not exists idx_community_conversations_user_b on community_conversations(user_b_id);

create table if not exists community_direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references community_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

alter table community_direct_messages enable row level security;
create index if not exists idx_community_dm_conversation on community_direct_messages(conversation_id, created_at desc);
create index if not exists idx_community_dm_sender on community_direct_messages(sender_id);

-- Mantiene community_conversations.updated_at al día con el último mensaje
-- real -- así "Mensajes" puede ordenar por actividad reciente sin un JOIN
-- costoso en cada listado.
create or replace function bump_community_conversation_updated_at() returns trigger as $$
begin
  update community_conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_bump_community_conversation on community_direct_messages;
create trigger trg_bump_community_conversation
  after insert on community_direct_messages
  for each row execute function bump_community_conversation_updated_at();

drop trigger if exists trg_community_dm_updated_at on community_direct_messages;
create trigger trg_community_dm_updated_at
  before update on community_direct_messages
  for each row execute function set_actualizado_en_orders();
