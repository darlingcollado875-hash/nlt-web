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
        cross: 'rgba(255,255,255,0.28)', crossBg: '#1F2937', accent: '#4378ff',
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
     *   onVelaNueva(vela)          cuando empieza una vela nueva en vivo (zonas PRO, etc.)
     */
    function crear(el, { onData, onError, onVelaNueva } = {}) {
        const market = NLTCharts.market;
        const chart = klinecharts.init(el, { styles: ESTILOS, locale: 'en-US' });
        let cancelarSuscripcion = null;
        let timeframe = null;
        let pedidoInicial = null;   // AbortController de la carga en curso (símbolo/timeframe)
        let operaFinDeSemana = true;
        let reintento = null, espera = 5000;   // la carga inicial falló: se reintenta sola (5 s, 10 s... hasta 30 s)
        // ¿llegó la historia de este símbolo/timeframe? Si la carga inicial falló, el refresco en vivo
        // igual agrega las 2 últimas velas: el reintento no puede mirar solo "¿hay velas?".
        let historiaOk = false;
        // NLT Backtest Lab: velas de un backtest en vez de las del mercado en vivo (sin suscripción).
        // `empujarExterno` agrega/actualiza velas una por una (Bar Replay).
        let externo = null, empujarExterno = null;
        // PRIMARY / BACKUP: fuente de la serie en pantalla. Si el servidor pasa a la otra cuenta (o vuelve),
        // el dataset se recarga ENTERO de la nueva (nueva generación: nada calculado con la vieja se dibuja).
        let fuenteSerie = null;
        const cambiosDeFuente = [];
        function recargarPorFuente(nueva) {
            if (externo) return;
            cambiosDeFuente.push({ at: new Date().toISOString(), from: fuenteSerie, to: nueva });
            console.warn('[NLT Charts] fuente de precios:', fuenteSerie, '->', nueva, '(se recarga el dataset completo)');
            fuenteSerie = null;
            market.nuevaGeneracion();
            market.fijarEstado('conectando', `Fuente de precios: ${nueva === 'backup' ? 'respaldo' : 'principal'}`);
            historiaOk = false;
            chart.resetData();
        }
        // ── Histórico profundo (capa histórica compartida del servidor: /charts/history) ──
        // Hacia la izquierda se pide SOLO el rango que falta (tamaño adaptativo: más grande si el usuario
        // scrollea rápido), en tramos paralelos; cerca del borde se precarga el bloque siguiente. "Ir a fecha"
        // lejos del presente abre una VENTANA alrededor de esa fecha (no carga todo lo intermedio); la ventana
        // crece hacia la derecha al avanzar y, al llegar al presente, vuelve sola al vivo.
        const DUR = (tf) => { const p = market.PERIODOS[tf]; return ({ minute: 60000, hour: 3600000, day: 86400000 })[p.type] * p.span; };
        const PASO = { '1m': 3000, '5m': 3000, '15m': 2500, '30m': 2000, '1H': 1500, '4H': 1200, '1D': 1000 };
        const calendario = () => (operaFinDeSemana ? 1.05 : 1.45);      // velas -> tiempo (fines de semana)
        let ventana = null;           // { centro, fin } : el gráfico muestra un tramo del pasado (sin vivo)
        let subPendiente = null;      // subscribeBar guardado mientras la ventana no llega al presente
        let esperaForward = null;     // "Ir a fecha" contiguo: espera la próxima carga hacia la izquierda
        const hist = { ultimaCarga: 0, factor: 1, pedidos: [], precargados: new Set() };
        const oyentesVentana = new Set();
        const avisarVentana = () => oyentesVentana.forEach((fn) => { try { fn(ventana ? { centro: ventana.centro, fin: ventana.fin } : null); } catch (_) { /* oyente */ } });
        function pasoAdaptativo(tf) {
            const ahora = Date.now();
            if (ahora - hist.ultimaCarga < 4000) hist.factor = Math.min(4, hist.factor * 2);   // navegación rápida
            else if (ahora - hist.ultimaCarga > 15000) hist.factor = 1;
            hist.ultimaCarga = ahora;
            return Math.round((PASO[tf] || 1500) * hist.factor);
        }
        // [desde, hasta) en tramos de ~PASO velas pedidos a la vez; progreso real = tramos terminados
        async function historia(sym, tf, desde, hasta, { signal, onProgreso } = {}) {
            const dur = DUR(tf), paso = (PASO[tf] || 1500) * dur * calendario();
            const tramos = [];
            for (let a = desde; a < hasta; a += paso) tramos.push([a, Math.min(hasta, a + paso)]);
            let hechos = 0;
            const t0 = performance.now();
            if (onProgreso) onProgreso({ hechos, total: tramos.length, ms: 0 });
            const partes = await Promise.all(tramos.map(async ([a, b]) => {
                const t = performance.now();
                const r = await market.historia(sym, tf, a, b, { signal });
                hist.pedidos.push({ tf, desde: a, hasta: b, velas: r.velas.length, ms: Math.round(performance.now() - t), hit: !!r.cache.hit, prov: r.cache.provider_requests || 0 });
                if (hist.pedidos.length > 300) hist.pedidos.shift();
                hechos += 1;
                if (onProgreso) onProgreso({ hechos, total: tramos.length, ms: Math.round(performance.now() - t0) });
                return r;
            }));
            const fuentes = new Set(partes.map((r) => r.source));
            const vistos = new Map();
            partes.forEach((r) => r.velas.forEach((v) => vistos.set(v.timestamp, v)));
            const velas = [...vistos.values()].sort((a, b) => a.timestamp - b.timestamp);
            return { velas, source: fuentes.size === 1 ? [...fuentes][0] : 'mixta', hit: partes.every((r) => r.cache.hit) };
        }
        // Precarga silenciosa del bloque anterior cuando el usuario se acerca al borde izquierdo. El resultado se GUARDA:
        // cuando el gráfico pide ese tramo, ya está (o va de camino) y aparece al instante en vez de volver a pedirlo al servidor.
        const precarga = new Map();      // `${ticker}|${tf}|${hasta}` -> { desde, p: Promise<resultado> }
        function precargar() {
            if (externo || !timeframe) return;
            const dl = chart.getDataList(), sym = chart.getSymbol();
            if (!dl.length || !sym) return;
            const vr = chart.getVisibleRange();
            const n = Math.round((PASO[timeframe] || 1500) * hist.factor);
            if ((vr.realFrom ?? vr.from) > n * 0.75) return;          // todavía lejos del borde: no hace falta
            const hasta = dl[0].timestamp, desde = hasta - n * DUR(timeframe) * calendario();
            const k = `${sym.ticker}|${timeframe}|${hasta}`;
            if (precarga.has(k)) return;
            const p = historia(sym.ticker, timeframe, desde, hasta);
            precarga.set(k, { desde, p });
            p.catch(() => precarga.delete(k));
            if (precarga.size > 6) precarga.delete(precarga.keys().next().value);
        }
        // Aviso discreto mientras llega historia más vieja (el borde izquierdo no se queda "en blanco" sin explicación)
        let chipHist = null, chipTimer = null;
        function avisoHistoria(cargando, texto) {
            const host = el.parentElement;
            if (!host) return;
            if (!chipHist) { chipHist = document.createElement('div'); chipHist.className = 'ch-histcarga'; chipHist.setAttribute('role', 'status'); host.appendChild(chipHist); }
            clearTimeout(chipTimer);
            if (!cargando) { chipHist.classList.remove('on'); return; }
            chipTimer = setTimeout(() => { chipHist.textContent = texto || 'Cargando historial…'; chipHist.classList.add('on'); }, 250);   // si llega rápido ni se ve
        }
        let tPrecarga = 0;
        try { chart.subscribeAction('onScroll', () => { const t = Date.now(); if (t - tPrecarga > 400) { tPrecarga = t; precargar(); } }); } catch (_) { /* versión sin acciones */ }
        function suscribirVivo(symbol, callback) {
            const dl = chart.getDataList();
            let ultimoTs = dl.length ? dl[dl.length - 1].timestamp : null;
            cancelarSuscripcion = market.suscribir(symbol.ticker, timeframe, (vela) => {
                aplicarVela(callback, vela);
                if (ultimoTs !== null && vela.timestamp > ultimoTs && onVelaNueva) onVelaNueva(vela);
                if (ultimoTs === null || vela.timestamp > ultimoTs) ultimoTs = vela.timestamp;
            }, { operaFinDeSemana, fuente: fuenteSerie, alCambiarFuente: recargarPorFuente });
        }
        function ventanaLlegoAlPresente() {
            if (!ventana) return;
            ventana = null;
            market.fijarEstado('conectando');
            avisarVentana();
            if (subPendiente && !cancelarSuscripcion) suscribirVivo(subPendiente.symbol, subPendiente.callback);
        }

        // Movimiento fluido (solo visual): tween de la vela en curso y entrada suave de la vela nueva
        const fluidez = NLTCharts.fluidez ? NLTCharts.fluidez.crear(chart) : null;
        const aplicarVela = (cb, vela) => (fluidez ? fluidez.aplicar(cb, vela) : cb(vela));
        // KLineChart repinta una vela nueva SOLO cuando terminan de calcular TODOS los indicadores. Si alguno es lento (Suite,
        // Zone Engine pidiendo velas al servidor), la vela aparecía con retraso y, en PLAY con las velas llegando más rápido
        // que el cálculo, el gráfico parecía congelado aunque el reloj avanzaba. Se pide un repintado propio (uno por frame)
        // con los datos ya agregados; los indicadores lentos se dibujan cuando terminan (el dibujo de resultados viejos se
        // omite solo, ver fluidez.js).
        let repintando = false;
        function repintarYa() {
            if (repintando) return;
            repintando = true;
            requestAnimationFrame(() => {
                repintando = false;
                try { chart.layout({ measureWidth: true, update: true, buildYAxisTick: true, cacheYAxisWidth: true }); }
                catch (_) { try { chart.setStyles({}); } catch (__) { /* sin redibujo extra */ } }
            });
        }

        chart.setDataLoader({
            // En KLineChart 10, "forward" pide historia MÁS VIEJA (a la
            // izquierda, timestamp = primera vela cargada) y "backward" pide
            // velas MÁS NUEVAS (a la derecha, timestamp = última). Verificado
            // en el navegador: con los nombres al revés, la historia se
            // pegaba a la derecha. Las velas nuevas las trae subscribeBar,
            // así que "backward" nunca tiene nada.
            getBars: async ({ type, timestamp, symbol, callback }) => {
                if (externo) { callback(type === 'init' ? externo.velas : [], { forward: false, backward: false }); if (type === 'init') onData && onData({ demo: false, primera: true }); return; }
                const tfPedido = timeframe;
                const dur = DUR(tfPedido);
                // Una respuesta que llega tarde solo se aplica si el gráfico sigue en el MISMO dataset: mismo símbolo y
                // timeframe, misma generación y sin modo externo. Sin la generación (visto 28/09 con TickerAll real), la
                // carga en vivo de EURUSD 15m que llegaba después de entrar al Bar Replay en EURUSD 15m pisaba las velas
                // del replay con las del presente.
                const genPedido = market.generacion ? market.generacion() : 0;
                const vigente = () => { const sym = chart.getSymbol(); return !externo && tfPedido === timeframe && sym && sym.ticker === symbol.ticker; };
                // carga inicial: además, la misma generación (un dataset nuevo reemplaza al que se estaba pidiendo)
                const vigenteInit = () => vigente() && (!market.generacion || market.generacion() === genPedido);
                const tope = () => Math.floor(Date.now() / dur) * dur;       // apertura de la vela en curso
                if (type === 'backward') {
                    // velas MÁS NUEVAS: solo en una ventana del pasado (en vivo las trae la suscripción)
                    if (!ventana) { callback([], { backward: false }); return; }
                    try {
                        const desde = timestamp + dur, hasta = Math.min(tope(), desde + (PASO[tfPedido] || 1500) * dur * calendario());
                        const r = desde < hasta ? await historia(symbol.ticker, tfPedido, desde, hasta) : { velas: [], source: fuenteSerie };
                        if (!vigente() || !ventana) return;
                        if (fuenteSerie && r.source !== fuenteSerie) { callback([], { backward: false }); recargarPorFuente(r.source); return; }
                        const llega = hasta >= tope();
                        callback(r.velas, { backward: !llega && r.velas.length > 0 });
                        if (r.velas.length) { ventana.fin = r.velas[r.velas.length - 1].timestamp; avisarVentana(); }
                        if (llega) ventanaLlegoAlPresente();
                    } catch (err) {
                        callback([], { backward: false });
                        if (onError) onError(err.message);
                    }
                    return;
                }
                if (type === 'forward') {
                    // historia MÁS VIEJA: solo el rango que falta, de la capa histórica (caché compartida)
                    avisoHistoria(true);
                    const claveP = `${symbol.ticker}|${tfPedido}|${timestamp}`;
                    let ultimoError = null;
                    for (let intento = 0; intento < 3; intento++) {
                        try {
                            const pre = precarga.get(claveP);
                            let r;
                            if (pre) { r = await pre.p; precarga.delete(claveP); }
                            else { const n = pasoAdaptativo(tfPedido); r = await historia(symbol.ticker, tfPedido, timestamp - n * dur * calendario(), timestamp); }
                            if (!vigente()) { avisoHistoria(false); return; }
                            if (fuenteSerie && r.source !== fuenteSerie) {
                                avisoHistoria(false);
                                callback([], { forward: false, backward: false });
                                recargarPorFuente(r.source);
                                return;
                            }
                            avisoHistoria(false);
                            callback(r.velas, { forward: r.velas.length > 0, backward: !!ventana });
                            if (esperaForward) { const f = esperaForward; esperaForward = null; f(r.velas.length); }
                            if (onData) onData({ demo: false, primera: false });
                            setTimeout(precargar, 60);        // ya con el bloque nuevo puesto, se adelanta el siguiente
                            return;
                        } catch (err) {
                            ultimoError = err;
                            precarga.delete(claveP);
                            if (!vigente()) { avisoHistoria(false); return; }
                            if (intento < 2) await new Promise((ok) => setTimeout(ok, 500 * (intento + 1)));       // un fallo suelto se reintenta solo
                        }
                    }
                    // tras 3 intentos: se avisa, pero NO se da por terminada la historia (forward: true) para que al seguir moviendo vuelva a intentarlo
                    avisoHistoria(true, 'No se pudo cargar el historial · sigue moviendo para reintentar');
                    setTimeout(() => avisoHistoria(false), 4000);
                    callback([], { forward: true, backward: !!ventana });
                    if (onError) onError(ultimoError && ultimoError.message);
                    if (esperaForward) { const f = esperaForward; esperaForward = null; f(-1); }
                    return;
                }
                if (ventana) {
                    // "Ir a fecha": una ventana alrededor de la fecha (no todo lo intermedio)
                    const v = ventana;
                    try {
                        const antes = (PASO[tfPedido] || 1500) * 0.6, despues = (PASO[tfPedido] || 1500) * 0.4;
                        const desde = v.centro - antes * dur * calendario();
                        const hasta = Math.min(tope(), v.centro + despues * dur * calendario());
                        const r = await historia(symbol.ticker, tfPedido, desde, hasta, { onProgreso: v.onProgreso });
                        if (!vigenteInit() || ventana !== v) return;
                        fuenteSerie = r.source;
                        const llega = hasta >= tope();
                        callback(r.velas, { forward: r.velas.length > 0, backward: !llega });
                        historiaOk = true;
                        v.fin = r.velas.length ? r.velas[r.velas.length - 1].timestamp : null;
                        market.fijarEstado('historico');
                        avisarVentana();
                        if (onData) onData({ demo: false, primera: true });
                        if (v.listo) v.listo.ok({ velas: r.velas.length, hit: r.hit });
                        if (llega) ventanaLlegoAlPresente();
                    } catch (err) {
                        callback([], { forward: false, backward: false });
                        if (onError) onError(err.message);
                        if (v.listo) v.listo.mal(err);
                    }
                    return;
                }
                // Cambio rápido de símbolo/timeframe: se cancela la carga anterior (no llega tarde ni gasta red).
                let signal;
                if (type === 'init') {
                    if (pedidoInicial) pedidoInicial.abort();
                    pedidoInicial = new AbortController();
                    signal = pedidoInicial.signal;
                }
                try {
                    const r = await market.velas(symbol.ticker, tfPedido, { end: null, signal });
                    // Si el usuario cambió de símbolo o timeframe mientras
                    // esperábamos, esta respuesta es de un gráfico que ya no está.
                    if (!vigenteInit()) return;       // de otro dataset (otro símbolo/timeframe, replay, backtest, otra fecha)
                    if (type === 'init') fuenteSerie = r.source;
                    else if (fuenteSerie && r.source && r.source !== fuenteSerie) {
                        // historia más vieja de OTRA fuente (PRIMARY/BACKUP): no se pega; se recarga todo de la actual
                        callback([], { forward: false, backward: false });
                        recargarPorFuente(r.source);
                        return;
                    }
                    callback(r.velas, { forward: r.velas.length > 0, backward: false });
                    if (type === 'init') {
                        espera = 5000;
                        historiaOk = true;
                        const u = r.velas.length ? r.velas[r.velas.length - 1].timestamp : null;
                        // último dato de la historia: ahora si la última vela está en curso, si no su cierre
                        market.marcarDato(u == null ? null : Math.min(Date.now(), u + dur));
                        market.fijarEstado(market.calcularEstado(u, dur, operaFinDeSemana));
                    }
                    onData && onData({ demo: r.demo, primera: type === 'init' });
                } catch (err) {
                    if (err.name === 'AbortError') return;   // la reemplazó una carga más nueva
                    callback([], { forward: false, backward: false });
                    onError && onError(err.message);
                    if (type === 'init') {
                        // sin historia no hay suscripción que reintente: se vuelve a pedir sola
                        market.fijarEstado('desconectado', err.message);
                        historiaOk = false;
                        clearTimeout(reintento);
                        reintento = setTimeout(() => { if (!historiaOk) chart.resetData(); }, espera);
                        espera = Math.min(espera * 2, 30000);
                    }
                }
            },
            subscribeBar: ({ symbol, callback }) => {
                if (cancelarSuscripcion) cancelarSuscripcion();
                cancelarSuscripcion = null;
                if (externo) { empujarExterno = callback; return; }
                subPendiente = { symbol, callback };
                if (ventana) return;                 // una ventana del pasado no tiene vivo (hasta llegar al presente)
                suscribirVivo(symbol, callback);
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
                operaFinDeSemana = symbolInfo.trades_weekends !== false;
                market.fijarCategoria(symbolInfo.category, symbolInfo.trades_weekends);
                clearTimeout(reintento); espera = 5000;
                if (cambiaSimbolo || cambiaPeriodo) {
                    market.fijarEstado('conectando'); historiaOk = false; market.nuevaGeneracion();
                    if (ventana) { ventana = null; avisarVentana(); }       // otro símbolo/timeframe: vuelve al vivo
                    hist.precargados.clear(); precarga.clear(); hist.factor = 1;
                }
                if (cambiaSimbolo) chart.setSymbol({ ticker: symbolInfo.symbol, pricePrecision: symbolInfo.price_precision, volumePrecision: 0 });
                if (cambiaPeriodo) chart.setPeriod(market.PERIODOS[tf]);
            },
            // Backtest Lab: datos = { velas: KLineData[] } muestra esas velas (sin mercado en vivo); null vuelve al vivo.
            modoExterno(datos, recargar = true) {
                if (fluidez) fluidez.cancelar();
                market.nuevaGeneracion();
                if (ventana) { ventana = null; avisarVentana(); }
                externo = datos ? { velas: datos.velas.slice() } : null;
                empujarExterno = null;
                historiaOk = !!datos;
                if (recargar) chart.resetData();
            },
            enModoExterno: () => !!externo,
            // ── histórico profundo ──
            /** irAFecha(ms, { onProgreso }) -> { modo: 'cache' | 'contiguo' | 'ventana', ms } */
            async irAFecha(ms, { onProgreso } = {}) {
                if (externo) throw new Error('En Bar Replay / Backtest la fecha se elige desde su propio panel.');
                const dur = DUR(timeframe), tope = Math.floor(Date.now() / dur) * dur;
                const objetivo = Math.min(Math.floor(ms / dur) * dur, tope);
                const t0 = performance.now();
                let dl = chart.getDataList();
                // 1) ya cargada: salto inmediato
                if (dl.length && objetivo >= dl[0].timestamp && (!ventana || objetivo <= dl[dl.length - 1].timestamp)) {
                    chart.scrollToTimestamp(objetivo, 0);
                    return { modo: 'cache', ms: Math.round(performance.now() - t0) };
                }
                // 2) cerca de lo cargado: se completa hacia la izquierda (queda contiguo)
                const bloques = dl.length ? (dl[0].timestamp - objetivo) / ((PASO[timeframe] || 1500) * dur * calendario()) : Infinity;
                if (bloques > 0 && bloques <= 2) {
                    for (let i = 0; i < 6 && dl.length && dl[0].timestamp > objetivo; i++) {
                        const llego = new Promise((res) => { esperaForward = res; setTimeout(() => res(-2), 120000); });
                        chart.scrollToDataIndex(0, 0);
                        const n = await llego;
                        if (onProgreso) onProgreso({ hechos: i + 1, total: Math.max(1, Math.ceil(bloques)), ms: Math.round(performance.now() - t0) });
                        if (n <= 0) break;
                        dl = chart.getDataList();
                    }
                    if (dl.length && dl[0].timestamp <= objetivo) {
                        chart.scrollToTimestamp(objetivo, 0);
                        return { modo: 'contiguo', ms: Math.round(performance.now() - t0) };
                    }
                }
                // 3) lejos: ventana alrededor de la fecha (nueva generación: nada del vivo se dibuja sobre ella)
                if (fluidez) fluidez.cancelar();
                if (cancelarSuscripcion) { cancelarSuscripcion(); cancelarSuscripcion = null; }
                market.nuevaGeneracion();
                historiaOk = false;
                hist.precargados.clear(); precarga.clear();
                const v = { centro: objetivo, fin: null, onProgreso };
                const listo = new Promise((ok, mal) => { v.listo = { ok, mal }; });
                ventana = v;
                avisarVentana();
                chart.resetData();
                const info = await listo;
                chart.scrollToTimestamp(objetivo, 0);
                return { modo: 'ventana', ms: Math.round(performance.now() - t0), ...info };
            },
            volverAlPresente() {
                if (!ventana) return;
                ventana = null;
                market.nuevaGeneracion();
                market.fijarEstado('conectando');
                avisarVentana();
                historiaOk = false;
                chart.resetData();
            },
            enVentana: () => (ventana ? { centro: ventana.centro, fin: ventana.fin } : null),
            alCambiarVentana(fn) { oyentesVentana.add(fn); return () => oyentesVentana.delete(fn); },
            metricasHistorico: () => ({ factor: hist.factor, pedidos: hist.pedidos.slice() }),
            fuente: () => fuenteSerie,
            cambiosDeFuente: () => cambiosDeFuente.slice(),
            recargarPorFuente,
            empujar(vela) {
                if (!externo || !empujarExterno) return;
                // el dataset externo refleja lo mostrado: un reset posterior no vuelve a un estado viejo
                const vs = externo.velas, u = vs[vs.length - 1];
                if (u && u.timestamp === vela.timestamp) vs[vs.length - 1] = vela; else if (!u || vela.timestamp > u.timestamp) vs.push(vela);
                aplicarVela(empujarExterno, vela);
                repintarYa();
            },
            fluidez: () => fluidez,
            destruir() {
                ro.disconnect();
                if (cancelarSuscripcion) cancelarSuscripcion();
                klinecharts.dispose(el);
            },
        };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.engine = { crear, ESTILOS, COLORES: C, FUENTE, APARIENCIA, estilosApariencia };
})();
