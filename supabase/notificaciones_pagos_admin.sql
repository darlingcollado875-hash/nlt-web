-- Avisos de pagos para el equipo (aplicado en producción como migraciones `notificaciones_pagos_admin` y `notificaciones_pagos_admin_rechazado`).
-- payment_admin_proc: «Procesando pago» · payment_admin_ok: «Pago confirmado» · payment_admin_fail: «Pago rechazado» (ver nlt-api app/services/pagos_admin.py)
alter table community_notifications drop constraint if exists community_notifications_type_check;
alter table community_notifications add constraint community_notifications_type_check
  check (type = any (array[
    'comment','reply','reaction','mention','announcement','certificate',
    'new_dm','elite_signal_new','elite_signal_tp','elite_signal_sl','elite_signal_cancelled','elite_signal_expired',
    'academy_lesson_completed','academy_certificate','payment_confirmed','payment_failed','subscription_renewal',
    'subscription_cancelled','promotion','new_feature','partner_application_new','support_message_new','support_reply',
    'trade_copied','checkout_pendiente','reactivacion','guardian_alert',
    'chat_global',
    'payment_admin_proc','payment_admin_ok','payment_admin_fail'
  ]));
