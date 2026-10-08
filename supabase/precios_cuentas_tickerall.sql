-- ══════════════════════════════════════════════════════════════════
-- Precios por cuenta conectada (TickerAll cobra US$4 por cada cuenta real y US$0.99 más por "always hot").
--   Costo por cuenta = 4.00 + 0.99 = 4.99 USD/mes.  Antes: Charts Trader 10 USD por 3 cuentas (3.33 por cuenta: ¡por debajo del costo!)
--   y Copy System entre 5.00 (Starter) y 2.00 (Business) por cuenta.
-- Ahora cada plan deja margen positivo y baja el precio por cuenta al subir el volumen:
--   Charts Trader   1 cuenta   10.00   (margen 5.01)
--   Copy Starter    1 cuenta   10.00   (margen 5.01)
--   Copy Trader     3 cuentas  27.00   (9.00 por cuenta;  margen 12.03)
--   Copy Pro        5 cuentas  42.00   (8.40 por cuenta;  margen 17.05)
--   Copy Elite     10 cuentas  79.00   (7.90 por cuenta;  margen 29.10)
--   Copy Business  25 cuentas 175.00   (7.00 por cuenta;  margen 50.25)
-- Solo cambia el catálogo para compras NUEVAS: las suscripciones activas conservan los límites con los que se compraron.
-- Valores anteriores (por si hay que volver): CHARTS_TRADER_MONTHLY 10.00/3 · STARTER 9.99/2 · TRADER 19.99/5 · PRO 34.99/10 · ELITE 59.99/25 · BUSINESS 99.99/50
-- ══════════════════════════════════════════════════════════════════
update public.plans set precio = 10.00, max_cuentas = 1, updated_at = now(),
  features = '["Conecta 1 cuenta MT5 real","Opera desde el gráfico: compra, venta, SL/TP y cierre","Lote calculado según tu riesgo","Vende tus indicadores (NLT Script) con el código oculto","Comparte indicadores en privado con quien tú elijas"]'::jsonb
where id = 'CHARTS_TRADER_MONTHLY';

update public.plans set precio = 10.00, max_cuentas = 1, updated_at = now(),
  features = '["Copiado automático","Dashboard","Historial de operaciones","Gestión básica de cuentas","Soporte básico","1 cuenta MT5"]'::jsonb
where id = 'STARTER';

update public.plans set precio = 27.00, max_cuentas = 3, updated_at = now(),
  features = '["Todo Starter","Multiplicador de lotaje","Configuración de riesgo","Filtros de símbolos","Hasta 3 cuentas MT5"]'::jsonb
where id = 'TRADER';

update public.plans set precio = 42.00, max_cuentas = 5, updated_at = now(),
  features = '["Todo Trader","Configuraciones avanzadas","Prioridad de ejecución","Logs detallados","Soporte prioritario","Hasta 5 cuentas MT5"]'::jsonb
where id = 'PRO';

update public.plans set precio = 79.00, max_cuentas = 10, updated_at = now(),
  features = '["Todo Pro","Mayor prioridad","Configuraciones avanzadas","Soporte prioritario","Hasta 10 cuentas MT5"]'::jsonb
where id = 'ELITE';

update public.plans set precio = 175.00, max_cuentas = 25, updated_at = now(),
  features = '["Todo Elite","Hasta 25 cuentas MT5","Máxima prioridad","Soporte prioritario","Diseñado para traders con múltiples cuentas/comunidades pequeñas"]'::jsonb
where id = 'BUSINESS';
