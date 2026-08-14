-- Ejecutar en Supabase > SQL Editor.
-- Bug real confirmado 14/08: con dos procesos del motor corriendo a la vez
-- (restart de Railway que no mato limpio el proceso viejo), cada operacion
-- de la maestra se copiaba DOS VECES a la cuenta destino -- el chequeo de
-- "ya copiado" solo vivia en memoria de cada proceso, nunca protegia entre
-- procesos distintos. Ya se arreglo el codigo (reclamo atomico a nivel de
-- base de datos antes de ejecutar la orden real), pero hace falta:
-- 1) limpiar las filas duplicadas que ya quedaron en historial_operaciones
-- 2) agregar la restriccion unique que hace el fix nuevo -- sin esto el
--    codigo nuevo no tiene nada real que lo proteja.

-- Paso 1: por cada (cuenta_id, ticket_maestra) duplicado, se queda la fila
-- mas reciente (mayor fecha_apertura) y se borran las demas.
delete from historial_operaciones a
using historial_operaciones b
where a.cuenta_id = b.cuenta_id
  and a.ticket_maestra = b.ticket_maestra
  and a.ticket_maestra is not null
  and a.fecha_apertura < b.fecha_apertura;

-- Paso 2: la restriccion real que impide que esto vuelva a pasar, incluso
-- si en el futuro hay mas de un proceso corriendo a la vez otra vez.
alter table historial_operaciones
  add constraint historial_operaciones_cuenta_ticket_maestra_key
  unique (cuenta_id, ticket_maestra);

-- Mismo problema, misma solucion, para las pendientes (LIMIT/STOP) --
-- confirmado sin duplicados todavia asi que no hace falta un paso de
-- limpieza previo para esta tabla.
alter table tickerall_pendientes_copiadas
  add constraint tickerall_pendientes_copiadas_cuenta_ticket_maestra_key
  unique (cuenta_id, ticket_maestra);
