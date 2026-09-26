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


    // ── Apariencia del gráfico (Configuración → Velas / Lienzo). Preset NLT: alcista AZUL, bajista BLANCO.
    // Todo es solo visual: aplicarla redibuja, nunca recalcula indicadores.
    const cc = (hex, t = 0) => ({ hex, t });
    const TIPOS_VELA = [
        { v: 'candle_solid', t: 'Velas' }, { v: 'candle_stroke', t: 'Velas huecas' },
        { v: 'candle_up_stroke', t: 'Huecas alcistas' }, { v: 'ohlc', t: 'Barras OHLC' }, { v: 'area', t: 'Área' },
    ];
    const APARIENCIA = {
        titulo: 'Configuración del gráfico',
        inputs: [
            { id: 'tipo', tipo: 'string', def: 'candle_solid', titulo: 'Tipo', grupo: 'Velas', tab: 'Velas', opciones: TIPOS_VELA, recalc: false },
            { id: 'cuerpo', tipo: 'bool', def: true, titulo: 'Cuerpo', grupo: 'Velas', tab: 'Velas', inline: 'c', recalc: false },
            { id: 'cuerpoUp', tipo: 'color', def: cc('#4378FF'), titulo: 'Alcista', grupo: 'Velas', tab: 'Velas', inline: 'c', recalc: false },
            { id: 'cuerpoDown', tipo: 'color', def: cc('#FFFFFF'), titulo: 'Bajista', grupo: 'Velas', tab: 'Velas', inline: 'c', recalc: false },
            { id: 'borde', tipo: 'bool', def: true, titulo: 'Bordes', grupo: 'Velas', tab: 'Velas', inline: 'b', recalc: false },
            { id: 'bordeUp', tipo: 'color', def: cc('#4378FF'), titulo: 'Alcista', grupo: 'Velas', tab: 'Velas', inline: 'b', recalc: false },
            { id: 'bordeDown', tipo: 'color', def: cc('#FFFFFF'), titulo: 'Bajista', grupo: 'Velas', tab: 'Velas', inline: 'b', recalc: false },
            { id: 'mecha', tipo: 'bool', def: true, titulo: 'Mechas', grupo: 'Velas', tab: 'Velas', inline: 'm', recalc: false },
            { id: 'mechaUp', tipo: 'color', def: cc('#4378FF'), titulo: 'Alcista', grupo: 'Velas', tab: 'Velas', inline: 'm', recalc: false },
            { id: 'mechaDown', tipo: 'color', def: cc('#FFFFFF'), titulo: 'Bajista', grupo: 'Velas', tab: 'Velas', inline: 'm', recalc: false },
            { id: 'fondo', tipo: 'color', def: cc('#080A0F'), titulo: 'Fondo', grupo: 'Lienzo', tab: 'Lienzo', recalc: false },
            { id: 'grilla', tipo: 'bool', def: true, titulo: 'Cuadrícula', grupo: 'Lienzo', tab: 'Lienzo', inline: 'g', recalc: false },
            { id: 'grillaColor', tipo: 'color', def: cc('#FFFFFF', 96), titulo: '', grupo: 'Lienzo', tab: 'Lienzo', inline: 'g', recalc: false },
            { id: 'ultimoPrecio', tipo: 'bool', def: true, titulo: 'Línea de último precio', grupo: 'Escala de precios', tab: 'Lienzo', recalc: false },
            { id: 'maxMin', tipo: 'bool', def: true, titulo: 'Máximo y mínimo visibles', grupo: 'Escala de precios', tab: 'Lienzo', recalc: false },
        ],
    };

    function estilosApariencia(v) {
        const css = (c) => NLTCharts.pine.css(c);
        const nada = 'rgba(0,0,0,0)';
        const up = v.cuerpo ? css(v.cuerpoUp) : nada, down = v.cuerpo ? css(v.cuerpoDown) : nada;
        return {
            grid: { show: v.grilla, horizontal: { color: css(v.grillaColor) }, vertical: { color: css(v.grillaColor) } },
            candle: {
                type: v.tipo,
                bar: {
                    upColor: up, downColor: down, noChangeColor: css(v.cuerpoDown),
                    upBorderColor: v.borde ? css(v.bordeUp) : nada, downBorderColor: v.borde ? css(v.bordeDown) : nada, noChangeBorderColor: css(v.bordeDown),
                    upWickColor: v.mecha ? css(v.mechaUp) : nada, downWickColor: v.mecha ? css(v.mechaDown) : nada, noChangeWickColor: css(v.mechaDown),
                },
                area: { lineColor: css(v.cuerpoUp), backgroundColor: [{ offset: 0, color: css({ ...v.cuerpoUp, t: 75 }) }, { offset: 1, color: css({ ...v.cuerpoUp, t: 100 }) }] },
                priceMark: {
                    high: { show: v.maxMin }, low: { show: v.maxMin },
                    // la etiqueta del último precio usa el color de la vela; el texto se ajusta para que se lea
                    last: { show: v.ultimoPrecio, upColor: css({ ...v.cuerpoUp, t: 0 }), downColor: css({ ...v.cuerpoDown, t: 0 }), noChangeColor: css({ ...v.cuerpoDown, t: 0 }), text: { color: v.cuerpoDown.hex.toUpperCase() === '#FFFFFF' ? '#0B0E14' : '#FFFFFF' } },
                },
            },
        };
    }

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
            // Solo visual: setStyles redibuja, no recalcula indicadores.
            aplicarApariencia(v) {
                chart.setStyles(estilosApariencia(v));
                el.style.background = NLTCharts.pine.css(v.fondo);
            },
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
    window.NLTCharts.engine = { crear, COLORES: C, FUENTE, APARIENCIA, estilosApariencia };
})();
