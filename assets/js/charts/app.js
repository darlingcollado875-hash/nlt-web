/* NLT Charts -- arranque de charts.html: une sesión, datos, motor, barra,
 * dibujos e indicadores. Cada pieza vive en su archivo (ver engine.js,
 * market-data.js, drawings.js, indicators.js, state.js, ui.js). */
(function () {
    const { state, market, engine, ui, drawings, indicators } = window.NLTCharts;
    const estado = document.getElementById('chEstado');

    function mostrarEstado(texto, error) {
        estado.hidden = !texto;
        estado.textContent = texto || '';
        estado.classList.toggle('error', !!error);
    }

    async function init() {
        const session = await NLT.requireSession();
        if (!session) return;
        state.setUser(session.user.id);
        NLTCharts.settings.setUser(session.user.id);
        NLTCharts.layout.setUser(session.user.id);
        NLT.mountSidebar(session, { activo: 'charts', seccion: 'charts' });

        // Preferencias de la cuenta (otro dispositivo) en paralelo con el catálogo; nunca bloquea
        // más de 2,5 s ni falla: sin cuenta disponible se sigue con las de este dispositivo.
        const pLayout = NLTCharts.layout.cargar({ timeoutMs: 2500 });
        NLTCharts.trading.cargar();   // estado de la ejecución (hoy apagada): habilita o no BUY/SELL en las posiciones
        // Sin catálogo no hay gráfico: se reintenta solo (5 s, 10 s... hasta 30 s, o al volver la red).
        let catalogo = null;
        for (let espera = 5000; !catalogo; espera = Math.min(espera * 2, 30000)) {
            try {
                catalogo = await market.simbolos();
            } catch (err) {
                mostrarEstado(`No se pudo conectar con NLT Charts (${err.message}). Reintentando…`, true);
                await new Promise((r) => {
                    const t = setTimeout(listo, espera);
                    function listo() { clearTimeout(t); window.removeEventListener('online', listo); r(); }
                    window.addEventListener('online', listo);
                });
            }
        }
        mostrarEstado('');
        await pLayout;
        const porSimbolo = Object.fromEntries(catalogo.symbols.map((s) => [s.symbol, s]));
        const prefs = state.prefs();
        let symbol = porSimbolo[prefs.symbol] ? prefs.symbol : catalogo.symbols[0].symbol;
        let timeframe = catalogo.timeframes.includes(prefs.timeframe) ? prefs.timeframe : '15m';

        let dib = null;
        const motor = engine.crear(document.getElementById('chart'), {
            onData: ({ demo, primera }) => {
                toolbar.setDemo(demo);
                if (primera) NLTCharts.diag.marcarCarga();
                mostrarEstado('');
                if (primera && dib) { dib.restaurar(); if (pro) pro.dibujosRestaurados(); }
            },
            onError: (msg) => mostrarEstado('No se pudieron cargar los precios: ' + msg, true),
            // Zonas PRO: se re-analizan con cada vela nueva
            onVelaNueva: () => pro && pro.velaNueva(),
        });

        let pro = null;   // se crea más abajo; los dibujos lo consultan en tiempo de uso
        // Tiempo restante de la vela actual (reloj del servidor), sobre la escala de precios
        if (NLTCharts.leyendaPlegable) { try { NLTCharts.leyendaPlegable.montar({ chart: motor.chart, stageEl: document.querySelector('.ch-stage'), state }); } catch (e) { console.warn('[NLT Charts] leyenda plegable no disponible', e); } }
        if (NLTCharts.countdown) NLTCharts.countdown.montar({ chart: motor.chart, stageEl: document.querySelector('.ch-stage') });
        NLTCharts.settings.registrar('GRAFICO', NLTCharts.engine.APARIENCIA);
        motor.aplicarApariencia(NLTCharts.settings.valores('GRAFICO'));

        dib = drawings.montar({
            chart: motor.chart,
            toolsEl: document.getElementById('chTools'),
            hintEl: document.getElementById('chHint'),
            barraEl: document.getElementById('chBarraDibujo'),
            getSymbol: () => symbol,
            // Rectángulo conectado al NLT Zone Engine (pro.js decide si hay acceso)
            puedeZonaNLT: () => !!(pro && pro.tieneAcceso()),
            onEnviarZona: (id) => pro && pro.conectarZona(id),
            onZonaMovida: (id) => pro && pro.zonaMovida(id),
        });

        // PRO: el backend decide el acceso; esto solo muestra y dibuja.
        let ind = null;
        pro = NLTCharts.pro.crear({
            chart: motor.chart,
            getSymbol: () => symbol,
            getTimeframe: () => timeframe,
            dibujos: dib,
            onCambio: () => ind && ind.refrescarPanel(),
        });

        // NLT AI: indicador aparte que usa los eventos del Zone Engine (su propio panel).
        const nltAi = NLTCharts.nltAi.crear({
            getSymbol: () => symbol,
            getTimeframe: () => timeframe,
            pro,
            onCambio: () => ind && ind.refrescarPanel(),
        });
        pro.conNltAi(nltAi);

        ind = indicators.montar({
            chart: motor.chart,
            panelEl: document.getElementById('chPanel'),
            panelBgEl: document.getElementById('chPanelBg'),
            activos: prefs.indicators,
            getTimeframe: () => timeframe,
            onCambio: (ids) => state.savePrefs({ indicators: ids }),
            pro,
        });

        const toolbar = ui.montarToolbar(document.getElementById('chToolbar'), {
            simbolos: catalogo.symbols,
            timeframes: catalogo.timeframes,
            symbol, timeframe,
            onSymbol: (s) => (NLTCharts.replayApi && NLTCharts.replayApi.activo() ? NLTCharts.replayApi.cambiar(s, timeframe) : cambiarSimbolo(s)),
            onTimeframe: (tf) => {
                if (NLTCharts.replayApi && NLTCharts.replayApi.activo()) { toolbar.setTimeframe(timeframe); NLTCharts.replayApi.cambiar(symbol, tf); return; } timeframe = tf; toolbar.setTimeframe(tf); state.savePrefs({ timeframe }); ind.cambioTimeframe(); cargar(); pro.cambioDeTimeframe(); nltAi.cambioDeSimbolo(); },
            onIndicadores: () => ind.abrir(),
            onConfig: () => NLTCharts.settings.abrir('GRAFICO', (v) => motor.aplicarApariencia(v)),
            onWatchlist: () => wl.alternar(),
            onFavorito: () => { wl.alternarFav(symbol); toolbar.setFavorito(wl.esFavorito(symbol)); },
        });

        function cambiarSimbolo(s) {
            if (!porSimbolo[s]) return;
            symbol = s;
            state.savePrefs({ symbol });
            toolbar.setSymbol(s);
            toolbar.setFavorito(wl.esFavorito(s));
            wl.marcarActual();
            cargar();
            pro.cambioDeSimbolo();
            nltAi.cambioDeSimbolo();
        }

        const wl = NLTCharts.watchlist.montar({
            el: document.getElementById('chWatch'),
            catalogo: catalogo.symbols,
            noDisponibles: catalogo.unavailable || [],
            getSymbol: () => symbol,
            onSeleccionar: (s) => cambiarSimbolo(s),
            onCambio: () => { toolbar.setFavorito(wl.esFavorito(symbol)); toolbar.setWatchlist(!document.getElementById('chWatch').hidden); motor.chart.resize(); },
        });
        toolbar.setFavorito(wl.esFavorito(symbol));
        // Hora del último dato recibido (con segundos); si no es de hoy, con el día.
        const horaDato = () => {
            const ms = market.ultimoDato();
            if (ms == null) return null;
            const f = new Date(ms);
            const hora = f.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return f.toDateString() === new Date().toDateString() ? hora : `${f.toLocaleDateString([], { weekday: 'short', day: 'numeric' })} ${hora}`;
        };
        let detalleConexion = null;
        toolbar.setConexion(market.estado());
        market.alCambiarEstado((e, detalle) => { detalleConexion = detalle; toolbar.setConexion(e, detalle, horaDato()); });
        market.alRecibirDato(() => toolbar.setConexion(market.estado(), detalleConexion, horaDato()));
        toolbar.setWatchlist(!document.getElementById('chWatch').hidden);

        function cargar() {
            mostrarEstado('Cargando precios...');
            // Key Levels pide las diarias del símbolo: tiene que saberlo antes del recálculo.
            NLTCharts.freeIndicators.setSymbol(symbol);
            NLTCharts.unified.setContexto({ symbol, pricePrecision: porSimbolo[symbol].price_precision });
            NLTCharts.drawings.setPrecision(porSimbolo[symbol].price_precision);
            motor.cargar(porSimbolo[symbol], timeframe);
            if (multi) multi.cambioPrincipal();
            if (alertas) setTimeout(() => alertas.cambioSimbolo(), 1200);
            if (paper) setTimeout(() => paper.cambioSimbolo(), 1200);
            if (trader) setTimeout(() => trader.cambioSimbolo(), 1200);
        }
        let multi = null, alertas = null, paper = null, trader = null, scripts = null;
        cargar();
        if (NLTCharts.multi) {
            try {
                multi = NLTCharts.multi.montar({
                    stage: document.querySelector('.ch-stage'), principalEl: document.getElementById('chart'),
                    principal: { chart: motor.chart, symbol: () => symbol, timeframe: () => timeframe },
                    simbolos: catalogo.symbols, timeframes: catalogo.timeframes, estilos: NLTCharts.engine.ESTILOS,
                });
            } catch (e) { console.warn('[NLT Charts] multi-gráfico no disponible', e); }
        }
        if (NLTCharts.alerts) {
            try {
                alertas = NLTCharts.alerts.montar({ chart: motor.chart, getSymbol: () => symbol, getUltimoPrecio: () => { const l = motor.chart.getDataList(); return l.length ? l[l.length - 1].close : null; } });
            } catch (e) { console.warn('[NLT Charts] alertas no disponibles', e); }
        }
        if (NLTCharts.paper) {
            try { paper = NLTCharts.paper.montar({ chart: motor.chart, simbolos: catalogo.symbols, getSymbol: () => symbol }); } catch (e) { console.warn('[NLT Charts] simulador no disponible', e); }
        }
        if (NLTCharts.trader && NLTCharts.poschips) {
            try { trader = NLTCharts.trader.montar({ chart: motor.chart, getSymbol: () => symbol, simbolos: catalogo.symbols }); } catch (e) { console.warn('[NLT Charts] operar con cuenta real no disponible', e); }
        }
        if (NLTCharts.scripts && NLTCharts.nltsEjemplos && window.NLTS) {
            try { scripts = NLTCharts.scripts.montar({ chart: motor.chart, getSymbol: () => symbol, getTimeframe: () => timeframe, simbolos: catalogo.symbols, timeframes: catalogo.timeframes }); } catch (e) { console.warn('[NLT Charts] NLT Script no disponible', e); }
        }
        if (NLTCharts.screener) {
            try { NLTCharts.screener.montar({ simbolos: catalogo.symbols, getSymbol: () => symbol, getTimeframe: () => timeframe, onAbrir: (s, tf) => window.NLTCharts.app.irA(s, tf) }); } catch (e) { console.warn('[NLT Charts] screener no disponible', e); }
        }
        if (NLTCharts.ratings) { try { NLTCharts.ratings.montar({ chart: motor.chart, getSymbol: () => symbol, getTimeframe: () => timeframe }); } catch (e) { console.warn('[NLT Charts] análisis técnico no disponible', e); } }
        pro.iniciar();
        nltAi.iniciar();
        window.NLTCharts.motor = motor; // para depurar desde la consola
        window.NLTCharts.app = {
            activarIndicador: (id) => ind.activar(id), desactivarIndicador: (id) => ind.desactivar(id), indicadoresActivos: () => ind.activos(),
            pro, nltAi, dibujos: dib, motor, paper: () => paper, trader: () => trader, scripts: () => scripts,
            // NLT Backtest Lab: lleva el gráfico a un símbolo/timeframe por el mismo camino que la barra
            irA(s, tf) {
                if (tf && tf !== timeframe && catalogo.timeframes.includes(tf)) {
                    timeframe = tf; toolbar.setTimeframe(tf); state.savePrefs({ timeframe }); ind.cambioTimeframe(); pro.cambioDeTimeframe();
                }
                if (s !== symbol) cambiarSimbolo(s); else cargar();
            },
            simbolo: () => symbol, timeframe: () => timeframe, multi: () => multi,
        };   // favoritos PRO, consola y Backtest Lab
        NLTCharts.replay && NLTCharts.replay.montar({ el: document.getElementById('chReplay'), boton: document.getElementById('chBtnReplay') });
        NLTCharts.historia && NLTCharts.historia.montar({ el: document.getElementById('chHistoria'), boton: document.getElementById('chBtnHistoria') });
        NLTCharts.backtest && NLTCharts.backtest.montar({
            el: document.getElementById('chLab'), boton: document.getElementById('chBtnLab'), simbolos: catalogo.symbols,
        });
    }

    init();
})();
