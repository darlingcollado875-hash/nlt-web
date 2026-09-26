/* NLT Charts -- datos de mercado del lado del navegador.
 *
 * El navegador NUNCA habla con un proveedor de precios: todo pasa por el
 * backend (/charts/*), que decide el proveedor, cachea y limita. Este
 * archivo solo traduce la respuesta al formato del motor (KLineData) y
 * mantiene viva la última vela. */
(function () {
    // Timeframe de NLT -> período del motor (KLineChart).
    const PERIODOS = {
        '1m': { type: 'minute', span: 1 },
        '5m': { type: 'minute', span: 5 },
        '15m': { type: 'minute', span: 15 },
        '30m': { type: 'minute', span: 30 },
        '1H': { type: 'hour', span: 1 },
        '4H': { type: 'hour', span: 4 },
        '1D': { type: 'day', span: 1 },
    };
    const LOTE = 500;
    const REFRESCO_MS = 5000;

    const aKline = (c) => ({ timestamp: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v });

    async function velas(symbol, timeframe, { limit = LOTE, end = null, signal } = {}) {
        const r = await NLT_API.chartsVelas(symbol, timeframe, { limit, end, signal });
        return { demo: !!r.demo, provider: r.provider, precision: r.price_precision, velas: r.candles.map(aKline) };
    }

    // Refresca la vela en curso mientras la pestaña está visible. Pide desde
    // la última vela recibida hasta ahora (normalmente 2): si la pestaña
    // estuvo oculta un rato, llegan todas las velas que faltan y no queda un
    // hueco. El motor distingue por timestamp si actualiza o agrega.
    const DURACION_MS = { minute: 60000, hour: 3600000, day: 86400000 };
    function suscribir(symbol, timeframe, alRecibir) {
        const p = PERIODOS[timeframe];
        const durMs = DURACION_MS[p.type] * p.span;
        let vivo = true;
        let timer = null;
        let ultimo = null;
        let enCurso = false;
        async function tick() {
            clearTimeout(timer);
            if (!vivo || enCurso) return;
            if (document.visibilityState === 'visible') {
                enCurso = true;
                const faltan = ultimo == null ? 2 : Math.ceil((Date.now() - ultimo) / durMs) + 1;
                try {
                    const r = await velas(symbol, timeframe, { limit: Math.min(Math.max(faltan, 2), 1500) });
                    if (vivo) r.velas.forEach((v) => { alRecibir(v); ultimo = v.timestamp; });
                } catch (_) { /* un refresco fallido se reintenta en el próximo tick */ }
                enCurso = false;
            }
            if (vivo) timer = setTimeout(tick, REFRESCO_MS);
        }
        const alVolver = () => { if (document.visibilityState === 'visible') tick(); };
        document.addEventListener('visibilitychange', alVolver);
        timer = setTimeout(tick, REFRESCO_MS);
        return () => { vivo = false; clearTimeout(timer); document.removeEventListener('visibilitychange', alVolver); };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.market = {
        PERIODOS,
        TIMEFRAMES: Object.keys(PERIODOS),
        LOTE,
        simbolos: () => NLT_API.chartsSimbolos(),
        velas,
        suscribir,
    };
})();
