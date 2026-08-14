-- Ejecutar en Supabase > SQL Editor.
-- cuentas_mt5.estado se creó como varchar(20) en el esquema original de este
-- proyecto (de antes de esta sesión). Los estados reales que introdujimos
-- después (CREDENCIALES_INVALIDAS = 23 caracteres, SERVIDOR_NO_ENCONTRADO =
-- 22) no caben ahí -- cada vez que una cuenta cae en uno de esos estados, la
-- escritura falla con "value too long for type character varying(20)" y
-- tumba el procesamiento de todo el grupo de ese usuario ese ciclo (ni
-- siquiera copia a las demás cuentas sanas). Pasar a `text` (sin límite)
-- evita este límite para siempre, sin necesidad de acordarse de ajustarlo
-- cada vez que se agregue un estado nuevo.

alter table cuentas_mt5 alter column estado type text;
