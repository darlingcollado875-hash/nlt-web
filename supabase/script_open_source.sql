-- ══════════════════════════════════════════════════════════════════
-- NLT Script — código abierto gratis vs. protegido (plan Charts Trader). ADITIVO.
-- ast       = el script ya compilado (JSON) que el creador manda al guardar; es lo ÚNICO que se entrega de un script protegido.
-- protected = true si se vende o se comparte en privado: a quien lo usa NO se le entrega el texto.
-- ══════════════════════════════════════════════════════════════════
alter table public.user_scripts add column if not exists ast jsonb;
alter table public.user_scripts add column if not exists protected boolean not null default false;
-- Lo que ya estaba a la venta o compartido en privado pasa a protegido (nunca se entrega su texto).
update public.user_scripts set protected = true where price_usd is not null or id in (select script_id from public.script_grants);
