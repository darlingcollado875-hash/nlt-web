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

    // Generación del dataset en pantalla: sube con cada cambio de contexto (vivo <-> replay <-> backtest,
    // símbolo, timeframe, reset). Un resultado (indicador, Zone Engine) calculado en otra generación NUNCA
    // se dibuja: sus objetos serían de otro dataset (desplazados) o del presente dentro de un replay.
    let generacion = 0;
    const nuevaGeneracion = () => ++generacion;
    // NLT Bar Replay: mientras está activo, las velas (de cualquier timeframe) salen de la sesión de
    // replay, que nunca entrega nada posterior al cursor. Sin esto, Key Levels / Unified Suite verían el presente.
    let fuenteHistorica = null;
    // 'replay' (Bar Replay: el futuro no existe) o 'historico' (Ir a fecha: el gráfico muestra un tramo del pasado)
    let modoHistorico = null;
    // Caché de la última carga inicial por (símbolo, timeframe): cambiar de 5m a 1m y volver ya no espera al servidor. Lo que se
    // muestra de la caché puede estar atrasado unos minutos; la suscripción en vivo pide de inmediato las velas que falten (ver
    // `desde` en suscribir) y mientras tanto se refresca la caché en segundo plano.
    const cacheVelas = new Map();
    const CACHE_VELAS_MS = 10 * 60000, CACHE_FRESCA_MS = 20000;
    const claveVelas = (sym, tf) => `${sym}|${tf}`;
    const enVuelo = new Map();
    async function pedirVelas(symbol, timeframe, opciones) {
        const t0 = Date.now();
        const r = await NLT_API.chartsVelas(symbol, timeframe, opciones);
        if (r.server_time && NLTCharts.countdown && !opciones.sinCuenta) NLTCharts.countdown.sincronizar(r.server_time, t0, Date.now());
        // source: PRIMARY / BACKUP. Una serie nunca mezcla fuentes: si cambia, el motor recarga todo.
        return { demo: !!r.demo, provider: r.provider, source: r.source || 'primary', sourceState: r.source_state || null,
            precision: r.price_precision, velas: r.candles.map(aKline) };
    }
    async function velas(symbol, timeframe, { limit = LOTE, end = null, signal, cache = false } = {}) {
        if (fuenteHistorica) return fuenteHistorica(symbol, timeframe, { limit, end });
        const inicial = end == null && limit === LOTE;
        const k = claveVelas(symbol, timeframe);
        if (cache && inicial) {
            const c = cacheVelas.get(k);
            if (c && Date.now() - c.t < CACHE_VELAS_MS) {
                if (Date.now() - c.t > CACHE_FRESCA_MS) refrescarCache(symbol, timeframe);
                return { ...c.r, velas: c.r.velas.slice(), deCache: true, edadMs: Date.now() - c.t };
            }
        }
        const r = await pedirVelas(symbol, timeframe, { limit, end, signal });
        if (inicial) cacheVelas.set(k, { t: Date.now(), r });
        return r;
    }
    function refrescarCache(symbol, timeframe) {
        const k = claveVelas(symbol, timeframe);
        if (enVuelo.has(k)) return enVuelo.get(k);
        const p = pedirVelas(symbol, timeframe, { limit: LOTE, end: null, sinCuenta: true })
            .then((r) => { cacheVelas.set(k, { t: Date.now(), r }); })
            .catch(() => {})
            .finally(() => enVuelo.delete(k));
        enVuelo.set(k, p);
        return p;
    }
    // Temporalidades vecinas del gráfico, bajadas en segundo plano para que el próximo cambio sea instantáneo.
    const ORDEN_TF = ['1m', '5m', '15m', '30m', '1H', '4H', '1D'];
    let precargaTimer = null;
    function precargarVecinos(symbol, timeframe) {
        clearTimeout(precargaTimer);
        precargaTimer = setTimeout(async () => {
            try {
                if (fuenteHistorica || (navigator.connection && navigator.connection.saveData)) return;
                const i = ORDEN_TF.indexOf(timeframe);
                for (const tf of [ORDEN_TF[i - 1], ORDEN_TF[i + 1], ORDEN_TF[i - 2], ORDEN_TF[i + 2]].filter(Boolean)) {
                    const c = cacheVelas.get(claveVelas(symbol, tf));
                    if (c && Date.now() - c.t < 120000) continue;
                    if (document.hidden || fuenteHistorica) return;
                    await refrescarCache(symbol, tf);
                }
            } catch (_) { /* es solo una ayuda */ }
        }, 2500);
    }

    // Estado de la conexión con los precios (lo muestra la barra):
    //   conectado    el último refresco llegó bien, la última vela está al día y llegan datos nuevos
    //   retrasado    falló 1-2 refrescos, o el proveedor responde pero su última vela es vieja,
    //                o hace más de 3 min que no llega ningún dato nuevo con el mercado abierto
    //   desconectado 3 refrescos fallidos seguidos, o el navegador está sin red
    //   cerrado      forex/metales/índices en fin de semana, o metales en su pausa diaria
    const FALLOS_DESCONECTADO = 3, SIN_DATOS_MS = 20000;
    const REFRESCO_CERRADO_MS = 60000;   // mercado cerrado: nada cambia, se mira cada minuto
    let estado = 'conectando';
    const oyentesEstado = new Set();
    function fijarEstado(e, detalle) {
        if (e === estado && !detalle) return;
        estado = e;
        oyentesEstado.forEach((fn) => fn(e, detalle));
    }

    // Último dato: cuándo llegó por última vez algo NUEVO (un tick que cambió la vela en curso o
    // una vela nueva). Es lo que muestra la barra ("Conectado · datos 21:31:04"): nunca se
    // presenta una vela vieja como precio actual.
    const SIN_TICKS_MS = 180000;
    let ultimoDato = null;
    const oyentesDato = new Set();
    function marcarDato(ms) {
        ultimoDato = ms;
        oyentesDato.forEach((fn) => fn(ms));
    }

    // Categoría del símbolo en pantalla (la fija el motor al cargar): metales tienen pausa diaria.
    let categoria = '', operaFines = true;
    const fmtNY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
    // Forex, metales e índices: cerrados del viernes 17:00 al domingo 17:00 de Nueva York (sigue el
    // horario de verano de EE. UU.). Metales además pausan de 16:00 a 18:00 NY (MetaQuotes-Demo, 27/09).
    function mercadoCerrado(ahora = new Date(), cat = categoria) {
        const partes = Object.fromEntries(fmtNY.formatToParts(ahora).map((x) => [x.type, x.value]));
        const d = partes.weekday, h = parseInt(partes.hour, 10);
        if (d === 'Sat' || (d === 'Fri' && h >= 17) || (d === 'Sun' && h < 17)) return true;
        return cat === 'metals' && h >= 16 && h < 18;
    }
    function calcularEstado(ultimaVela, durMs, fines) {
        if (ultimaVela == null) return 'retrasado';
        const ahora = Date.now();
        const atraso = ahora - (ultimaVela + durMs);
        const fresco = ultimoDato == null || ahora - ultimoDato <= SIN_TICKS_MS;
        if (atraso <= Math.max(2 * durMs, 3 * 60000) && fresco) return 'conectado';   // vela al día y datos que llegan
        return !fines && mercadoCerrado(new Date(ahora)) ? 'cerrado' : 'retrasado';
    }

    // Refresca la vela en curso mientras la pestaña está visible. Pide desde
    // la última vela recibida hasta ahora (normalmente 2): si la pestaña
    // estuvo oculta o sin red un rato, llegan todas las velas que faltan y no
    // queda un hueco. El motor distingue por timestamp si actualiza o agrega.
    const DURACION_MS = { minute: 60000, hour: 3600000, day: 86400000 };
    function suscribir(symbol, timeframe, alRecibir, { operaFinDeSemana = true, fuente = null, alCambiarFuente = null, desde = null, inmediato = false } = {}) {
        const p = PERIODOS[timeframe];
        const durMs = DURACION_MS[p.type] * p.span;
        let vivo = true;
        let timer = null;
        let ultimo = desde != null ? desde : null;     // `desde`: última vela que ya está en el gráfico (carga desde caché): completa lo que falte
        let enCurso = false;
        let fallos = 0, okAt = Date.now();
        let firmaUltima = null;
        const firma = (v) => `${v.open}|${v.high}|${v.low}|${v.close}|${v.volume}`;
        async function tick() {
            clearTimeout(timer);
            if (!vivo || enCurso) return;
            if (!navigator.onLine) { fijarEstado('desconectado'); }
            else if (document.visibilityState === 'visible') {
                enCurso = true;
                const faltan = ultimo == null ? 2 : Math.ceil((Date.now() - ultimo) / durMs) + 1;
                try {
                    const r = await velas(symbol, timeframe, { limit: Math.min(Math.max(faltan, 2), 1500) });
                    if (vivo && fuente && r.source && r.source !== fuente && alCambiarFuente) {
                        // PRIMARY <-> BACKUP: estas velas son de otra cuenta; no se pegan a la serie en pantalla
                        vivo = false; enCurso = false;
                        alCambiarFuente(r.source);
                        return;
                    }
                    if (vivo) {
                        // ¿llegó algo nuevo? (vela nueva, o la vela en curso cambió con un tick)
                        const nuevo = r.velas.some((v) => (ultimo == null ? v.timestamp + durMs > Date.now() : v.timestamp > ultimo)
                            || (v.timestamp === ultimo && firma(v) !== firmaUltima));
                        r.velas.forEach((v) => { alRecibir(v); ultimo = v.timestamp; firmaUltima = firma(v); });
                        if (nuevo) marcarDato(Date.now());
                        fallos = 0; okAt = Date.now();
                        fijarEstado(calcularEstado(ultimo, durMs, operaFinDeSemana));
                    }
                } catch (err) {
                    // un refresco fallido se reintenta en el próximo tick; los datos en pantalla se quedan
                    fallos += 1;
                    const caido = fallos >= FALLOS_DESCONECTADO || Date.now() - okAt > SIN_DATOS_MS;
                    if (vivo) fijarEstado(caido ? 'desconectado' : 'retrasado', err && err.message);
                }
                enCurso = false;
            }
            if (vivo) timer = setTimeout(tick, estado === 'cerrado' ? REFRESCO_CERRADO_MS : REFRESCO_MS);
        }
        const alVolver = () => { if (document.visibilityState === 'visible') tick(); };
        const alConectar = () => tick();
        const alPerder = () => fijarEstado('desconectado');
        document.addEventListener('visibilitychange', alVolver);
        window.addEventListener('online', alConectar);
        window.addEventListener('offline', alPerder);
        timer = setTimeout(tick, inmediato ? 0 : REFRESCO_MS);
        return () => {
            vivo = false; clearTimeout(timer);
            document.removeEventListener('visibilitychange', alVolver);
            window.removeEventListener('online', alConectar);
            window.removeEventListener('offline', alPerder);
        };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.market = {
        PERIODOS,
        TIMEFRAMES: Object.keys(PERIODOS),
        LOTE,
        simbolos: () => NLT_API.chartsSimbolos(),
        velas,
        precargarVecinos,
        limpiarCacheVelas: () => cacheVelas.clear(),
        suscribir,
        fijarEstado,
        estado: () => estado,
        alCambiarEstado(fn) { oyentesEstado.add(fn); return () => oyentesEstado.delete(fn); },
        mercadoCerrado,
        calcularEstado,
        marcarDato,
        ultimoDato: () => ultimoDato,
        alRecibirDato(fn) { oyentesDato.add(fn); return () => oyentesDato.delete(fn); },
        fijarCategoria(c, fines = true) { categoria = c || ''; operaFines = fines !== false; },
        // ¿el instrumento en pantalla está cerrado en `fecha` (fin de semana o pausa de metales)?
        cerradoAhora: (fecha = new Date()) => !operaFines && mercadoCerrado(fecha, categoria),
        fijarFuenteHistorica(fn, modo = 'replay') { fuenteHistorica = fn || null; modoHistorico = fn ? modo : null; nuevaGeneracion(); },
        generacion: () => generacion,
        nuevaGeneracion,
        enReplay: () => modoHistorico === 'replay',
        // Ir a fecha / Ir a año: el gráfico muestra un tramo del pasado (los indicadores piden hasta ese tramo)
        enHistorico: () => modoHistorico === 'historico',
        // Histórico profundo (capa compartida del servidor): velas CERRADAS de [desde, hasta)
        async historia(symbol, timeframe, desde, hasta, { signal, timeoutMs } = {}) {
            const r = await NLT_API.chartsHistoria(symbol, timeframe, desde, hasta, { signal, timeoutMs });
            return { source: r.source || 'primary', cache: r.cache || {}, covered: r.covered || [], velas: r.candles.map((c) => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] })) };
        },
    };
})();
