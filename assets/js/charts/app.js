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
        NLT.mountSidebar(session, { activo: 'charts', seccion: 'indicator' });

        let catalogo;
        try {
            catalogo = await market.simbolos();
        } catch (err) {
            mostrarEstado('No se pudo cargar NLT Charts: ' + err.message, true);
            return;
        }
        const porSimbolo = Object.fromEntries(catalogo.symbols.map((s) => [s.symbol, s]));
        const prefs = state.prefs();
        let symbol = porSimbolo[prefs.symbol] ? prefs.symbol : catalogo.symbols[0].symbol;
        let timeframe = catalogo.timeframes.includes(prefs.timeframe) ? prefs.timeframe : '15m';

        let dib = null;
        const motor = engine.crear(document.getElementById('chart'), {
            onData: ({ demo, primera }) => {
                toolbar.setDemo(demo);
                mostrarEstado('');
                if (primera && dib) dib.restaurar();
            },
            onError: (msg) => mostrarEstado('No se pudieron cargar los precios: ' + msg, true),
        });

        dib = drawings.montar({
            chart: motor.chart,
            toolsEl: document.getElementById('chTools'),
            hintEl: document.getElementById('chHint'),
            getSymbol: () => symbol,
        });

        // PRO: el backend decide el acceso; esto solo muestra y dibuja.
        let ind = null;
        const pro = NLTCharts.pro.crear({
            chart: motor.chart,
            getSymbol: () => symbol,
            getTimeframe: () => timeframe,
            getRectangulo: () => dib.rectanguloComoZona(),
            onCambio: () => ind && ind.refrescarPanel(),
        });

        ind = indicators.montar({
            chart: motor.chart,
            panelEl: document.getElementById('chPanel'),
            panelBgEl: document.getElementById('chPanelBg'),
            activos: prefs.indicators,
            onCambio: (ids) => state.savePrefs({ indicators: ids }),
            pro,
        });

        const toolbar = ui.montarToolbar(document.getElementById('chToolbar'), {
            simbolos: catalogo.symbols,
            timeframes: catalogo.timeframes,
            symbol, timeframe,
            onSymbol: (s) => { symbol = s; state.savePrefs({ symbol }); cargar(); pro.cambioDeSimbolo(); },
            onTimeframe: (tf) => { timeframe = tf; toolbar.setTimeframe(tf); state.savePrefs({ timeframe }); cargar(); pro.refrescar(); },
            onIndicadores: () => ind.abrir(),
        });

        function cargar() {
            mostrarEstado('Cargando precios...');
            // Key Levels pide las diarias del símbolo: tiene que saberlo antes del recálculo.
            NLTCharts.freeIndicators.setSymbol(symbol);
            NLTCharts.unified.setContexto({ symbol, pricePrecision: porSimbolo[symbol].price_precision });
            motor.cargar(porSimbolo[symbol], timeframe);
        }
        cargar();
        pro.iniciar();
        window.NLTCharts.motor = motor; // para depurar desde la consola
    }

    init();
})();
