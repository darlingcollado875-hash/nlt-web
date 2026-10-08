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
        // Métricas de carga (desde "Ir a esa vela"): TTFV = primera vela en pantalla, TTIR = indicadores
        // recalculados sobre el dataset del replay, TTZR = dibujo del NLT Zone Engine en el cursor.
        st.met = null;
        const precalentados = new Map();
        function precalentar() {
            const k = `${app.simbolo()}|${app.timeframe()}`;
            if (Date.now() - (precalentados.get(k) || 0) < 300000) return;
            precalentados.set(k, Date.now());
            NLT_API.chartsReplayPrecalentar && NLT_API.chartsReplayPrecalentar(app.simbolo(), app.timeframe()).catch(() => {});
        }
        function indicadoresListos() {
            const F = NLTCharts.fluidez, dl = chart.getDataList();
            if (!F || !dl.length) return false;
            return chart.getIndicators().every((ind) => {
                if (ind.name === 'NLT_UNIFIED') { const s0 = NLTCharts.unified.salidaActual(ind.id); return !!s0 && F.firmaValida(s0.firma, dl); }
                return !ind.result || F.firmaValida(F.firmaDeResultado(ind.result), dl);
            });
        }
        function vigilar(mio) {
            const m = st.met, t0 = m.inicio;
            const tick = () => {
                if (mio !== op || !st.activo) return;
                const ahora = performance.now();
                if (m.ttir == null && indicadoresListos()) m.ttir = Math.round(ahora - t0);
                const conZE = app.pro.visible && app.pro.visible();
                if (m.ttzr == null && (!conZE || app.pro.dibujoActual())) m.ttzr = conZE ? Math.round(ahora - t0) : 'sin Zone Engine';
                const prep = conZE && m.ttzr == null;
                if (prep !== st.preparandoZE) { st.preparandoZE = prep; pintar(); }
                if ((m.ttir == null || m.ttzr == null) && ahora - t0 < 180000) setTimeout(tick, 100);
                else {
                    if (m.ttir != null && m.ttzr != null && !m.vecinos) { m.vecinos = true; setTimeout(() => precalentarVecinos(mio), 1500); }
                    if (window.NLT_DEBUG || /[?&]diag=1/.test(location.search)) console.info('[replay] métricas', JSON.stringify(m));
                }
            };
            tick();
        }
        // Cuando el replay ya está listo, en segundo plano se baja a la caché compartida del servidor la historia de las
        // temporalidades vecinas EN ESTE MISMO MOMENTO: cambiar de 5m a 1m deja de esperar a TickerAll (15-20 s) porque el
        // servidor ya la tiene. Una a la vez, sin competir con el replay, y solo con la pestaña a la vista.
        const ORDEN_TF = ['1m', '5m', '15m', '30m', '1H', '4H', '1D'];
        async function precalentarVecinos(mio) {
            try {
                if (navigator.connection && navigator.connection.saveData) return;
                if (!st.ses || !NLT_API.chartsHistoria) return;
                const i = ORDEN_TF.indexOf(st.ses.timeframe);
                const vecinos = [ORDEN_TF[i - 1], ORDEN_TF[i + 1], ORDEN_TF[i - 2]].filter(Boolean);
                for (const tf of vecinos) {
                    if (mio !== op || !st.activo || !st.ses) return;
                    while (document.hidden) { await new Promise((r) => setTimeout(r, 2000)); if (mio !== op || !st.activo) return; }
                    const cierre = st.ses.cursor_ts + DUR[st.ses.timeframe], inicio = cierre - DUR[tf];
                    const desde = inicio - 600 * DUR[tf] * 1.5, hasta = Math.min(Date.now(), inicio + 450 * DUR[tf] * 1.6);
                    if (hasta > desde) await NLT_API.chartsHistoria(st.ses.symbol, tf, desde, hasta, { timeoutMs: 120000 }).catch(() => {});
                }
            } catch (_) { /* es solo una ayuda: nunca molesta */ }
        }

        function limpiarCaches() {
            NLTCharts.unified && NLTCharts.unified.limpiarCache && NLTCharts.unified.limpiarCache();
            NLTCharts.freeIndicators && NLTCharts.freeIndicators.limpiarCache && NLTCharts.freeIndicators.limpiarCache();
        }
        function fuenteHistorica(symbol, tf, { limit }) {
            if (!st.ses || symbol !== st.ses.symbol) return Promise.resolve({ demo: false, provider: 'replay', velas: [] });
            return NLT_API.chartsReplayVelas(st.ses.id, tf, Math.min(limit || 500, 1500))
                .then((r) => ({ demo: false, provider: 'replay', precision: st.ses.price_precision, velas: r.candles.map(aK) }));
        }

        const trans = () => (app.transicion ? app.transicion() : null);
        async function iniciar(symbol, tf, inicioMs, etiqueta) {
            detener();
            if (NLTCharts.backtestLab) NLTCharts.backtestLab.salirGrafico();
            const mio = ++op;
            const t0 = performance.now();
            st.cargando = true; st.error = ''; pintar();
            if (trans()) trans().iniciar(etiqueta || 'Preparando el replay');
            let r;
            try {
                // si el servidor de precios tarda de más con una fecha lejana, un segundo intento suele salir de la caché que dejó el primero
                try { r = await NLT_API.chartsReplayCrear(symbol, tf, inicioMs, 60000); }
                catch (e1) { if (mio !== op || !/tard[óo] demasiado/i.test(e1.message || '')) throw e1; r = await NLT_API.chartsReplayCrear(symbol, tf, inicioMs, 90000); }
            } catch (err) { if (mio === op) { st.error = err.message; st.cargando = false; if (trans()) trans().terminar(); if (app.sincronizarToolbar) app.sincronizarToolbar(); pintar(); } return; }
            if (mio !== op) { NLT_API.chartsReplayCerrar(r.id).catch(() => {}); return; }   // ya no la quiere nadie
            if (st.ses && st.ses.id !== r.id) NLT_API.chartsReplayCerrar(st.ses.id).catch(() => {});
            st.ses = r; st.cargando = false;
            st.met = { inicio: t0, servidor_ms: r.timings_ms || null, respuesta: Math.round(performance.now() - t0), ttfv: null, ttir: null, ttzr: null };
            st.preparandoZE = true;
            activar(r.candles.map(aK));
            requestAnimationFrame(() => { if (mio === op && st.met) st.met.ttfv = Math.round(performance.now() - t0); });
            vigilar(mio);
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
        // Si la vela en curso quedó fuera de la pantalla (arrastraste el gráfico hacia la historia, o elegiste una
        // vela de partida y después lo moviste), el replay seguía avanzando pero NO se veía. Aquí el gráfico la
        // sigue: solo se mueve cuando la última vela está fuera del área visible; si la tienes a la vista no se toca.
        function seguirUltimaVela() {
            try {
                const dl = chart.getDataList(), n = dl.length;
                if (!n) return;
                const ancho = (chart.getSize('candle_pane', 'main') || {}).width;
                const x = chart.convertToPixel({ dataIndex: n - 1, value: 0 }, { paneId: 'candle_pane' }).x;
                if (!ancho || x == null || (x >= ancho * 0.04 && x <= ancho * 0.96)) return;
                chart.scrollToRealTime();
            } catch (_) { /* sin tamaño todavía: la próxima vela lo intenta */ }
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
                if (r.candles.length) { app.pro.velaNueva(); seguirUltimaVela(); }
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
            const tick = async () => { const t0 = performance.now(); if (await siguiente(n)) st.timer = setTimeout(tick, Math.max(0, intervalo - (performance.now() - t0))); };   // el ritmo cuenta lo que tardó el servidor
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
            iniciar(symbol, tf, cierre - DUR[tf], symbol !== st.ses.symbol ? `Cargando ${symbol} ${tf}` : `Cambiando a ${tf}`);
        }
        function salir() {
            detener();
            ++op; st.cargando = false; st.pidiendo = false; st.preparandoZE = false;
            if (trans()) trans().terminar();
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

        // ── barra movible y ocultable: no tapa los botones de operar / las velas ──
        let pos = null;
        try { pos = JSON.parse(localStorage.getItem('nlt_replay_pos') || 'null'); st.min = localStorage.getItem('nlt_replay_min') === '1'; } catch (_) { pos = null; }
        function aplicarPos() {
            const pr = el.parentElement && el.parentElement.getBoundingClientRect();
            if (!pos || !pr || !pr.width) { el.style.left = el.style.top = el.style.transform = ''; return; }
            const w = el.offsetWidth || 200, h = el.offsetHeight || 40;
            const x = Math.max(4, Math.min(pr.width - w - 4, pos.x)), y = Math.max(4, Math.min(pr.height - h - 4, pos.y));
            el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.transform = 'none';
        }
        el.addEventListener('pointerdown', (ev) => {
            const g = ev.target.closest('.rp-grip');
            if (!g || ev.button > 0) return;
            const pr = el.parentElement.getBoundingClientRect(), r = el.getBoundingClientRect();
            const dx = ev.clientX - r.left, dy = ev.clientY - r.top;
            ev.preventDefault();
            try { g.setPointerCapture(ev.pointerId); } catch (_) { /* navegador sin captura */ }
            const mover = (e) => { pos = { x: e.clientX - pr.left - dx, y: e.clientY - pr.top - dy }; aplicarPos(); };
            const soltar = () => {
                g.removeEventListener('pointermove', mover); g.removeEventListener('pointerup', soltar); g.removeEventListener('pointercancel', soltar);
                try { localStorage.setItem('nlt_replay_pos', JSON.stringify(pos)); } catch (_) { /* sin almacenamiento */ }
            };
            g.addEventListener('pointermove', mover); g.addEventListener('pointerup', soltar); g.addEventListener('pointercancel', soltar);
        });
        window.addEventListener('resize', () => { if (!el.hidden) aplicarPos(); });
        // doble toque en el título: vuelve a su lugar de siempre
        el.addEventListener('dblclick', (ev) => { if (ev.target.closest('.rp-grip')) { pos = null; try { localStorage.removeItem('nlt_replay_pos'); } catch (_) { /* nada */ } aplicarPos(); } });

        function pintar() {
            boton.classList.toggle('on', st.abierto || st.activo);
            el.hidden = !(st.abierto || st.activo);
            if (el.hidden) return;
            const s = st.ses;
            const corriendo = !!st.timer;
            el.classList.toggle('rp-min', !!st.min && st.activo);
            aplicarPos();
            el.innerHTML = `
                <b class="rp-t rp-grip" title="Arrastra para mover la barra"><i class="ph ph-dots-six-vertical"></i><i class="ph ph-clock-counter-clockwise"></i><span class="rp-tt"> BAR REPLAY</span></b>
                ${st.activo ? `
                    <button type="button" class="rp-b rp-ex" data-a="reset" title="RESET: volver a la vela de partida"><i class="ph ph-skip-back"></i></button>
                    <button type="button" class="rp-b rp-play" data-a="${corriendo ? 'pause' : 'play'}" title="${corriendo ? 'PAUSE' : 'PLAY'}"><i class="ph-fill ${corriendo ? 'ph-pause' : 'ph-play'}"></i></button>
                    <button type="button" class="rp-b" data-a="next" title="NEXT BAR: una vela" ${st.pidiendo && !corriendo ? 'disabled' : ''}><i class="ph ph-skip-forward"></i><span>Next bar</span></button>
                    <select class="rp-ex" data-k="vel" aria-label="Velocidad">${VELOCIDADES.map((v) => `<option value="${v}"${v === st.vel ? ' selected' : ''}>${v}x</option>`).join('')}</select>
                    <span class="rp-cur rp-ex" title="Última vela visible (cerrada)">${esc(s.symbol)} ${esc(s.timeframe)} · ${esc(fmt(s.cursor_ts))}</span>
                    ${st.cargando ? '<span class="rp-cur rp-load"><i class="ph ph-spinner"></i> Cargando replay…</span>'
                        : st.preparandoZE ? '<span class="rp-cur rp-load"><i class="ph ph-spinner"></i> Preparando NLT Zone Engine…</span>' : ''}
                    <button type="button" class="rp-b rp-ex" data-a="elegir" title="Elegir otra vela en el gráfico"><i class="ph ph-crosshair"></i></button>
                    <button type="button" class="rp-b rp-keep" data-a="min" title="${st.min ? 'Mostrar la barra completa' : 'Ocultar la barra (sigue funcionando)'}" aria-label="${st.min ? 'Mostrar la barra' : 'Ocultar la barra'}"><i class="ph ${st.min ? 'ph-arrows-out-simple' : 'ph-minus'}"></i></button>
                    <button type="button" class="rp-b rp-x rp-ex" data-a="salir" title="Salir del replay (volver al vivo)"><i class="ph ph-x"></i><span>Salir</span></button>`
                : `
                    <span class="rp-cur">${esc(app.simbolo())} ${esc(app.timeframe())}</span>
                    <input type="date" data-k="fecha" value="${esc(st.fecha)}" aria-label="Fecha">
                    <input type="time" data-k="hora" value="${esc(st.hora)}" step="60" aria-label="Hora">
                    <button type="button" class="rp-b rp-play" data-a="ir" ${st.cargando ? 'disabled' : ''}><i class="ph ph-clock-counter-clockwise"></i><span>${st.cargando ? 'Cargando…' : 'Ir a esa vela'}</span></button>
                    <button type="button" class="rp-b ${st.eligiendo ? 'on' : ''}" data-a="elegir" title="Toca una vela del gráfico"><i class="ph ph-crosshair"></i><span>${st.eligiendo ? 'Toca una vela…' : 'Elegir en el gráfico'}</span></button>
                    <button type="button" class="rp-b rp-x" data-a="cerrar" aria-label="Cerrar"><i class="ph ph-x"></i></button>`}
                ${st.error ? `<span class="rp-err">${esc(st.error)}</span>` : ''}`;
            aplicarPos();
        }
        el.addEventListener('click', (ev) => {
            const a = ev.target.closest('[data-a]');
            if (!a) return;
            ({
                ir: () => iniciar(app.simbolo(), app.timeframe(), new Date(`${st.fecha}T${st.hora || '00:00'}`).getTime()),
                play: () => play(),
                pause: () => { detener(); pintar(); },
                min: () => { st.min = !st.min; try { localStorage.setItem('nlt_replay_min', st.min ? '1' : '0'); } catch (_) { /* sin almacenamiento */ } pintar(); },
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
        boton.addEventListener('click', () => { if (st.activo) return; st.abierto = !st.abierto; if (st.abierto) precalentar(); pintar(); });

        const api = {
            activo: () => st.activo, cambiar, salir,
            estado: () => ({ activo: st.activo, cargando: st.cargando, op, metricas: st.met && { ...st.met, inicio: undefined }, sesion: st.ses && { id: st.ses.id, cursor_ts: st.ses.cursor_ts, symbol: st.ses.symbol, timeframe: st.ses.timeframe, has_more: st.ses.has_more } }),
            iniciar, siguiente, play, detener, reiniciar,
        };
        window.NLTCharts.replayApi = api;
        return api;
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.replay = { montar };
})();
