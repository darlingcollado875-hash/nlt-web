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
    const ACCIONES = ['BUY', 'SELL', 'CLOSE', 'MODIFY'];
    let estado = { execution_enabled: false, reason: 'La ejecución real desde NLT Charts todavía no está activada.' };

    async function cargar() {
        try {
            if (window.NLT_API && NLT_API.chartsTradingEstado) estado = await NLT_API.chartsTradingEstado();
        } catch (_) { /* sin estado del servidor = apagado */ }
        return estado;
    }

    // Posición del gráfico -> orden en el formato de /charts/trading/orders.
    function ordenDesdePosicion(pos, cuentaId) {
        if (!pos) return null;
        return {
            action: pos.lado, symbol: pos.simbolo, account_id: cuentaId || null,
            quantity: pos.cantidad || null, entry: pos.entrada, sl: pos.sl, tp: pos.tp,
        };
    }

    async function enviar(pos, cuentaId) {
        if (!estado.execution_enabled) throw new Error(estado.reason || 'Ejecución no activada');
        const orden = ordenDesdePosicion(pos, cuentaId);
        if (!orden || !ACCIONES.includes(orden.action)) throw new Error('Orden inválida');
        return NLT_API.chartsTradingOrden(orden);
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.trading = {
        ACCIONES, cargar, ordenDesdePosicion, enviar,
        activo: () => !!estado.execution_enabled,
        estado: () => ({ ...estado }),
    };
})();
