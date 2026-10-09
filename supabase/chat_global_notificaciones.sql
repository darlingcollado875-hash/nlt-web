-- Avisos del chat global de Community (aplicado en producción como migración `chat_global_notificaciones`).
-- 1) Tipo nuevo de notificación: chat_global (campana + push); retención 3 días (ver notifications.py).
-- 2) Preferencia por persona para apagar esos avisos.
alter table community_notifications drop constraint if exists community_notifications_type_check;
alter table community_notifications add constraint community_notifications_type_check
  check (type = any (array[
    'comment','reply','reaction','mention','announcement','certificate',
    'new_dm','elite_signal_new','elite_signal_tp','elite_signal_sl','elite_signal_cancelled','elite_signal_expired',
    'academy_lesson_completed','academy_certificate','payment_confirmed','payment_failed','subscription_renewal',
    'subscription_cancelled','promotion','new_feature','partner_application_new','support_message_new','support_reply',
    'trade_copied','checkout_pendiente','reactivacion','guardian_alert',
    'chat_global'
  ]));

create table if not exists community_chat_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notificar boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table community_chat_prefs enable row level security;
alter table community_chat_prefs force row level security;
revoke all on community_chat_prefs from anon, authenticated;
