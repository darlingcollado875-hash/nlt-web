-- Una cuenta de NLT Charts (tipo_cuenta = 'CHARTS') puede compartir la sesión de TickerAll con la cuenta MAESTRA del copiador.
-- El copiador NUNCA debe usarla como destino: copiaba cada operación sobre la propia maestra en bucle (aplicado a producción el 06/10/2026).
-- El bloqueo vive en la base para que ningún proceso viejo o duplicado (p. ej. un entorno de staging) pueda saltárselo.
create or replace function public.bloquear_copias_sobre_cuentas_charts() returns trigger language plpgsql as $f$
begin
  if exists (select 1 from public.cuentas_mt5 c where c.id = new.cuenta_id and c.tipo_cuenta = 'CHARTS') then
    raise exception 'El copiador no puede copiar sobre una cuenta de NLT Charts (cuenta_id=%)', new.cuenta_id using errcode = 'P0001';
  end if;
  return new;
end $f$;

create trigger trg_bloquear_copias_charts before insert on public.historial_operaciones
  for each row execute function public.bloquear_copias_sobre_cuentas_charts();
create trigger trg_bloquear_copias_charts before insert on public.tickerall_pendientes_copiadas
  for each row execute function public.bloquear_copias_sobre_cuentas_charts();
