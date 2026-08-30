-- Ejecutar en Supabase > SQL Editor.
-- NLT General Agreements -- segundo tipo de acuerdo, para colaboradores
-- generales (reciben acceso gratis a herramientas mientras mantengan una
-- relación activa con NLT), separado del Founder Agreement existente
-- ("Acuerdo Marco", slug 'nlt-agreement').
--
-- 100% aditivo sobre team_agreements.sql -- ninguna tabla nueva, ninguna
-- fila existente reclasificada a mano. La separación real Founder/General
-- vive en el backend (ver app/api/routes/agreements.py::_exigir_acceso_founder),
-- no acá -- RLS sigue deny-by-default sin policies, mismo patrón que el
-- resto del proyecto (el service_role de NLT_API es el único punto de
-- autorización real).

alter table agreements
  add column if not exists agreement_type text not null default 'FOUNDER'
  check (agreement_type in ('FOUNDER','GENERAL'));
-- El default 'FOUNDER' es lo que hace esto seguro para la fila ya existente
-- (slug='nlt-agreement') -- queda clasificada correctamente sin ningún
-- UPDATE manual. Cualquier familia NUEVA que se cree de acá en más debe
-- especificar el tipo explícitamente (ver AgreementCrear en
-- app/models/agreements.py, que por eso default a 'GENERAL' -- el default
-- de la COLUMNA protege lo viejo, el default del MODELO protege lo nuevo).

create index if not exists idx_agreements_type on agreements(agreement_type);

-- Migración de datos puntual: Jorge Josué Alvarez Mejia (jrgxchubi@gmail.com)
-- es hoy el único no-super-admin con los permisos administrativos completos
-- de agreements.* (create/publish/archive/view_all_signatures/download) --
-- sin este flag, perdería la capacidad de administrar el Founder Agreement
-- que ya tiene hoy. No es una persona nueva ni un permiso fabricado: es un
-- flag agregado a una fila real ya existente, para preservar su capacidad
-- actual bajo el modelo de autorización más estricto que introduce este
-- cambio (ver TEAM_PERMISSIONS en app/core/team_permissions.py).
update team_members
set permissions = permissions || '{"agreements.founder": true}'::jsonb
where email = 'jrgxchubi@gmail.com';
