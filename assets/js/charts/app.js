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
            onSymbol: (s) => cambiarSimbolo(s),
            onTimeframe: (tf) => { timeframe = tf; toolbar.setTimeframe(tf); state.savePrefs({ timeframe }); ind.cambioTimeframe(); cargar(); pro.refrescar(); },
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
            getSymbol: () => symbol,
            onSeleccionar: (s) => cambiarSimbolo(s),
            onCambio: () => { toolbar.setFavorito(wl.esFavorito(symbol)); toolbar.setWatchlist(!document.getElementById('chWatch').hidden); motor.chart.resize(); },
        });
        toolbar.setFavorito(wl.esFavorito(symbol));
        toolbar.setConexion(market.estado());
        market.alCambiarEstado((e, detalle) => toolbar.setConexion(e, detalle));
        toolbar.setWatchlist(!document.getElementById('chWatch').hidden);

        function cargar() {
            mostrarEstado('Cargando precios...');
            // Key Levels pide las diarias del símbolo: tiene que saberlo antes del recálculo.
            NLTCharts.freeIndicators.setSymbol(symbol);
            NLTCharts.unified.setContexto({ symbol, pricePrecision: porSimbolo[symbol].price_precision });
            NLTCharts.drawings.setPrecision(porSimbolo[symbol].price_precision);
            motor.cargar(porSimbolo[symbol], timeframe);
        }
        cargar();
        pro.iniciar();
        nltAi.iniciar();
        window.NLTCharts.motor = motor; // para depurar desde la consola
        window.NLTCharts.app = {
            activarIndicador: (id) => ind.activar(id), desactivarIndicador: (id) => ind.desactivar(id), indicadoresActivos: () => ind.activos(),
            pro, nltAi, dibujos: dib,
        };   // favoritos PRO y consola
    }

    init();
})();
