-- Ejecutar en Supabase > SQL Editor.
-- Chat privado de NLT Community -- ver auditoría: acceso = "cualquier
-- producto activo del ecosistema" (subscriptions_v2 sin filtrar producto +
-- indicator_orders.status='active', ver membership_access.py::tiene_community_activa).
--
-- RLS: mismo patrón EXACTO que community_posts/community_comments (ya
-- confirmado en producción: RLS activado, CERO políticas para anon/
-- authenticated). El service_role de NLT_API bypassea RLS -- toda la
-- autorización real (¿tiene Community activa? ¿es su propio mensaje? ¿es
-- admin?) vive en FastAPI, nunca en política de Postgres. No se inventa
-- un mecanismo nuevo de seguridad -- se replica el que ya existe.

create table if not exists community_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  reply_to_id uuid references community_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

alter table community_messages enable row level security;
-- sin policies de select/insert/update/delete para authenticated/anon =>
-- deny total, igual que el resto de community_*.

create index if not exists idx_community_messages_created on community_messages(created_at desc);
create index if not exists idx_community_messages_user on community_messages(user_id);
create index if not exists idx_community_messages_reply_to on community_messages(reply_to_id) where reply_to_id is not null;

drop trigger if exists trg_community_messages_updated_at on community_messages;
create trigger trg_community_messages_updated_at
  before update on community_messages
  for each row execute function set_actualizado_en_orders();
