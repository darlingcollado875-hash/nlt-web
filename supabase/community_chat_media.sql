-- Ejecutar en Supabase > SQL Editor.
-- Fase de pulido de UX de Chat General + DMs: imágenes, indicador de
-- "escribiendo...", estados de leído (DM) -- NO cambia nada de acceso,
-- suscripciones, pagos ni arquitectura ya aprobada.
--
-- Bucket privado de Supabase Storage para imágenes de Chat General y DMs.
-- public=false + sin políticas en storage.objects = deny total para
-- anon/authenticated (mismo patrón RLS-deny-by-default que el resto de
-- community_*). El backend (service_role) es la ÚNICA vía real: valida
-- Community activa + participación en la conversación (DM) ANTES de
-- generar una signed URL de corta duración -- nunca una URL pública
-- permanente (ver app/integrations/community_chat_media.py).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-chat-media', 'community-chat-media', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Adjuntos: content pasa a ser opcional (un mensaje puede ser solo una
-- imagen), pero nunca los dos vacíos a la vez.
alter table community_messages alter column content drop not null;
alter table community_messages add column if not exists media_path text;
alter table community_messages add column if not exists media_mime text;
alter table community_messages drop constraint if exists community_messages_contenido_o_media;
alter table community_messages add constraint community_messages_contenido_o_media
  check (coalesce(content, '') <> '' or media_path is not null);

alter table community_direct_messages alter column content drop not null;
alter table community_direct_messages add column if not exists media_path text;
alter table community_direct_messages add column if not exists media_mime text;
alter table community_direct_messages drop constraint if exists community_dm_contenido_o_media;
alter table community_direct_messages add constraint community_dm_contenido_o_media
  check (coalesce(content, '') <> '' or media_path is not null);

-- Estados de leído -- preparado para DMs (1-a-1, semánticamente claro).
-- Chat General no suma un sistema de recibos de lectura por-usuario acá
-- (un chat grupal no tiene una noción limpia de "leído" sin una tabla de
-- lecturas por-usuario-por-mensaje; "enviado" ya es implícito con la
-- persistencia exitosa del POST). Ver reporte final.
alter table community_direct_messages add column if not exists read_at timestamptz;

-- Indicador de "está escribiendo..." -- sin Realtime (no existe en el
-- proyecto, confirmado por auditoría), efímero por diseño: una sola fila
-- por (usuario, scope), sobrescrita en cada heartbeat. scope='chat' para
-- el Chat General, scope='dm:<conversation_id>' para una conversación DM
-- -- texto en vez de 2 columnas nullable para evitar el problema de
-- unicidad con NULL (postgres no deduplica NULLs en un unique compuesto).
create table if not exists community_typing_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null,
  updated_at timestamptz not null default now(),
  constraint community_typing_state_unique unique (user_id, scope)
);

alter table community_typing_state enable row level security;
-- sin policies -- mismo deny-by-default que el resto de community_*.

create index if not exists idx_community_typing_scope on community_typing_state(scope, updated_at desc);
