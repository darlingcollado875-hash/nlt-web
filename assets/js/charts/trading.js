/* NLT Charts -- trading desde el gráfico: interfaz PREPARADA, ejecución APAGADA.
 *
 * Flujo previsto: cuenta NLT -> broker (MT5) -> TickerAll -> órdenes ->
 * posiciones -> SL/TP. Acciones: BUY, SELL, CLOSE, MODIFY.
 *
 * Una Long Position dibujada es un BUY y una Short Position un SELL
 * (drawings.posicionComoOrden). Todo pasa por NLT API: el navegador nunca
 * habla con TickerAll ni ve credenciales. Mientras el servidor diga
 * execution_enabled=false, activo() es false, el botón BUY/SELL de la barra
 * del dibujo queda deshabilitado y enviar() rechaza sin mandar nada. */
(function () {
    // Antes esta interfaz estaba "preparada y apagada". Ahora el BUY/SELL de una Long/Short dibujada abre el ticket de
    // NLT Charts Trader (trader.js) con el lote, el SL y el TP ya cargados: el usuario confirma ahí. El servidor decide
    // si hay plan, cuenta conectada y si la ejecución está encendida.
    const ACCIONES = ['BUY', 'SELL', 'CLOSE', 'MODIFY'];

    async function cargar() { return { execution_enabled: !!(window.NLTCharts && NLTCharts.traderApi && NLTCharts.traderApi.puedeOperar()) }; }

    function ordenDesdePosicion(pos) {
        if (!pos) return null;
        return { action: pos.lado, symbol: pos.simbolo, quantity: pos.cantidad || null, lots: pos.lotes || null, entry: pos.entrada, sl: pos.sl, tp: pos.tp };
    }

    async function enviar(pos) {
        if (!window.NLTCharts || !NLTCharts.traderApi) throw new Error('Operar con tu cuenta todavía no está disponible.');
        const orden = ordenDesdePosicion(pos);
        if (!orden || !ACCIONES.includes(orden.action)) throw new Error('Orden inválida');
        NLTCharts.traderApi.desdePosicion(pos);
        return { opened: true };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.trading = {
        ACCIONES, cargar, ordenDesdePosicion, enviar,
        activo: () => !!(window.NLTCharts && NLTCharts.traderApi),
        estado: () => ({ execution_enabled: !!(window.NLTCharts && NLTCharts.traderApi && NLTCharts.traderApi.puedeOperar()) }),
    };
})();
