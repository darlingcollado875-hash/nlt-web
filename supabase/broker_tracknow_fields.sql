-- Ejecutar en Supabase > SQL Editor.
-- Amplia broker_commissions/broker_webhook_events con los campos REALES
-- confirmados de los macros de postback de Tracknow (trigger "Commission
-- Created" del Eightcap Affiliate Portal): {campaign_id}, {campaign_name},
-- {payout_name}, {sub1..sub8}, {utm_source/medium/content}, {comment},
-- {referrer}, {is_first_purchase}, {coupon}, {goal}, {system_id}.
--
-- IMPORTANTE (corrige un bug propio): {amount} (monto de la orden) y
-- {commission} (comisión real del afiliado) son DOS valores distintos en
-- Tracknow -- la columna "amount" ya existente en broker_commissions se
-- venia usando (mal, antes de tener el spec real) para lo que en realidad
-- es la comision. Se agrega "commission_amount" como el valor correcto de
-- comision, y "amount" pasa a representar el monto de la orden.

alter table broker_commissions add column if not exists commission_amount numeric(14,2);
alter table broker_commissions add column if not exists campaign_id_tracknow text;
alter table broker_commissions add column if not exists campaign_name text;
alter table broker_commissions add column if not exists payout_name text;
alter table broker_commissions add column if not exists sub1 text;
alter table broker_commissions add column if not exists sub2 text;
alter table broker_commissions add column if not exists sub3 text;
alter table broker_commissions add column if not exists sub4 text;
alter table broker_commissions add column if not exists sub5 text;
alter table broker_commissions add column if not exists sub6 text;
alter table broker_commissions add column if not exists sub7 text;
alter table broker_commissions add column if not exists sub8 text;
alter table broker_commissions add column if not exists utm_source text;
alter table broker_commissions add column if not exists utm_medium text;
alter table broker_commissions add column if not exists utm_content text;
alter table broker_commissions add column if not exists comment text;
alter table broker_commissions add column if not exists referrer text;
alter table broker_commissions add column if not exists is_first_purchase boolean;
alter table broker_commissions add column if not exists coupon text;
alter table broker_commissions add column if not exists goal text;
alter table broker_commissions add column if not exists system_id text;
alter table broker_commissions add column if not exists creation_date_tracknow text;

-- broker_webhook_events: campaign_id y order_id como columnas propias
-- (además de external_id/client_id que ya existían) -- pedido explicito en
-- Fase 3 para poder filtrar/auditar por campaña sin desempaquetar el JSON.
alter table broker_webhook_events add column if not exists order_id text;
alter table broker_webhook_events add column if not exists campaign_id text;
alter table broker_webhook_events add column if not exists origen_ip text;

create index if not exists idx_broker_commissions_campaign_id_tracknow on broker_commissions(campaign_id_tracknow);
create index if not exists idx_broker_webhook_events_order_id on broker_webhook_events(order_id);
