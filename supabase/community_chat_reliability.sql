-- NLT Community -- Fase "Reliability + Reply + Typing Premium".
-- 100% aditivo: ninguna columna existente se toca, los mensajes viejos
-- (client_message_id NULL) siguen funcionando exactamente igual --
-- Postgres trata NULL como distinto de NULL en un UNIQUE, así que un
-- UNIQUE(user_id, client_message_id) NO choca entre filas viejas sin
-- client_message_id, solo protege reintentos reales del mismo envío.

-- 1) Idempotencia de envío (Parte 1) -- UUID generado por el CLIENTE por
-- cada intento lógico de envío (no por el contenido: dos mensajes
-- idénticos con distinto client_message_id siguen siendo 2 mensajes reales,
-- pedido explícito).
alter table community_messages
  add column if not exists client_message_id uuid;
alter table community_messages
  add constraint community_messages_client_id_unique unique (user_id, client_message_id);

alter table community_direct_messages
  add column if not exists client_message_id uuid;
alter table community_direct_messages
  add constraint community_dm_client_id_unique unique (conversation_id, sender_id, client_message_id);

-- 2) Reply to Message en DM (Parte 2) -- community_messages (Chat General)
-- YA tenía reply_to_id (con FK real, ON DELETE SET NULL); acá se agrega el
-- MISMO patrón a community_direct_messages, nunca una arquitectura nueva.
-- La validación de "reply_to_id debe pertenecer a la MISMA conversation_id"
-- vive en la capa de aplicación (community_dm.py), no en el schema --
-- mismo criterio que el resto de este proyecto (el backend es la única
-- autoridad real, nunca solo una constraint de DB).
alter table community_direct_messages
  add column if not exists reply_to_id uuid references community_direct_messages(id) on delete set null;

create index if not exists idx_community_messages_reply_to on community_messages (reply_to_id) where reply_to_id is not null;
create index if not exists idx_community_dm_reply_to on community_direct_messages (reply_to_id) where reply_to_id is not null;
