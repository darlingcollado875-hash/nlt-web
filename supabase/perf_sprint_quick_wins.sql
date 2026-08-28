-- NLT Performance Sprint -- Fase 1 (bloque de menor riesgo, aprobado por el
-- usuario): índices reales + fix de RLS initplan. Ejecutar en Supabase >
-- SQL Editor (o vía MCP apply_migration).
--
-- NADA de esto cambia comportamiento -- son optimizaciones puras:
-- 1) índices nuevos, cada uno justificado con una query/cascada real
--    (ver docstring de cada bloque), nunca "porque el advisor lo marcó";
-- 2) las políticas RLS quedan con la MISMA lógica, solo evitando que
--    auth.uid()/auth.jwt() se re-evalúen fila por fila (patrón estándar
--    documentado por Supabase: envolver en "select ...").

-- =====================================================================
-- 1) ÍNDICES -- solo los FKs con uso real confirmado en repository.py
--    (de los 45 que marca el advisor, la mayoría no tienen ningún
--    .eq()/.in_() real contra esa columna hoy -- no se indexan a ciegas)
-- =====================================================================

-- community_comments.user_id: filtrado real en el rate-limit de comentarios
-- (repository.py, verificar_rate_limit_comentario -- corre en CADA comentario nuevo).
create index if not exists idx_community_comments_user_id on community_comments(user_id);

-- community_reactions.user_id: filtrado real al sacar una reacción propia
-- (repository.py:1275, quitar_reaccion -- corre en cada toggle de reacción).
create index if not exists idx_community_reactions_user_id on community_reactions(user_id);

-- community_notifications.post_id / comment_id: ON DELETE CASCADE real.
-- Borrar un post o comentario propio es una función ya usada en producción
-- (ver "Fix: borrar un post propio..." en el historial) -- sin índice,
-- cada borrado escanea toda la tabla de notificaciones para el cascade.
create index if not exists idx_community_notifications_post_id on community_notifications(post_id);
create index if not exists idx_community_notifications_comment_id on community_notifications(comment_id);

-- agreement_signatures.team_member_id: filtrado real en CADA intento de
-- firma (repository.py:1763, chequeo de idempotencia antes de firmar).
create index if not exists idx_agreement_signatures_team_member_id on agreement_signatures(team_member_id);

-- cuentas_futures.user_id: filtrado real al listar/borrar cuentas propias
-- (repository.py:476, 487).
create index if not exists idx_cuentas_futures_user_id on cuentas_futures(user_id);

-- journal_playbooks.user_id: filtrado real al listar playbooks propios
-- (repository.py:2317).
create index if not exists idx_journal_playbooks_user_id on journal_playbooks(user_id);

-- tool_favorites.tool_id: filtrado real al quitar un favorito
-- (repository.py:946).
create index if not exists idx_tool_favorites_tool_id on tool_favorites(tool_id);

-- cuentas_mt5.user_id: BONUS encontrado al verificar el resultado -- el
-- advisor original no lo había marcado, pero una consulta directa a
-- pg_indexes confirmó que esta tabla (la más consultada de Copy System --
-- dashboard, cuentas, maestra, historial la filtran por user_id) solo
-- tenía índice en su PK. La más valiosa de las 9.
create index if not exists idx_cuentas_mt5_user_id on cuentas_mt5(user_id);


-- =====================================================================
-- 2) RLS INITPLAN -- 25 políticas reales, wrap auth.uid()/auth.jwt() en
--    subquery escalar para que Postgres las evalúe UNA vez por query en
--    vez de una vez por fila (fix documentado por Supabase, mismo patrón
--    para las 25, lógica 100% idéntica -- solo el envoltorio cambia).
-- =====================================================================

