-- Ejecutar en Supabase > SQL Editor.
-- Workspace NLT: claves de recordatorios de la Agenda ya enviados por Web Push (con la página
-- cerrada). El servidor "reclama" la clave antes de enviar (insert ignorando duplicados), así
-- cada recordatorio sale una sola vez aunque haya varias instancias o un reinicio.
-- RLS: mismo patrón deny-por-defecto (sin políticas); solo accede NLT_API (service_role).
-- Las claves de más de 7 días las borra el propio servidor.
create table if not exists coordina_recordatorios_enviados (
  clave text primary key,
  enviado_en timestamptz not null default now()
);
alter table coordina_recordatorios_enviados enable row level security;
create index if not exists idx_coordina_recordatorios_enviado on coordina_recordatorios_enviados(enviado_en);
