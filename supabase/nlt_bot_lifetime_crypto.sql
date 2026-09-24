-- Ejecutar en Supabase > SQL Editor -- NO ejecutado todavía (fase de
-- implementación local, ver informe de la sesión). Habilita el catálogo de
-- NLT Bot Supreme (mensual + 2 planes Lifetime) y el soporte mínimo de
-- 'one_time' + pago crypto directo (V1 manual, SIN monitor on-chain).
--
-- Principio seguido en todo este archivo: ampliar CHECK constraints
-- existentes (patrón aditivo ya usado en elite_signals.sql/pay2commerce.sql)
-- y reutilizar columnas existentes (`payment_reference` para el TX hash) en
-- vez de inventar una arquitectura de pagos nueva. La única columna nueva es
-- `network`, porque no hay ninguna existente que sirva para eso.

-- --- 1. plans.producto -- agregar 'nlt_bot' (mismo patrón que elite_signals.sql) ---
alter table plans drop constraint if exists plans_producto_check;
alter table plans add constraint plans_producto_check
  check (producto in ('copy_system', 'indicator', 'academy', 'community', 'elite_signals', 'nlt_bot'));

-- --- 2. orders.billing_period -- agregar 'one_time' ---
-- Requisito real, no cosmético: sin esto, crear una orden Lifetime con
-- billing_period='one_time' es rechazada por Postgres antes de llegar a
-- ningún código Python. Confirmado real que hoy NUNCA se usó 'one_time' acá
-- (las 11 órdenes reales de planes one_time -- ACADEMY_BASIC/
-- INDICATOR_LIFETIME/ELITE_SIGNALS_ONETIME -- tienen billing_period='monthly'
-- guardado, un workaround preexistente, no un comportamiento a imitar).
alter table orders drop constraint if exists orders_billing_period_check;
alter table orders add constraint orders_billing_period_check
  check (billing_period in ('monthly', 'yearly', 'one_time'));

-- --- 3. subscriptions_v2.billing_period -- mismo motivo que el punto 2 ---
-- activar_pago() guarda orden["billing_period"] tal cual en subscriptions_v2
-- (ver datos_sub en orders.py) -- sin este cambio, confirmar un pago
-- Lifetime fallaría en el UPSERT de subscriptions_v2, no solo en el INSERT
-- de orders.
alter table subscriptions_v2 drop constraint if exists subscriptions_v2_billing_period_check;
alter table subscriptions_v2 add constraint subscriptions_v2_billing_period_check
  check (billing_period in ('monthly', 'yearly', 'one_time'));

-- --- 4. orders.network -- única columna nueva de este archivo ---
-- Nullable: solo se usa en órdenes de pago crypto directo (hoy, únicamente
-- NLT Bot Supreme Lifetime). Nunca se guarda ninguna wallet privada acá --
-- solo la red elegida por el cliente (BSC|TRON), la dirección pública de
-- destino se resuelve en el backend desde config (CRYPTO_WALLET_BSC/TRON),
-- nunca desde esta columna ni desde el cliente.
alter table orders add column if not exists network text;
alter table orders drop constraint if exists orders_network_check;
alter table orders add constraint orders_network_check
  check (network is null or network in ('BSC', 'TRON'));

-- El TX hash que el admin verifica a mano se guarda reutilizando la columna
-- YA existente `payment_reference` (mismo campo que ya usa Pay2Commerce para
-- guardar su invoice_id) -- se etiqueta como "TX Hash" en la UI del admin
-- cuando payment_provider='crypto_manual', sin agregar una columna nueva
-- para esto.

-- --- 5. Catálogo NLT Bot Supreme -- los 3 planes, TODOS activo=false ---
-- No se activan en esta migración a propósito (R2/installer/descarga real
-- todavía no están listos, ver auditoría comercial previa). Activarlos es
-- un UPDATE separado, posterior, cuando todo lo demás esté probado.
insert into plans (id, producto, nombre, descripcion, precio, billing_period, max_cuentas, popular, activo, orden) values
  ('NLT_BOT_MONTHLY', 'nlt_bot', 'NLT Bot Supreme', 'Trading automatizado, licencia protegida. 1 cuenta.', 50.00, 'monthly', 1, true, false, 1),
  ('NLT_BOT_LIFETIME', 'nlt_bot', 'NLT Bot Supreme -- Lifetime', 'Acceso de por vida, 1 cuenta. Pago único vía USDT.', 250.00, 'one_time', 1, false, false, 2),
  ('NLT_BOT_2_ACCOUNTS_LIFETIME', 'nlt_bot', 'NLT Bot Supreme -- Lifetime 2 Cuentas', 'Acceso de por vida, 2 cuentas. Pago único vía USDT.', 300.00, 'one_time', 2, false, false, 3)
on conflict (id) do nothing;