-- --- cuentas_mt5 ---------------------------------------------------
-- Bonus encontrado en el camino (no es initplan, es "multiple_permissive_
-- policies"): esta tabla tenía 2 policies por acción -- un par viejo
-- ("Los usuarios...") de antes de agregar el bypass de admin, y un par
-- nuevo ("... propio o admin") que ya cubre exactamente lo mismo MÁS el
-- admin. El viejo es 100% redundante (mismo where, subconjunto estricto
-- del nuevo) -- se DROPEA en vez de reescribirlo, nunca se deja doble
-- trabajo por fila para el mismo resultado.
drop policy if exists "Los usuarios ven solo sus cuentas" on cuentas_mt5;
drop policy if exists "Los usuarios insertan sus propias cuentas" on cuentas_mt5;
drop policy if exists "Los usuarios modifican sus cuentas" on cuentas_mt5;
drop policy if exists "Permitir eliminación de cuentas propias" on cuentas_mt5;

drop policy if exists "select propio o admin" on cuentas_mt5;
create policy "select propio o admin" on cuentas_mt5 for select
  using ((select auth.uid()) = user_id or (select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com');

drop policy if exists "insert propio" on cuentas_mt5;
create policy "insert propio" on cuentas_mt5 for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "update propio o admin" on cuentas_mt5;
create policy "update propio o admin" on cuentas_mt5 for update
  using ((select auth.uid()) = user_id or (select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com');

drop policy if exists "delete propio o admin" on cuentas_mt5;
create policy "delete propio o admin" on cuentas_mt5 for delete
  using ((select auth.uid()) = user_id or (select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com');

-- --- perfiles --------------------------------------------------------
drop policy if exists "select propio o admin" on perfiles;
create policy "select propio o admin" on perfiles for select
  using ((select auth.uid()) = user_id or (select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com');

drop policy if exists "insert propio en free" on perfiles;
create policy "insert propio en free" on perfiles for insert
  with check ((select auth.uid()) = user_id and plan = 'free');

drop policy if exists "update solo admin" on perfiles;
create policy "update solo admin" on perfiles for update
  using ((select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com')
  with check ((select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com');

-- --- solicitudes_plan --------------------------------------------------
drop policy if exists "insert propia" on solicitudes_plan;
create policy "insert propia" on solicitudes_plan for insert
  with check ((select auth.uid()) = user_id and estado = 'pendiente');

drop policy if exists "select propia o admin" on solicitudes_plan;
create policy "select propia o admin" on solicitudes_plan for select
  using ((select auth.uid()) = user_id or (select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com');

drop policy if exists "update solo admin" on solicitudes_plan;
create policy "update solo admin" on solicitudes_plan for update
  using ((select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com')
  with check ((select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com');

-- --- historial_operaciones ---------------------------------------------
drop policy if exists "select propio o admin" on historial_operaciones;
create policy "select propio o admin" on historial_operaciones for select
  using ((select auth.uid()) = user_id or (select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com');

-- --- subscriptions -------------------------------------------------------
drop policy if exists "select propio o admin" on subscriptions;
create policy "select propio o admin" on subscriptions for select
  using ((select auth.uid()) = user_id or (select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com');

drop policy if exists "update solo admin" on subscriptions;
create policy "update solo admin" on subscriptions for update
  using ((select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com')
  with check ((select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com');

-- --- cuentas_futures -------------------------------------------------------
drop policy if exists "select propio o admin" on cuentas_futures;
create policy "select propio o admin" on cuentas_futures for select
  using ((select auth.uid()) = user_id or (select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com');

-- --- tickerall_pendientes_copiadas -----------------------------------------
drop policy if exists "select propio o admin" on tickerall_pendientes_copiadas;
create policy "select propio o admin" on tickerall_pendientes_copiadas for select
  using ((select auth.uid()) = user_id or (select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com');

-- --- tablas con policy vía EXISTS contra cuentas_mt5/cuentas_futures -------
-- (account_connections, cuenta_ordenes, cuenta_posiciones, trade_events
-- referencian cuentas_mt5; futures_posiciones/futures_eventos referencian
-- cuentas_futures -- misma lógica exacta, solo el subquery interno cambia
-- de auth.uid() a (select auth.uid())).

drop policy if exists "select propio o admin" on account_connections;
create policy "select propio o admin" on account_connections for select
  using (exists (
    select 1 from cuentas_mt5 c
    where c.id = account_connections.cuenta_id
      and (c.user_id = (select auth.uid()) or (select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com')
  ));

drop policy if exists "select propio o admin" on cuenta_ordenes;
create policy "select propio o admin" on cuenta_ordenes for select
  using (exists (
    select 1 from cuentas_mt5 c
    where c.id = cuenta_ordenes.cuenta_id
      and (c.user_id = (select auth.uid()) or (select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com')
  ));

drop policy if exists "select propio o admin" on cuenta_posiciones;
create policy "select propio o admin" on cuenta_posiciones for select
  using (exists (
    select 1 from cuentas_mt5 c
    where c.id = cuenta_posiciones.cuenta_id
      and (c.user_id = (select auth.uid()) or (select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com')
  ));

drop policy if exists "select propio o admin" on trade_events;
create policy "select propio o admin" on trade_events for select
  using (exists (
    select 1 from cuentas_mt5 c
    where c.id = trade_events.cuenta_id
      and (c.user_id = (select auth.uid()) or (select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com')
  ));

drop policy if exists "select propio o admin" on futures_posiciones;
create policy "select propio o admin" on futures_posiciones for select
  using (exists (
    select 1 from cuentas_futures c
    where c.id = futures_posiciones.cuenta_id
      and (c.user_id = (select auth.uid()) or (select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com')
  ));

drop policy if exists "select propio o admin" on futures_eventos;
create policy "select propio o admin" on futures_eventos for select
  using (exists (
    select 1 from cuentas_futures c
    where c.id = futures_eventos.cuenta_id
      and (c.user_id = (select auth.uid()) or (select auth.jwt()) ->> 'email' = 'darlingcollado875@gmail.com')
  ));
