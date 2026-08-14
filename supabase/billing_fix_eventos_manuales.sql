-- Ejecutar en Supabase > SQL Editor.
-- payment_events.order_id era NOT NULL -- pero una asignación manual de
-- plan por el admin (sin orden ni pago de por medio, ej. cortesía o
-- corrección) no tiene ninguna orden que referenciar. Se permite NULL para
-- poder auditar también esas acciones (quién, cuándo, qué plan), en vez de
-- dejarlas sin registro en la tabla de auditoría.

alter table payment_events alter column order_id drop not null;
