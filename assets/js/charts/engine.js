/* NLT Charts -- motor del gráfico.
 *
 * Único archivo que conoce la librería de velas (KLineChart 10, Apache-2.0).
 * El resto del módulo (UI, dibujos, indicadores) habla con este objeto, así
 * que cambiar de librería más adelante es reescribir este archivo y los
 * adaptadores de dibujos/indicadores, no la página. */
(function () {
    const C = {
        up: '#22C55E', down: '#EF4444', neutral: '#6B7280',
        grid: 'rgba(255,255,255,0.035)', axis: 'rgba(255,255,255,0.08)', text: '#6B7280',
        cross: 'rgba(255,255,255,0.28)', crossBg: '#1F2937', accent: '#22D3EE',
    };
    const FUENTE = 'Inter, system-ui, sans-serif';

    const ESTILOS = {
        grid: { horizontal: { color: C.grid }, vertical: { color: C.grid } },
        candle: {
            bar: {
                upColor: C.up, downColor: C.down, noChangeColor: C.neutral,
                upBorderColor: C.up, downBorderColor: C.down, noChangeBorderColor: C.neutral,
                upWickColor: C.up, downWickColor: C.down, noChangeWickColor: C.neutral,
            },
            priceMark: {
                high: { color: C.text, textFamily: FUENTE },
                low: { color: C.text, textFamily: FUENTE },
                last: { upColor: C.up, downColor: C.down, noChangeColor: C.neutral, text: { family: FUENTE } },
            },
            tooltip: {
                title: { show: false },
                legend: { color: '#9CA3AF', family: FUENTE, size: 11 },
            },
        },
        indicator: {
            bars: [{ upColor: 'rgba(34,197,94,0.45)', downColor: 'rgba(239,68,68,0.45)', noChangeColor: 'rgba(107,114,128,0.45)' }],
            tooltip: { title: { family: FUENTE, size: 11, color: '#9CA3AF' }, legend: { family: FUENTE, size: 11 } },
        },
        xAxis: { axisLine: { color: C.axis }, tickLine: { color: C.axis }, tickText: { color: C.text, family: FUENTE, size: 11 } },
        yAxis: { axisLine: { color: C.axis }, tickLine: { color: C.axis }, tickText: { color: C.text, family: FUENTE, size: 11 } },
        separator: { color: 'rgba(255,255,255,0.06)' },
        crosshair: {
            horizontal: { line: { color: C.cross }, text: { backgroundColor: C.crossBg, borderColor: C.crossBg, family: FUENTE, size: 11 } },
            vertical: { line: { color: C.cross }, text: { backgroundColor: C.crossBg, borderColor: C.crossBg, family: FUENTE, size: 11 } },
        },
    };

    /**
     * crear(el, { onData, onError }) -> motor
     *   onData({ demo, primera })  cada vez que llega historia (para el badge DEMO,
     *                              y para restaurar dibujos después de la primera carga)
     *   onError(mensaje)
     */
    function crear(el, { onData, onError } = {}) {
        const market = NLTCharts.market;
        const chart = klinecharts.init(el, { styles: ESTILOS, locale: 'en-US' });
        let cancelarSuscripcion = null;
        let timeframe = null;

        chart.setDataLoader({
            // En KLineChart 10, "forward" pide historia MÁS VIEJA (a la
            // izquierda, timestamp = primera vela cargada) y "backward" pide
            // velas MÁS NUEVAS (a la derecha, timestamp = última). Verificado
            // en el navegador: con los nombres al revés, la historia se
            // pegaba a la derecha. Las velas nuevas las trae subscribeBar,
            // así que "backward" nunca tiene nada.
            getBars: async ({ type, timestamp, symbol, callback }) => {
                if (type === 'backward') { callback([], { backward: false }); return; }
                const tfPedido = timeframe;
                try {
                    const end = type === 'forward' ? timestamp : null;
                    const r = await market.velas(symbol.ticker, tfPedido, { end });
                    // Si el usuario cambió de símbolo o timeframe mientras
                    // esperábamos, esta respuesta es de un gráfico que ya no está.
                    const sym = chart.getSymbol();
                    if (tfPedido !== timeframe || !sym || sym.ticker !== symbol.ticker) return;
                    const hayMas = r.velas.length >= market.LOTE;
                    callback(r.velas, { forward: hayMas, backward: false });
                    onData && onData({ demo: r.demo, primera: type === 'init' });
                } catch (err) {
                    callback([], { forward: false, backward: false });
                    onError && onError(err.message);
                }
            },
            subscribeBar: ({ symbol, callback }) => {
                if (cancelarSuscripcion) cancelarSuscripcion();
                cancelarSuscripcion = market.suscribir(symbol.ticker, timeframe, callback);
            },
            unsubscribeBar: () => {
                if (cancelarSuscripcion) cancelarSuscripcion();
                cancelarSuscripcion = null;
            },
        });

        // El contenedor cambia de tamaño con el sidebar, la rotación del
        // celular o el teclado virtual: el canvas tiene que acompañar.
        // Margen a la derecha como TradingView: ahí van las etiquetas que los
        // indicadores dibujan en velas futuras (ej. bar_index + 10).
        chart.setOffsetRightDistance(90);

        const ro = new ResizeObserver(() => chart.resize());
        ro.observe(el);

        return {
            chart,
            cargar(symbolInfo, tf) {
                // setSymbol y setPeriod recargan cada uno aunque el valor no
                // cambie: solo se llama al que cambió, así un cambio de
                // timeframe es un pedido y no dos.
                const actual = chart.getSymbol();
                const cambiaSimbolo = !actual || actual.ticker !== symbolInfo.symbol;
                const cambiaPeriodo = timeframe !== tf;
                timeframe = tf;
                if (cambiaSimbolo) chart.setSymbol({ ticker: symbolInfo.symbol, pricePrecision: symbolInfo.price_precision, volumePrecision: 0 });
                if (cambiaPeriodo) chart.setPeriod(market.PERIODOS[tf]);
            },
            destruir() {
                ro.disconnect();
                if (cancelarSuscripcion) cancelarSuscripcion();
                klinecharts.dispose(el);
            },
        };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.engine = { crear, COLORES: C, FUENTE };
})();
