-- Llamadas de voz y compartir pantalla de Community (ver nlt-api app/services/community_calls.py).
-- El audio y la pantalla viajan directo entre los navegadores (WebRTC); acá solo vive quién está en la llamada y las "señales" de conexión.
-- RLS activado SIN políticas a propósito: solo el backend (service role) toca estas tablas.

create table if not exists community_calls (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global','dm')),
  conversation_id uuid references community_conversations(id) on delete cascade,
  started_by uuid not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint community_calls_dm_tiene_conversacion check ((scope = 'dm') = (conversation_id is not null))
);
-- una sola llamada abierta: una global, y una por conversación privada
create unique index if not exists community_calls_global_abierta on community_calls (scope) where ended_at is null and scope = 'global';
create unique index if not exists community_calls_dm_abierta on community_calls (conversation_id) where ended_at is null and scope = 'dm';

create table if not exists community_call_participants (
  call_id uuid not null references community_calls(id) on delete cascade,
  user_id uuid not null,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  left_at timestamptz,
  muted boolean not null default false,
  sharing boolean not null default false,
  primary key (call_id, user_id)
);

create table if not exists community_call_signals (
  id bigserial primary key,
  call_id uuid not null references community_calls(id) on delete cascade,
  from_user uuid not null,
  to_user uuid not null,
  kind text not null check (kind in ('offer','answer','ice')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists community_call_signals_destino on community_call_signals (call_id, to_user, id);

alter table community_calls enable row level security;
alter table community_call_participants enable row level security;
alter table community_call_signals enable row level security;

-- Tipos de notificación nuevos: call_global («X inició una llamada grupal») y call_dm («X te está llamando»)
alter table community_notifications drop constraint if exists community_notifications_type_check;
alter table community_notifications add constraint community_notifications_type_check
  check (type = any (array[
    'comment','reply','reaction','mention','announcement','certificate',
    'new_dm','elite_signal_new','elite_signal_tp','elite_signal_sl','elite_signal_cancelled','elite_signal_expired',
    'academy_lesson_completed','academy_certificate','payment_confirmed','payment_failed','subscription_renewal',
    'subscription_cancelled','promotion','new_feature','partner_application_new','support_message_new','support_reply',
    'trade_copied','checkout_pendiente','reactivacion','guardian_alert',
    'chat_global',
    'payment_admin_proc','payment_admin_ok','payment_admin_fail',
    'call_global','call_dm'
  ]));
