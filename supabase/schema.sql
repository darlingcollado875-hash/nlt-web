-- Ejecutar manualmente en Supabase > SQL Editor.
-- Crea la tabla de perfiles/planes usada por nlt-web (dashboard, suscripcion.html, admin.html).

create table if not exists perfiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  plan text not null default 'free' check (plan in ('free', 'plan_10', 'plan_60')),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

alter table perfiles enable row level security;

drop policy if exists "select propio o admin" on perfiles;
create policy "select propio o admin" on perfiles for select
  using (auth.uid() = user_id or auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com');

-- Un usuario solo puede crear su propia fila, y siempre en 'free': el plan
-- solo se puede subir desde el panel admin (ver policy de update).
drop policy if exists "insert propio en free" on perfiles;
create policy "insert propio en free" on perfiles for insert
  with check (auth.uid() = user_id and plan = 'free');

-- Solo el admin (verificado por email en el JWT) puede cambiar el plan de cualquier fila.
drop policy if exists "update solo admin" on perfiles;
create policy "update solo admin" on perfiles for update
  using (auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com')
  with check (auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com');

create or replace function set_actualizado_en()
returns trigger as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_perfiles_actualizado_en on perfiles;
create trigger trg_perfiles_actualizado_en
  before update on perfiles
  for each row execute function set_actualizado_en();

-- Solicitudes de upgrade de plan (sin cobro automático todavía: el admin
-- aprueba manualmente desde admin.html, lo que activa el plan en perfiles).
create table if not exists solicitudes_plan (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null,
  email text not null,
  plan_solicitado text not null check (plan_solicitado in ('plan_10', 'plan_60')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  creado_en timestamptz not null default now()
);

alter table solicitudes_plan enable row level security;

drop policy if exists "insert propia" on solicitudes_plan;
create policy "insert propia" on solicitudes_plan for insert
  with check (auth.uid() = user_id and estado = 'pendiente');

drop policy if exists "select propia o admin" on solicitudes_plan;
create policy "select propia o admin" on solicitudes_plan for select
  using (auth.uid() = user_id or auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com');

drop policy if exists "update solo admin" on solicitudes_plan;
create policy "update solo admin" on solicitudes_plan for update
  using (auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com')
  with check (auth.jwt() ->> 'email' = 'darlingcollado875@gmail.com');
