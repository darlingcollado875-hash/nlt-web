/* NLT Charts -- NLT BAR REPLAY.
 *
 * "Viajar hacia atrás en el mercado": el usuario elige símbolo, timeframe y la vela exacta (fecha +
 * hora, o tocándola en el gráfico) y el gráfico queda en ese momento. El FUTURO NO ESTÁ EN EL
 * NAVEGADOR: la sesión de replay vive en el servidor (/charts/replay/*) y solo entrega velas hasta
 * el cursor; NEXT BAR trae exactamente una vela más. No se esconde nada con CSS.
 *
 * Durante el replay el gráfico es el de siempre (engine.modoExterno + empujar): crosshair, zoom,
 * pan, todas las herramientas de dibujo e indicadores. Los indicadores calculan sobre las velas que
 * tiene el gráfico (las visibles), y las de otro timeframe que piden (Key Levels, Unified Suite)
 * salen de la sesión, recortadas al cursor (market.fijarFuenteHistorica). El NLT Zone Engine se
 * calcula en el servidor en el cursor, con el mismo motor, vela por vela (pro.fijarFuente). NLT AI
 * y los precios de la watchlist quedan en pausa (serían el presente). */
(function () {
    const VELOCIDADES = [0.5, 1, 2, 5, 10, 25];
    const DUR = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1H': 3600000, '4H': 14400000, '1D': 86400000 };
    const esc = (t) => NLTCharts.ui.esc(t);
    const dos = (n) => String(n).padStart(2, '0');
    const fechaLocal = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`; };
    const horaLocal = (ms) => { const d = new Date(ms); return `${dos(d.getHours())}:${dos(d.getMinutes())}`; };
    const fmt = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const aK = (c) => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] });

    function montar({ el, boton }) {
        if (!el || !boton) return null;
        const app = NLTCharts.app, motor = app.motor, chart = motor.chart, market = NLTCharts.market;
        const ayer = Date.now() - 86400000;
        const st = { abierto: false, activo: false, ses: null, timer: null, vel: 1, cargando: false, pidiendo: false, error: '',
            fecha: fechaLocal(ayer), hora: '10:00', eligiendo: false, zeVisible: null };
        // Token de operación (race LIVE <-> replay): iniciar / reset / salir lo incrementan y toda respuesta
        // que llega con un token viejo se descarta. Sin esto, salir del replay mientras se creaba una sesión
        // (p. ej. un cambio de timeframe lento) volvía a meter al usuario en el replay al llegar la
        // respuesta, y un NEXT o un RESET en vuelo podía empujar velas de otra sesión al gráfico.
        let op = 0;

        function limpiarCaches() {
            NLTCharts.unified && NLTCharts.unified.limpiarCache && NLTCharts.unified.limpiarCache();
            NLTCharts.freeIndicators && NLTCharts.freeIndicators.limpiarCache && NLTCharts.freeIndicators.limpiarCache();
        }
        function fuenteHistorica(symbol, tf, { limit }) {
            if (!st.ses || symbol !== st.ses.symbol) return Promise.resolve({ demo: false, provider: 'replay', velas: [] });
            return NLT_API.chartsReplayVelas(st.ses.id, tf, Math.min(limit || 500, 1500))
                .then((r) => ({ demo: false, provider: 'replay', precision: st.ses.price_precision, velas: r.candles.map(aK) }));
        }

        async function iniciar(symbol, tf, inicioMs) {
            detener();
            if (NLTCharts.backtestLab) NLTCharts.backtestLab.salirGrafico();
            const mio = ++op;
            st.cargando = true; st.error = ''; pintar();
            let r;
            try {
                r = await NLT_API.chartsReplayCrear(symbol, tf, inicioMs);
            } catch (err) { if (mio === op) { st.error = err.message; st.cargando = false; pintar(); } return; }
            if (mio !== op) { NLT_API.chartsReplayCerrar(r.id).catch(() => {}); return; }   // ya no la quiere nadie
            if (st.ses && st.ses.id !== r.id) NLT_API.chartsReplayCerrar(st.ses.id).catch(() => {});
            st.ses = r; st.cargando = false;
            activar(r.candles.map(aK));
        }
        function activar(klines) {
            const r = st.ses;
            const mismo = app.simbolo() === r.symbol && app.timeframe() === r.timeframe;
            st.activo = true;
            market.fijarFuenteHistorica(fuenteHistorica);        // antes de cargar: los indicadores ya piden a la sesión
            limpiarCaches();
            motor.modoExterno({ velas: klines }, false);
            app.irA(r.symbol, r.timeframe);
            if (mismo) chart.resetData();
            market.fijarEstado('replay');
            app.pro.fijarFuente((entradas) => NLT_API.chartsReplayZE(st.ses.id, entradas));
            pintar();
        }
        async function siguiente(n = 1) {
            if (!st.activo || st.pidiendo) return false;
            st.pidiendo = true;
            const mio = op;
            let mas = false;
            try {
                const r = await NLT_API.chartsReplayNext(st.ses.id, n);
                if (mio !== op) { st.pidiendo = false; return false; }   // otra sesión / reset / salida en el medio
                st.ses = { ...st.ses, ...r, candles: undefined };
                limpiarCaches();
                r.candles.forEach((c) => motor.empujar(aK(c)));
                if (r.candles.length) app.pro.velaNueva();
                mas = r.has_more;
                if (!mas) { detener(); st.error = 'Fin de los datos cargados para este replay.'; }
            } catch (err) { if (mio !== op) { st.pidiendo = false; return false; } st.error = err.message; detener(); }
            st.pidiendo = false;
            pintar();
            return mas;
        }
        function play() {
            detener();
            const intervalo = Math.max(120, 1000 / st.vel);
            const n = Math.max(1, Math.round(st.vel * intervalo / 1000));   // 25x: 3 velas cada 120 ms
            const tick = async () => { if (await siguiente(n)) st.timer = setTimeout(tick, intervalo); };
            st.timer = setTimeout(tick, intervalo);
            pintar();
        }
        function detener() { clearTimeout(st.timer); st.timer = null; }
        async function reiniciar() {
            detener();
            if (!st.ses) return;
            const mio = ++op;
            try {
                const r = await NLT_API.chartsReplayReset(st.ses.id);
                if (mio !== op) return;
                st.ses = { ...st.ses, ...r, candles: undefined }; st.error = '';
                limpiarCaches();
                motor.modoExterno({ velas: r.candles.map(aK) });
                app.pro.velaNueva();
            } catch (err) { if (mio !== op) return; st.error = err.message; }
            pintar();
        }
        // Otro símbolo o timeframe durante el replay: nueva sesión en el MISMO momento. La última vela
        // visible del nuevo timeframe es la que ya cerró a esa hora (una vela más larga en curso no se
        // muestra entera: tendría el futuro).
        function cambiar(symbol, tf) {
            if (!st.ses) return;
            const cierre = st.ses.cursor_ts + DUR[st.ses.timeframe];
            iniciar(symbol, tf, cierre - DUR[tf]);
        }
        function salir() {
            detener();
            ++op; st.cargando = false; st.pidiendo = false;
            if (st.ses) NLT_API.chartsReplayCerrar(st.ses.id).catch(() => {});
            const estaba = st.activo;
            st.activo = false; st.ses = null; st.error = ''; st.eligiendo = false;
            market.fijarFuenteHistorica(null);
            limpiarCaches();
            app.pro.fijarFuente(null);
            if (estaba) { market.fijarEstado('conectando'); motor.modoExterno(null); }
            pintar();
        }

        // Elegir la vela tocándola en el gráfico (antes de empezar o durante el replay para "saltar atrás")
        chart.getDom && chart.getDom().addEventListener('click', (ev) => {
            if (!st.eligiendo) return;
            try {
                const r = chart.getDom().getBoundingClientRect();
                const [p] = chart.convertFromPixel([{ x: ev.clientX - r.left, y: ev.clientY - r.top }], { paneId: 'candle_pane' });
                const dl = chart.getDataList();
                const v = dl[Math.max(0, Math.min(dl.length - 1, p.dataIndex))];
                if (!v) return;
                st.eligiendo = false;
                st.fecha = fechaLocal(v.timestamp); st.hora = horaLocal(v.timestamp);
                iniciar(app.simbolo(), app.timeframe(), v.timestamp);
            } catch (_) { /* fuera de las velas */ }
        }, true);

        function pintar() {
            boton.classList.toggle('on', st.abierto || st.activo);
            el.hidden = !(st.abierto || st.activo);
            if (el.hidden) return;
            const s = st.ses;
            const corriendo = !!st.timer;
            el.innerHTML = `
                <b class="rp-t"><i class="ph ph-clock-counter-clockwise"></i> BAR REPLAY</b>
                ${st.activo ? `
                    <button type="button" class="rp-b" data-a="reset" title="RESET: volver a la vela de partida"><i class="ph ph-skip-back"></i></button>
                    <button type="button" class="rp-b rp-play" data-a="${corriendo ? 'pause' : 'play'}" title="${corriendo ? 'PAUSE' : 'PLAY'}"><i class="ph-fill ${corriendo ? 'ph-pause' : 'ph-play'}"></i></button>
                    <button type="button" class="rp-b" data-a="next" title="NEXT BAR: una vela" ${st.pidiendo && !corriendo ? 'disabled' : ''}><i class="ph ph-skip-forward"></i><span>Next bar</span></button>
                    <select data-k="vel" aria-label="Velocidad">${VELOCIDADES.map((v) => `<option value="${v}"${v === st.vel ? ' selected' : ''}>${v}x</option>`).join('')}</select>
                    <span class="rp-cur" title="Última vela visible (cerrada)">${esc(s.symbol)} ${esc(s.timeframe)} · ${esc(fmt(s.cursor_ts))}</span>
                    ${st.cargando ? '<span class="rp-cur rp-load"><i class="ph ph-spinner"></i> Cargando replay…</span>' : ''}
                    <button type="button" class="rp-b" data-a="elegir" title="Elegir otra vela en el gráfico"><i class="ph ph-crosshair"></i></button>
                    <button type="button" class="rp-b rp-x" data-a="salir" title="Salir del replay (volver al vivo)"><i class="ph ph-x"></i><span>Salir</span></button>`
                : `
                    <span class="rp-cur">${esc(app.simbolo())} ${esc(app.timeframe())}</span>
                    <input type="date" data-k="fecha" value="${esc(st.fecha)}" aria-label="Fecha">
                    <input type="time" data-k="hora" value="${esc(st.hora)}" step="60" aria-label="Hora">
                    <button type="button" class="rp-b rp-play" data-a="ir" ${st.cargando ? 'disabled' : ''}><i class="ph ph-clock-counter-clockwise"></i><span>${st.cargando ? 'Cargando…' : 'Ir a esa vela'}</span></button>
                    <button type="button" class="rp-b ${st.eligiendo ? 'on' : ''}" data-a="elegir" title="Tocá una vela del gráfico"><i class="ph ph-crosshair"></i><span>${st.eligiendo ? 'Tocá una vela…' : 'Elegir en el gráfico'}</span></button>
                    <button type="button" class="rp-b rp-x" data-a="cerrar" aria-label="Cerrar"><i class="ph ph-x"></i></button>`}
                ${st.error ? `<span class="rp-err">${esc(st.error)}</span>` : ''}`;
        }
        el.addEventListener('click', (ev) => {
            const a = ev.target.closest('[data-a]');
            if (!a) return;
            ({
                ir: () => iniciar(app.simbolo(), app.timeframe(), new Date(`${st.fecha}T${st.hora || '00:00'}`).getTime()),
                play: () => play(),
                pause: () => { detener(); pintar(); },
                next: () => { detener(); siguiente(1); },
                reset: () => reiniciar(),
                elegir: () => { st.eligiendo = !st.eligiendo; pintar(); },
                salir: () => { salir(); st.abierto = false; pintar(); },
                cerrar: () => { st.abierto = false; st.eligiendo = false; pintar(); },
            }[a.dataset.a] || (() => {}))();
        });
        el.addEventListener('change', (ev) => {
            const k = ev.target.dataset.k;
            if (!k) return;
            if (k === 'vel') { st.vel = +ev.target.value; if (st.timer) play(); return; }
            st[k] = ev.target.value;
        });
        // Atajo: flecha derecha = NEXT BAR (como en TradingView), solo con el replay activo
        document.addEventListener('keydown', (ev) => {
            if (!st.activo || ev.key !== 'ArrowRight' || ev.shiftKey || /input|select|textarea/i.test(ev.target.tagName)) return;
            ev.preventDefault(); detener(); siguiente(1);
        });
        boton.addEventListener('click', () => { if (st.activo) return; st.abierto = !st.abierto; pintar(); });

        const api = {
            activo: () => st.activo, cambiar, salir,
            estado: () => ({ activo: st.activo, cargando: st.cargando, op, sesion: st.ses && { id: st.ses.id, cursor_ts: st.ses.cursor_ts, symbol: st.ses.symbol, timeframe: st.ses.timeframe, has_more: st.ses.has_more } }),
            iniciar, siguiente, play, detener, reiniciar,
        };
        window.NLTCharts.replayApi = api;
        return api;
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.replay = { montar };
})();
