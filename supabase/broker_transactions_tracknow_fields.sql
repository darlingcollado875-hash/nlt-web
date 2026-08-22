-- Ejecutar en Supabase > SQL Editor.
-- Amplia broker_transactions con los campos reales confirmados del schema
-- oficial de Tracknow (ForexTransactionApiDto, GET /financial/transactions):
-- profit, volume, symbol, accountCurrency, affiliateCommission, ademas de
-- los ya existentes (external_id, client_id, transaction_type, amount, status).

alter table broker_transactions add column if not exists profit numeric(14,2);
alter table broker_transactions add column if not exists volume numeric(14,2);
alter table broker_transactions add column if not exists symbol text;
alter table broker_transactions add column if not exists account_currency text;
alter table broker_transactions add column if not exists affiliate_commission numeric(14,2);
alter table broker_transactions add column if not exists transaction_date_tracknow text;
