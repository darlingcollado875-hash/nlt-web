-- Ejecutar en Supabase > SQL Editor.
-- NLT Media Library -- reemplaza el flujo actual de "pegar una URL de texto
-- en ecosystem_content" para videos, por un sistema real de archivos con
-- metadata estructurada. ecosystem_content sigue existiendo tal cual para
-- noticias/texto/imagen (seccion='news' en /news.html) -- no se toca ni se
-- migra, son cosas distintas.
--
-- El archivo en sí NO se guarda en esta tabla (nunca blobs en Postgres) --
-- solo metadata + storage_key/video_url, que apuntan al proveedor real
-- (ver app/integrations/media_storage/, hoy LOCAL, mañana R2/S3).
--
-- RLS: mismo patrón "deny por defecto + policy pública angosta" que
-- plans/ecosystem_content -- solo NLT_API (service_role) escribe; el
-- público solo puede leer videos ya publicados y públicos.

create table if not exists media_assets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text not null default 'other'
    check (category in ('indicator', 'academy', 'community', 'onboarding', 'tutorials', 'updates', 'announcements', 'marketing', 'other')),
  storage_provider text not null,       -- 'LOCAL' | 'R2' | 'S3' -- con qué proveedor se guardó ESTE archivo puntual, para no romper videos viejos si se cambia el proveedor activo más adelante
  storage_key text not null,
  video_url text not null,
  thumbnail_url text,
  duration_seconds int,
  file_size_bytes bigint,
  content_type text,
  status text not null default 'uploading'
    check (status in ('uploading', 'processing', 'ready', 'published', 'failed')),
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
alter table media_assets enable row level security;
create policy "select media publicados publico" on media_assets
  for select using (status = 'published' and visibility = 'public');
create index if not exists idx_media_assets_status on media_assets(status);
create index if not exists idx_media_assets_category on media_assets(category);

drop trigger if exists trg_media_assets_updated_at on media_assets;
create trigger trg_media_assets_updated_at
  before update on media_assets
  for each row execute function set_actualizado_en_orders();

-- Dónde aparece cada video dentro del ecosistema -- tabla puente para que
-- un mismo video pueda estar en varios lugares (ej. Indicator + Academy) y
-- para poder avisar "este video se usa en 3 lugares" antes de borrarlo.
create table if not exists media_placements (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references media_assets(id) on delete cascade,
  placement text not null
    check (placement in ('indicator', 'academy', 'community', 'dashboard', 'onboarding')),
  created_at timestamptz not null default now(),
  unique (media_id, placement)
);
alter table media_placements enable row level security;
create policy "select placements publico" on media_placements for select using (true);
create index if not exists idx_media_placements_media on media_placements(media_id);
create index if not exists idx_media_placements_placement on media_placements(placement);
