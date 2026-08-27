-- NLT Global Notification Center (Fase 2 del pedido) -- amplía
-- community_notifications (ya en producción, con datos reales) para que
-- sirva como infraestructura CENTRAL de notificaciones de todo NLT, en vez
-- de crear una tabla nueva. 100% aditivo: ninguna columna existente se
-- borra ni se renombra, post_id/comment_id siguen intactos para Community,
-- y los 4 tipos ya usados (comment/reply/reaction/mention) no cambian.
--
-- Campos nuevos:
--   title          -- nullable; los 4 tipos viejos de Community no lo usan
--                     (el frontend ya arma su propio texto a partir de
--                     `message`), los tipos nuevos SÍ lo traen.
--   metadata       -- jsonb, default '{}' -- payload libre por tipo
--                     (symbol/direction/quality_score para Elite Signals,
--                     etc). Tratado siempre como texto seguro en el
--                     frontend, nunca innerHTML.
--   resource_type  -- nullable, SIN foreign key a propósito (post_id/
--                     comment_id ya cubren Community con FK real; esto es
--                     solo un puntero informativo para que el frontend
--                     sepa a qué página navegar al hacer click).
--   resource_id    -- nullable, acompaña a resource_type.
--   read_at        -- nullable timestamptz -- corre en paralelo a `read`
--                     (que se queda igual, con su índice parcial intacto);
--                     marcar_notificacion_leida ahora setea ambos a la vez.
--   expires_at     -- nullable -- política de retención (Fase 11): no se
--                     borra nada ahora, solo se deja el campo listo para
--                     un cleanup futuro. Los tipos nuevos lo poblan con un
--                     horizonte razonable (ver notifications.py); los 4
--                     tipos viejos de Community se quedan en NULL (sin
--                     cambio de comportamiento).

alter table community_notifications
  add column if not exists title text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists resource_type text,
  add column if not exists resource_id text,
  add column if not exists read_at timestamptz,
  add column if not exists expires_at timestamptz;

-- Amplía el CHECK de `type` -- se agregan los tipos de los eventos reales
-- que se conectan ahora (new_dm, elite_signal_*, academy_*,
-- payment_confirmed) MÁS los que el pedido pide dejar preparados para
-- cuando exista el evento real correspondiente (payment_failed,
-- subscription_renewal, subscription_cancelled, promotion, new_feature) --
-- ninguno de estos últimos se dispara desde ningún código todavía.
alter table community_notifications drop constraint if exists community_notifications_type_check;
alter table community_notifications add constraint community_notifications_type_check
  check (type = any (array[
    -- ya existían, sin cambios de comportamiento
    'comment', 'reply', 'reaction', 'mention', 'announcement', 'certificate',
    -- conectados ahora (eventos reales)
    'new_dm', 'elite_signal_new', 'elite_signal_tp', 'elite_signal_sl',
    'elite_signal_cancelled', 'elite_signal_expired',
    'academy_lesson_completed', 'academy_certificate', 'payment_confirmed',
    -- preparados, sin trigger todavía (Fase 9: "no inventar triggers")
    'payment_failed', 'subscription_renewal', 'subscription_cancelled', 'promotion', 'new_feature'
  ]));

-- Índice de soporte para el nuevo puntero de recurso (opcional, liviano --
-- solo se usa si en el futuro se necesita "todas las notificaciones sobre
-- tal recurso", no es parte de ningún query actual, pero es barato tenerlo).
create index if not exists idx_notifications_resource on community_notifications (resource_type, resource_id) where resource_type is not null;
