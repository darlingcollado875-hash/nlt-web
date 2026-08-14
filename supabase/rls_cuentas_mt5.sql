-- Ejecutar en Supabase > SQL Editor.
-- cuentas_mt5 es anterior a estas reglas: tiene RLS activo pero le faltan
-- las políticas que dejan al dueño ver/editar sus propias cuentas (por eso
-- no aparecían en la web, aunque el motor del backend sí las veía porque usa
-- la service_role key, que siempre ignora RLS).

drop policy if exists "select propio o admin" on cuentas_mt5;
create policy "select propio o admin" on cuentas_mt5 for select
  using (auth.uid() = user_id or auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com');

drop policy if exists "insert propio" on cuentas_mt5;
create policy "insert propio" on cuentas_mt5 for insert
  with check (auth.uid() = user_id);

drop policy if exists "update propio o admin" on cuentas_mt5;
create policy "update propio o admin" on cuentas_mt5 for update
  using (auth.uid() = user_id or auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com');

drop policy if exists "delete propio o admin" on cuentas_mt5;
create policy "delete propio o admin" on cuentas_mt5 for delete
  using (auth.uid() = user_id or auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com');
