-- Ejecutar en Supabase > SQL Editor.
-- Historial de envíos masivos (Admin Center -> Notificaciones): un anuncio a todos los usuarios por correo,
-- notificación dentro de NLT y/o push. El id lo genera el panel al abrir el formulario: así repetir el envío
-- (doble clic, reintento) NO lo vuelve a mandar. RLS: mismo patrón deny-por-defecto (sin políticas); solo accede
-- NLT_API (service_role), que exige el permiso "notificaciones".
create table if not exists admin_broadcasts (
  id uuid primary key,
  created_by text not null,
  titulo text not null,
  mensaje text not null,
  asunto text,
  cta_texto text,
  cta_url text,
  canales jsonb not null default '{}',
  destinatarios integer not null default 0,
  estado text not null default 'enviando' check (estado in ('enviando', 'completado', 'con_errores', 'fallido')),
  email_enviados integer not null default 0,
  email_fallidos integer not null default 0,
  notificaciones integer not null default 0,
  push_dispositivos integer not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table admin_broadcasts enable row level security;
create index if not exists idx_admin_broadcasts_created on admin_broadcasts(created_at desc);
create index if not exists idx_admin_broadcasts_estado on admin_broadcasts(estado) where estado = 'enviando';
