/* NLT Charts -- NLT BACKTEST LAB (vertical slice).
 *
 * El backtest corre ENTERO en el servidor (/charts/backtest/*) con el motor real del NLT Zone
 * Engine: acá no hay lógica PRO. Este archivo arma el panel (Configurar · Resultados ·
 * Operaciones · Replay), manda la configuración, muestra el progreso real del job y, al
 * terminar, pone el gráfico en "modo histórico" (engine.modoExterno) con las velas del backtest
 * y dibuja encima entradas, salidas, SL/TP y zonas (indicador NLT_BACKTEST, canvas).
 *
 * Bar Replay: el mismo resultado, revelado vela por vela (el futuro no está en el gráfico:
 * las velas se empujan de a una). Operaciones, zonas y estado del motor aparecen solo cuando
 * su vela ya pasó. Nada de esto recalcula en el navegador: es el mismo backtest del servidor. */
(function () {
    const IND = 'NLT_BACKTEST';
    const VELOCIDADES = [0.5, 1, 2, 5, 10, 25];
    const TABS = [['config', 'Configurar', 'ph-sliders-horizontal'], ['resultados', 'Resultados', 'ph-chart-line-up'],
        ['operaciones', 'Operaciones', 'ph-list-bullets'], ['replay', 'Replay', 'ph-play-circle']];
    const DIA = 86400000;

    const esc = (t) => NLTCharts.ui.esc(t);
    const fmtDinero = (x) => (x == null ? '—' : `${x < 0 ? '-' : ''}$${Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    const fmtFecha = (ms) => (ms == null ? '—' : new Date(ms).toLocaleString([], { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }));
    const fmtDur = (min) => (min < 60 ? `${Math.round(min)} min` : min < 1440 ? `${(min / 60).toFixed(1)} h` : `${(min / 1440).toFixed(1)} d`);
    const isoDia = (ms) => new Date(ms).toISOString().slice(0, 10);

    function montar({ el, boton, simbolos }) {
        if (!el || !boton) return null;
        const app = NLTCharts.app, motor = app.motor, chart = motor.chart;
        const st = {
            abierto: false, tab: 'config', cfg: null, presetsUsuario: [], presetsMsg: '',
            job: null, poll: null, res: null, velas: null, precision: 5, sel: null, enGrafico: false, zeVisible: null,
            filtros: { resultado: '', lado: '', zona: '', sesion: '', desde: '', hasta: '' }, orden: { k: 'entrada_ts', dir: 1 },
            replay: { activo: false, cursor: 0, timer: null, vel: 1, klines: [] }, verZonas: true,
        };
        const form = {
            symbol: app.simbolo(), timeframe: app.timeframe(), desde: isoDia(Date.now() - 90 * DIA), hasta: isoDia(Date.now()),
            preset: 'nlt-zone-engine', modoZE: 'normal', estilo: 'CONFIRMADO',
            strategy: {}, execution: {},
        };

        // ───────────── dibujo en el gráfico (canvas, solo lo visible) ─────────────
        let idxCache = { k: '', f: null };
        function indexador(dl) {
            const k = `${dl.length}|${dl[0].timestamp}|${dl[dl.length - 1].timestamp}`;
            if (idxCache.k === k) return idxCache.f;
            const mapa = new Map(dl.map((d, i) => [d.timestamp, i]));
            const last = dl[dl.length - 1].timestamp;
            const f = (ts) => {
                const v = mapa.get(ts);
                if (v !== undefined) return v;
                if (ts > last) return dl.length - 1;
                let lo = 0, hi = dl.length - 1;
                while (lo < hi) { const m = (lo + hi + 1) >> 1; if (dl[m].timestamp <= ts) lo = m; else hi = m - 1; }
                return lo;
            };
            idxCache = { k, f };
            return f;
        }
        function dibujar({ ctx, chart: ch, xAxis, yAxis }) {
            if (!st.enGrafico || !st.res) return false;
            const dl = ch.getDataList();
            if (!dl.length) return false;
            const idx = indexador(dl), cursor = dl[dl.length - 1].timestamp;
            const { from, to } = ch.getVisibleRange();
            const X = (i) => xAxis.convertToPixel(i), Y = (p) => yAxis.convertToPixel(p);
            const esp = ch.getBarSpace().bar;
            ctx.save();
            // zonas del motor (OB / FVG) mientras estuvieron vivas, hasta el cursor
            if (st.verZonas) {
                st.res.zones.forEach((z) => {
                    if (z.desde_ts > cursor) return;
                    const a = idx(z.desde_ts), b = idx(Math.min(z.hasta_ts || cursor, cursor));
                    if (b < from - 2 || a > to + 2) return;
                    const alc = z.lado === 'LONG';
                    const col = z.tipo === 'OB' ? (alc ? '34,197,94' : '239,68,68') : (alc ? '56,189,248' : '244,114,182');
                    const y1 = Y(z.top), y2 = Y(z.bottom);
                    ctx.fillStyle = `rgba(${col},${z.estado === 'INVALIDATED' ? 0.05 : 0.10})`;
                    ctx.strokeStyle = `rgba(${col},0.35)`;
                    ctx.lineWidth = 1;
                    ctx.fillRect(X(a), Math.min(y1, y2), Math.max(1, X(b) - X(a)), Math.abs(y2 - y1));
                    ctx.strokeRect(X(a), Math.min(y1, y2), Math.max(1, X(b) - X(a)), Math.abs(y2 - y1));
                });
            }
            // operaciones
            st.res.trades.forEach((t) => {
                if (t.entrada_ts > cursor) return;
                const cerrada = t.salida_ts != null && t.salida_ts <= cursor;
                const a = idx(t.entrada_ts), b = cerrada ? idx(t.salida_ts) : dl.length - 1;
                if (b < from - 2 || a > to + 2) return;
                const largo = t.lado === 'LONG', elegida = st.sel === t.id;
                const xa = X(a), xb = X(b);
                if (elegida) {   // caja de posición: entrada -> TP (verde) y entrada -> SL (roja)
                    const w = Math.max(esp * 6, xb - xa);
                    ctx.fillStyle = 'rgba(34,197,94,0.14)';
                    ctx.fillRect(xa, Math.min(Y(t.entrada), Y(t.tp)), w, Math.abs(Y(t.tp) - Y(t.entrada)));
                    ctx.fillStyle = 'rgba(239,68,68,0.14)';
                    ctx.fillRect(xa, Math.min(Y(t.entrada), Y(t.sl)), w, Math.abs(Y(t.sl) - Y(t.entrada)));
                    [[t.tp, '#22C55E', 'TP'], [t.sl, '#EF4444', 'SL'], [t.entrada, '#E5E7EB', 'Entry']].forEach(([p, c, n]) => {
                        ctx.strokeStyle = c; ctx.setLineDash(n === 'Entry' ? [] : [4, 3]); ctx.lineWidth = 1;
                        ctx.beginPath(); ctx.moveTo(xa, Y(p)); ctx.lineTo(xa + w, Y(p)); ctx.stroke();
                        ctx.fillStyle = c; ctx.font = '600 10px Inter, system-ui, sans-serif';
                        ctx.fillText(`${n} ${Number(p).toFixed(st.precision)}`, xa + w + 4, Y(p) + 3);
                    });
                    ctx.setLineDash([]);
                    if (t.zona && t.zona.top != null && t.zona.bottom != null && t.zona.top !== t.zona.bottom) {
                        ctx.strokeStyle = 'rgba(250,204,21,0.8)'; ctx.setLineDash([2, 2]);
                        ctx.strokeRect(xa - esp * 12, Math.min(Y(t.zona.top), Y(t.zona.bottom)), esp * 12, Math.abs(Y(t.zona.top) - Y(t.zona.bottom)));
                        ctx.setLineDash([]);
                    }
                }
                const col = largo ? '#22C55E' : '#EF4444';
                // flecha de entrada
                const ye = Y(t.entrada), dy = largo ? 1 : -1, s = Math.max(4, Math.min(8, esp));
                ctx.fillStyle = col;
                ctx.beginPath(); ctx.moveTo(xa, ye + dy * 2); ctx.lineTo(xa - s, ye + dy * (2 + s * 1.6)); ctx.lineTo(xa + s, ye + dy * (2 + s * 1.6)); ctx.closePath(); ctx.fill();
                if (elegida || esp > 3) {
                    ctx.font = '700 9px Inter, system-ui, sans-serif';
                    ctx.fillText(largo ? 'BUY' : 'SELL', xa - 10, ye + dy * (14 + s * 1.6));
                }
                if (cerrada) {
                    const gano = t.pnl > 0, ys = Y(t.salida);
                    ctx.strokeStyle = gano ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)'; ctx.setLineDash([3, 3]); ctx.lineWidth = elegida ? 1.6 : 1;
                    ctx.beginPath(); ctx.moveTo(xa, ye); ctx.lineTo(xb, ys); ctx.stroke(); ctx.setLineDash([]);
                    ctx.fillStyle = gano ? '#22C55E' : '#EF4444';
                    ctx.beginPath(); ctx.arc(xb, ys, elegida ? 4.5 : 3.5, 0, Math.PI * 2); ctx.fill();
                    if (elegida || esp > 5) { ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.fillText(`${t.r > 0 ? '+' : ''}${t.r.toFixed(2)}R`, xb + 6, ys - 6); }
                }
            });
            ctx.restore();
            return false;
        }
        klinecharts.registerIndicator({
            name: IND, shortName: 'NLT Backtest', figures: [], calc: (dl) => dl.map(() => ({})),
            createTooltipDataSource: () => ({ name: '🧪 NLT BACKTEST LAB', calcParamsText: '', legends: [] }),
            draw: (p) => dibujar(p),
        });

        // ───────────── modo histórico en el gráfico ─────────────
        const aKline = (c) => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] });
        function entrarGrafico(klines) {
            if (NLTCharts.replayApi && NLTCharts.replayApi.activo()) NLTCharts.replayApi.salir();
            const r = st.res;
            const mismo = app.simbolo() === r.symbol && app.timeframe() === r.timeframe;
            if (!st.enGrafico) {
                const ze = chart.getIndicators ? chart.getIndicators({ name: 'NLT_PRO_ZONES' }) : [];
                st.zeVisible = ze && ze.length ? ze[0].visible !== false : null;
                if (st.zeVisible) chart.overrideIndicator({ name: 'NLT_PRO_ZONES', visible: false });   // las zonas en vivo no son del backtest
            }
            motor.modoExterno({ velas: klines }, false);
            app.irA(r.symbol, r.timeframe);
            if (mismo) chart.resetData();
            st.enGrafico = true;
            NLTCharts.market.fijarEstado('backtest');
            if (!chart.getIndicators({ name: IND }).length) chart.createIndicator({ name: IND, paneId: 'candle_pane' }, true);
            pintar();
        }
        function salirGrafico() {
            detenerReplay();
            st.replay.activo = false;
            if (!st.enGrafico) return;
            st.enGrafico = false;
            chart.removeIndicator({ name: IND });
            if (st.zeVisible) chart.overrideIndicator({ name: 'NLT_PRO_ZONES', visible: true });
            NLTCharts.market.fijarEstado('conectando');
            motor.modoExterno(null);
            pintar();
        }
        function irATrade(t) {
            st.sel = t.id;
            if (st.enGrafico && chart.scrollToTimestamp) { if (motor.irACentrado) motor.irACentrado(t.entrada_ts, 250, 0.6); else chart.scrollToTimestamp(t.entrada_ts, 200); }   // la entrada a ~40 % desde la izquierda: se ve cómo terminó la operación
            chart.setStyles({});
            pintar();
        }
        chart.getDom && chart.getDom().addEventListener('click', (ev) => {
            if (!st.enGrafico || !st.res) return;
            try {
                const r = chart.getDom().getBoundingClientRect();
                const [p] = chart.convertFromPixel([{ x: ev.clientX - r.left, y: ev.clientY - r.top }], { paneId: 'candle_pane' });
                const dl = chart.getDataList();
                const ts = dl[Math.max(0, Math.min(dl.length - 1, p.dataIndex))]?.timestamp;
                if (ts == null) return;
                const t = st.res.trades.find((x) => x.entrada_ts <= ts && (x.salida_ts || Infinity) >= ts);
                if (t) { st.tab = 'operaciones'; irATrade(t); }
            } catch (_) { /* clic fuera del área de velas */ }
        });

        // ───────────── ejecución ─────────────
        function pedido() {
            const E = form.execution, S = form.strategy;
            const ze = {};
            if (form.modoZE === 'malvado') ze.modoMalvado = true;
            if (form.modoZE === 'barrion') ze.modoBarrion = true;
            if (form.estilo !== 'CONFIRMADO') ze.entryStyle = form.estilo;
            const fin = Math.min(Date.parse(form.hasta + 'T00:00:00Z') + DIA, Date.now());
            const nlt = !!(st.cfg && st.cfg.presets.some((x) => x.id === form.preset));
            const base = nlt ? { strategy: {}, execution: {} } : presetActual();   // preset propio: se manda su configuración
            return {
                symbol: form.symbol, timeframe: form.timeframe, start: Date.parse(form.desde + 'T00:00:00Z'), end: fin,
                preset_id: nlt ? form.preset : null,
                strategy: { ...base.strategy, ...S, entradas_ze: { ...(base.strategy.entradas_ze || {}), ...ze } },
                execution: { ...base.execution, ...E },
            };
        }
        async function correr() {
            st.error = '';
            try {
                st.job = await NLT_API.chartsBacktestCrear(pedido());
            } catch (err) { st.error = err.message; pintar(); return; }
            pintar();
            seguir();
        }
        function seguir() {
            clearTimeout(st.poll);
            st.poll = setTimeout(async () => {
                try {
                    st.job = await NLT_API.chartsBacktestEstado(st.job.id);
                } catch (err) { st.error = err.message; }
                if (st.job && ['queued', 'data', 'engine', 'simulation'].includes(st.job.status)) { pintarProgreso(); seguir(); return; }
                if (st.job && st.job.status === 'done') { try { await cargarResultado(st.job.id); } catch (err) { st.error = err.message; st.reintentarRes = st.job.id; const t = app.transicion && app.transicion(); if (t) t.terminar(); } }
                pintar();
            }, 700);
        }
        async function cancelar() {
            if (!st.job) return;
            try { st.job = await NLT_API.chartsBacktestCancelar(st.job.id); } catch (err) { st.error = err.message; }
            pintar();
        }
        // El resultado y las velas del backtest son una respuesta grande (meses de velas). Antes, si tardaba más de 30 s, el error se
        // perdía en silencio y el gráfico se quedaba sin cargar. Ahora: se pone la transición con desenfoque mientras llega, se intenta
        // dos veces (45 s y 2 min) y, si no llega, se dice claro con un botón para reintentar.
        async function cargarResultado(id) {
            const trans = app.transicion ? app.transicion() : null;
            st.reintentarRes = null; st.error = '';
            if (trans) trans.iniciar('Cargando el backtest en el gráfico');
            let ultimo = null;
            for (const tm of [45000, 120000]) {
                try {
                    const [res, velas] = await Promise.all([NLT_API.chartsBacktestResultado(id, tm), NLT_API.chartsBacktestVelas(id, tm)]);
                    st.res = res; st.velas = velas; st.precision = velas.price_precision; st.sel = null;
                    st.tab = 'resultados';
                    entrarGrafico(velas.candles.map(aKline));      // al llegar las velas al gráfico, la transición se quita sola
                    return true;
                } catch (err) { ultimo = err; }
            }
            if (trans) trans.terminar();
            st.reintentarRes = id;
            st.error = /tard[óo] demasiado/i.test((ultimo && ultimo.message) || '')
                ? 'El backtest terminó, pero el servidor tardó demasiado en entregar las velas. Pulsa Reintentar: el resultado ya está calculado.'
                : `No se pudo cargar el resultado en el gráfico: ${(ultimo && ultimo.message) || 'error desconocido'}`;
            return false;
        }

        // ───────────── replay (mismo resultado, vela por vela) ─────────────
        function iniciarReplay() {
            if (!st.velas) return;
            const todas = st.velas.candles.map(aKline);
            st.replay = { ...st.replay, activo: true, cursor: Math.min(30, todas.length) - 1, klines: todas };
            entrarGrafico(todas.slice(0, st.replay.cursor + 1));
        }
        function paso() {
            const R = st.replay;
            if (!R.activo || R.cursor >= R.klines.length - 1) { detenerReplay(); return false; }
            R.cursor += 1;
            motor.empujar(R.klines[R.cursor]);
            pintarReplay();
            return true;
        }
        function play() {
            if (!st.replay.activo) iniciarReplay();
            detenerReplay();
            const tick = () => { if (paso()) st.replay.timer = setTimeout(tick, 1000 / st.replay.vel); };
            st.replay.timer = setTimeout(tick, 1000 / st.replay.vel);
            pintarReplay();
        }
        function detenerReplay() { clearTimeout(st.replay.timer); st.replay.timer = null; }

        // ───────────── panel ─────────────
        const MET = [['initial_balance', 'Initial Balance', fmtDinero], ['final_balance', 'Final Balance', fmtDinero], ['net_pl', 'Net P/L', fmtDinero],
            ['return_pct', 'Return', (x) => `${x}%`], ['total_trades', 'Total Trades'], ['wins', 'Wins'], ['losses', 'Losses'], ['win_rate', 'Win Rate', (x) => `${x}%`],
            ['profit_factor', 'Profit Factor', (x, m) => (x == null ? (m.gross_profit > 0 ? '∞ (sin pérdidas)' : '—') : x)], ['expectancy', 'Expectancy', fmtDinero],
            ['average_r', 'Average R', (x) => `${x}R`], ['average_win', 'Average Win', fmtDinero], ['average_loss', 'Average Loss', fmtDinero],
            ['max_drawdown', 'Max Drawdown', fmtDinero], ['max_drawdown_pct', 'Max Drawdown %', (x) => `${x}%`], ['largest_win', 'Largest Win', fmtDinero],
            ['largest_loss', 'Largest Loss', fmtDinero], ['max_consecutive_wins', 'Consecutive Wins'], ['max_consecutive_losses', 'Consecutive Losses'],
            ['average_trade_duration_min', 'Avg Trade Duration', fmtDur], ['gross_profit', 'Gross Profit', fmtDinero], ['gross_loss', 'Gross Loss', fmtDinero],
            ['commission_total', 'Commission', fmtDinero], ['swap_total', 'Swap', fmtDinero]];

        function campo(etq, html, ayuda) {
            return `<label class="lab-f"${ayuda ? ` title="${esc(ayuda)}"` : ''}><span>${esc(etq)}</span>${html}</label>`;
        }
        const sel = (k, opciones, v, grupo = 'form') => `<select data-k="${k}" data-g="${grupo}">${opciones.map(([a, b]) => `<option value="${esc(a)}"${String(a) === String(v) ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>`;
        const num = (k, v, grupo, paso = 'any', min = '') => `<input type="number" data-k="${k}" data-g="${grupo}" value="${esc(v)}" step="${paso}" min="${min}">`;
        const valorE = (k) => (form.execution[k] ?? st.cfg.defaults.execution[k]);
        const valorS = (k) => (form.strategy[k] ?? presetActual().strategy[k] ?? st.cfg.defaults.strategy[k]);
        function presetActual() {
            const p = (st.cfg && st.cfg.presets.find((x) => x.id === form.preset)) || st.presetsUsuario.find((x) => x.id === form.preset);
            return p ? { strategy: p.strategy || {}, execution: p.execution || {} } : { strategy: {}, execution: {} };
        }
        function checks(k, opciones, v) {
            return `<div class="lab-checks">${opciones.map(([a, b]) => `<label><input type="checkbox" data-k="${k}" data-g="strategy" data-v="${esc(a)}"${v.includes(a) ? ' checked' : ''}> ${esc(b)}</label>`).join('')}</div>`;
        }

        function htmlConfig() {
            const c = st.cfg;
            if (!c) return st.error ? `<p class="lab-error">${esc(st.error)}</p><button type="button" class="lab-sec" data-a="reintentarConfig">Reintentar</button>` : '<p class="lab-vacio">Cargando…</p>';
            const bloqueado = !c.access;
            const corriendo = st.job && ['queued', 'data', 'engine', 'simulation'].includes(st.job.status);
            const presets = [...c.presets.map((p) => [p.id, p.name]), ...st.presetsUsuario.map((p) => [p.id, `★ ${p.name}`])];
            return `
            ${bloqueado ? `<div class="lab-aviso">NLT Backtest Lab corre el motor PRO del NLT Zone Engine en el servidor. Necesitas un plan de NLT Indicator o la prueba activa del Zone Engine.</div>` : ''}
            <div class="lab-grid">
                <fieldset><legend>Mercado</legend>
                    ${campo('Symbol', sel('symbol', c.symbols.map((s) => [s, s]), form.symbol))}
                    ${campo('Timeframe', sel('timeframe', c.timeframes.map((t) => [t, t]), form.timeframe))}
                    ${campo('Fecha inicial', `<input type="date" data-k="desde" data-g="form" value="${esc(form.desde)}">`)}
                    ${campo('Fecha final', `<input type="date" data-k="hasta" data-g="form" value="${esc(form.hasta)}">`)}
                    <p class="lab-nota">Máx. ${c.limits.max_velas.toLocaleString()} velas · ${c.limits.max_dias} días · fuente ${esc(c.provider)}${c.demo ? ' (DEMO)' : ''}</p>
                </fieldset>
                <fieldset><legend>Estrategia</legend>
                    ${campo('Preset', sel('preset', presets, form.preset))}
                    ${campo('Señal', sel('senal', [['entry_ready', 'ENTRY_READY del Zone Engine'], ['crt', 'CRT (ruptura)']], valorS('senal'), 'strategy'))}
                    ${valorS('senal') === 'entry_ready' ? campo('Zonas', checks('origenes', [['OB', 'OB'], ['FVG', 'FVG'], ['MANUAL', 'Manual']], valorS('origenes'))) : ''}
                    ${campo('Modo del motor', sel('modoZE', [['normal', 'Normal'], ['malvado', '👹 Malvado'], ['barrion', '💛 Barrión']], form.modoZE), 'Modos de combate de V13.3.3')}
                    ${campo('Estilo de entrada', sel('estilo', [['CONFIRMADO', 'CONFIRMADO'], ['AGRESIVO', 'AGRESIVO']], form.estilo))}
                    ${campo('Dirección', sel('direccion', [['both', 'Long + Short'], ['long', 'Solo Long'], ['short', 'Solo Short']], valorS('direccion'), 'strategy'))}
                    ${campo('Sesiones', checks('sesiones', [['london', 'Londres'], ['newyork', 'Nueva York'], ['asia', 'Asia']], valorS('sesiones')))}
                </fieldset>
                <fieldset><legend>SL / TP</legend>
                    ${campo('SL', sel('modo_sl', [['zone_engine', 'Del motor (swing ± ATR)'], ['fixed_pips', 'Fijo en pips']], valorS('modo_sl'), 'strategy'), 'Del motor: la fórmula de pushEval de V13.3.3')}
                    ${valorS('modo_sl') === 'fixed_pips' ? campo('SL (pips)', num('sl_pips', valorS('sl_pips'), 'strategy', '0.1', '0.1')) : ''}
                    ${campo('RR (TP = SL × RR)', num('rr', valorS('rr'), 'strategy', '0.1', '0.1'))}
                    ${campo('Salida por tiempo (velas, 0 = no)', num('max_barras', valorS('max_barras'), 'strategy', '1', '0'))}
                </fieldset>
                <fieldset><legend>Ejecución</legend>
                    ${campo('Balance inicial ($)', num('balance', valorE('balance'), 'execution', '100', '100'))}
                    ${campo('Tamaño', sel('tamano', [['risk', '% de riesgo'], ['fixed', 'Lotes fijos']], valorE('tamano'), 'execution'))}
                    ${valorE('tamano') === 'risk' ? campo('Riesgo por operación %', num('riesgo_pct', valorE('riesgo_pct'), 'execution', '0.1', '0.01')) : campo('Lotes', num('lotes', valorE('lotes'), 'execution', '0.01', '0.01'))}
                    ${campo('Entrada', sel('entrada', [['close', 'Al cierre de la señal'], ['next_open', 'Apertura siguiente']], valorE('entrada'), 'execution'))}
                    ${campo('Vela con SL y TP', sel('ambiguedad', [['conservative', 'Conservador (SL)'], ['lower_tf', 'Timeframe inferior'], ['optimistic', 'Optimista (TP)']], valorE('ambiguedad'), 'execution'), 'Nunca se asume una victoria sin decirlo: cada caso queda registrado')}
                </fieldset>
                <fieldset><legend>Costos</legend>
                    ${campo('Spread (pips)', num('spread_pips', valorE('spread_pips'), 'execution', '0.1', '0'))}
                    ${campo('Slippage (pips)', num('slippage_pips', valorE('slippage_pips'), 'execution', '0.1', '0'))}
                    ${campo('Comisión ($/lote)', num('comision_lote', valorE('comision_lote'), 'execution', '0.5', '0'))}
                    ${campo('Swap largo ($/lote/noche)', num('swap_largo', valorE('swap_largo'), 'execution', '0.1'))}
                    ${campo('Swap corto ($/lote/noche)', num('swap_corto', valorE('swap_corto'), 'execution', '0.1'))}
                </fieldset>
            </div>
            <div class="lab-acciones">
                <button type="button" class="lab-run" data-a="run"${bloqueado || corriendo ? ' disabled' : ''}><i class="ph-fill ph-play"></i> RUN BACKTEST</button>
                ${corriendo ? '<button type="button" class="lab-sec" data-a="cancel">Cancelar</button>' : ''}
                <span class="lab-guardar"><input type="text" data-k="nombrePreset" data-g="form" placeholder="Nombre del preset" maxlength="60" value="${esc(form.nombrePreset || '')}"><button type="button" class="lab-sec" data-a="guardarPreset">Guardar preset</button></span>
                ${st.presetsMsg ? `<span class="lab-nota">${esc(st.presetsMsg)}</span>` : ''}
            </div>
            <div id="labProgreso">${htmlProgreso()}</div>`;
        }
        function htmlProgreso() {
            const j = st.job;
            if (st.error) return `<p class="lab-error">${esc(st.error)}</p>${st.reintentarRes ? '<button type="button" class="lab-sec" data-a="reintentarRes"><i class="ph ph-arrow-clockwise"></i> Reintentar</button>' : ''}`;
            if (!j) return '';
            const p = Math.round(j.progress || 0);
            const txt = { queued: 'En cola', data: 'Cargando datos', engine: 'Motor', simulation: 'Simulando', done: 'Listo', error: 'Error', cancelled: 'Cancelado' }[j.status] || j.status;
            return `<div class="lab-prog"><div class="lab-barra"><i style="width:${p}%"></i></div><span>${esc(txt)} · ${p}%${j.detail ? ' · ' + esc(j.detail) : ''}</span></div>${j.error ? `<p class="lab-error">${esc(j.error)}</p>` : ''}`;
        }
        function pintarProgreso() { const x = el.querySelector('#labProgreso'); if (x) x.innerHTML = htmlProgreso(); }

        function curvaSVG(curva, base) {
            const pts = curva.filter((p) => p.ts != null);
            if (pts.length < 2) return '<p class="lab-vacio">Sin operaciones para la curva.</p>';
            const W = 600, H = 150, ys = pts.map((p) => p.balance), mn = Math.min(base, ...ys), mx = Math.max(base, ...ys);
            const x = (i) => (i / (pts.length - 1)) * (W - 8) + 4, y = (v) => H - 6 - ((v - mn) / (mx - mn || 1)) * (H - 12);
            const linea = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
            const fin = pts[pts.length - 1].balance >= base;
            return `<svg viewBox="0 0 ${W} ${H}" class="lab-curva" preserveAspectRatio="none" role="img" aria-label="Equity curve">
                <line x1="0" x2="${W}" y1="${y(base)}" y2="${y(base)}" stroke="rgba(255,255,255,.18)" stroke-dasharray="4 4"/>
                <polyline points="${linea}" fill="none" stroke="${fin ? '#22C55E' : '#EF4444'}" stroke-width="1.8" vector-effect="non-scaling-stroke"/>
            </svg><div class="lab-ejes"><span>${fmtDinero(mn)}</span><span>${fmtDinero(mx)}</span></div>`;
        }
        function htmlResultados() {
            const r = st.res;
            if (!r) return '<p class="lab-vacio">Corre un backtest para ver los resultados.</p>';
            const m = r.metrics, meta = r.meta;
            const mensual = m.monthly_pl.length ? Math.max(...m.monthly_pl.map((x) => Math.abs(x.pl))) : 1;
            const est = r.zone_states || {};
            return `
            <div class="lab-res">
                <div class="lab-mets">${MET.map(([k, n, f]) => `<div class="lab-met"><span>${esc(n)}</span><b class="${typeof m[k] === 'number' && /pl|profit|win|loss|return|expect/.test(k) ? (m[k] > 0 ? 'up' : m[k] < 0 ? 'down' : '') : ''}">${esc(f ? f(m[k], m) : m[k])}</b></div>`).join('')}</div>
                <div class="lab-col">
                    <h4>Equity curve</h4>${curvaSVG(m.equity_curve, m.initial_balance)}
                    <h4>P/L mensual</h4>
                    <div class="lab-mes">${m.monthly_pl.map((x) => `<div><span>${esc(x.month)}</span><i class="${x.pl >= 0 ? 'up' : 'down'}" style="width:${Math.max(2, Math.abs(x.pl) / mensual * 100)}%"></i><b>${fmtDinero(x.pl)}</b></div>`).join('') || '<p class="lab-vacio">—</p>'}</div>
                    <h4>NLT Zone Engine (en el rango)</h4>
                    <p class="lab-nota">Señales ${r.signals} · ${Object.entries(est).map(([k, v]) => `${k} ${v}`).join(' · ')} · velas ambiguas ${r.ambiguous.length} · señales no tomadas ${r.skipped_signals.length}</p>
                    <h4>Auditoría</h4>
                    <p class="lab-nota">${esc(meta.symbol)} ${esc(meta.timeframe)} · ${fmtFecha(meta.dataset.first)} → ${fmtFecha(meta.dataset.last)} · ${meta.dataset.candles.toLocaleString()} velas (+${meta.dataset.warmup_candles} de warm-up) · huecos ${meta.dataset.gaps}<br>
                    Fuente ${esc(meta.data_source)}${meta.data_source_changes.length ? ' (cambio de fuente: ' + esc(meta.data_source_changes.map((c) => c.fuente + ' ' + c.codigo).join(', ')) + ')' : ''} · hora del servidor ${esc(meta.timezone.broker_server_rule)} · timestamps ${esc(meta.timezone.timestamps)} · sesiones ${esc(meta.timezone.sessions)}<br>
                    Motor ${esc(meta.engine_version)} · estrategia v${esc(meta.strategy_version)} · dataset ${esc(meta.dataset.hash)} · clave ${esc(meta.key)}</p>
                </div>
            </div>`;
        }
        function filtrados() {
            const f = st.filtros, r = st.res;
            if (!r) return [];
            const d0 = f.desde ? Date.parse(f.desde + 'T00:00:00Z') : -Infinity, d1 = f.hasta ? Date.parse(f.hasta + 'T00:00:00Z') + DIA : Infinity;
            const xs = r.trades.filter((t) => (!f.resultado || t.resultado === f.resultado) && (!f.lado || t.lado === f.lado)
                && (!f.zona || (t.zona && t.zona.tipo) === f.zona) && (!f.sesion || t.sesion === f.sesion) && t.entrada_ts >= d0 && t.entrada_ts < d1);
            const { k, dir } = st.orden;
            const val = (t) => (k === 'duracion' ? t.salida_ts - t.entrada_ts : t[k]);
            return xs.sort((a, b) => (val(a) > val(b) ? dir : val(a) < val(b) ? -dir : 0));
        }
        function htmlOperaciones() {
            const r = st.res;
            if (!r) return '<p class="lab-vacio">Corre un backtest para ver las operaciones.</p>';
            const f = st.filtros, p = st.precision;
            const sesiones = [...new Set(r.trades.map((t) => t.sesion).filter(Boolean))];
            const zonas = [...new Set(r.trades.map((t) => t.zona && t.zona.tipo).filter(Boolean))];
            const col = (k, n) => `<th data-orden="${k}">${esc(n)}${st.orden.k === k ? (st.orden.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
            const lista = filtrados();
            const t = r.trades.find((x) => x.id === st.sel);
            return `
            <div class="lab-filtros">
                ${sel('resultado', [['', 'Win + Loss'], ['WIN', 'Win'], ['LOSS', 'Loss'], ['BE', 'Breakeven']], f.resultado, 'filtro')}
                ${sel('lado', [['', 'Long + Short'], ['LONG', 'Long'], ['SHORT', 'Short']], f.lado, 'filtro')}
                ${sel('zona', [['', 'Todas las zonas'], ...zonas.map((z) => [z, z])], f.zona, 'filtro')}
                ${sel('sesion', [['', 'Todas las sesiones'], ...sesiones.map((s) => [s, s])], f.sesion, 'filtro')}
                <input type="date" data-k="desde" data-g="filtro" value="${esc(f.desde)}" aria-label="Desde"><input type="date" data-k="hasta" data-g="filtro" value="${esc(f.hasta)}" aria-label="Hasta">
                <span class="lab-nota">${lista.length} de ${r.trades.length}</span>
            </div>
            <div class="lab-ops">
                <div class="lab-tabla"><table>
                    <thead><tr>${col('entrada_ts', 'Date')}<th>Symbol</th>${col('lado', 'Side')}${col('entrada', 'Entry')}${col('salida', 'Exit')}<th>SL</th><th>TP</th>${col('r', 'R')}${col('pnl', 'P/L')}${col('duracion', 'Duration')}${col('resultado', 'Result')}</tr></thead>
                    <tbody>${lista.map((x) => `<tr data-t="${x.id}" class="${x.id === st.sel ? 'on' : ''}">
                        <td>${fmtFecha(x.entrada_ts)}</td><td>${esc(r.symbol)}</td><td class="${x.lado === 'LONG' ? 'up' : 'down'}">${x.lado}</td>
                        <td>${x.entrada.toFixed(p)}</td><td>${x.salida != null ? x.salida.toFixed(p) : '—'}</td><td>${x.sl.toFixed(p)}</td><td>${x.tp.toFixed(p)}</td>
                        <td class="${x.r > 0 ? 'up' : 'down'}">${x.r.toFixed(2)}</td><td class="${x.pnl > 0 ? 'up' : 'down'}">${fmtDinero(x.pnl)}</td>
                        <td>${fmtDur((x.salida_ts - x.entrada_ts) / 60000)}</td><td>${esc(x.resultado)}${x.ambigua ? ' ⚠' : ''}</td></tr>`).join('') || '<tr><td colspan="11" class="lab-vacio">Sin operaciones con estos filtros.</td></tr>'}</tbody>
                </table></div>
                <div class="lab-det">${t ? `
                    <h4>Operación #${t.id} · ${t.lado}</h4>
                    <dl>
                        <dt>Entry</dt><dd>${t.entrada.toFixed(p)} · ${fmtFecha(t.entrada_ts)}</dd>
                        <dt>Exit</dt><dd>${t.salida != null ? t.salida.toFixed(p) : '—'} · ${fmtFecha(t.salida_ts)}</dd>
                        <dt>SL</dt><dd>${t.sl.toFixed(p)}</dd><dt>TP</dt><dd>${t.tp.toFixed(p)}</dd>
                        <dt>R</dt><dd class="${t.r > 0 ? 'up' : 'down'}">${t.r.toFixed(3)}</dd>
                        <dt>P/L</dt><dd class="${t.pnl > 0 ? 'up' : 'down'}">${fmtDinero(t.pnl)} <small>(bruto ${fmtDinero(t.pnl_bruto)}, comisión ${fmtDinero(t.comision)}, swap ${fmtDinero(t.swap)})</small></dd>
                        <dt>Lotes</dt><dd>${t.lotes} · riesgo ${fmtDinero(t.riesgo_usd)}</dd>
                        <dt>Duration</dt><dd>${fmtDur((t.salida_ts - t.entrada_ts) / 60000)}</dd>
                        <dt>Zone</dt><dd>${esc(t.zona && t.zona.tipo || '—')}${t.zona && t.zona.top != null ? ` ${Number(t.zona.top).toFixed(p)} – ${Number(t.zona.bottom).toFixed(p)}` : ''}</dd>
                        <dt>Zone State</dt><dd>${esc(t.zona && t.zona.estado || (t.zona && t.zona.tipo === 'CRT' ? 'ruptura' : 'ENTRY_READY'))}</dd>
                        <dt>Reason for Entry</dt><dd>${esc(t.motivo_entrada)}</dd>
                        <dt>Reason for Exit</dt><dd>${esc(t.motivo_salida)}${t.ambigua ? `<br><small>⚠ vela con SL y TP: ${esc(t.ambigua.detalle)}</small>` : ''}</dd>
                    </dl>` : '<p class="lab-vacio">Elige una operación de la tabla (o tocala en el gráfico).</p>'}
                </div>
            </div>`;
        }
        function estadoEn(ts) {
            const r = st.res;
            let panel = null;
            for (const p of r.panel) { if (p.ts <= ts) panel = p; else break; }
            const trans = r.transitions.filter((x) => x.ts <= ts).slice(-6).reverse();
            const cerradas = r.trades.filter((t) => t.salida_ts != null && t.salida_ts <= ts);
            const abierta = r.trades.find((t) => t.entrada_ts <= ts && (t.salida_ts == null || t.salida_ts > ts));
            return { panel, trans, balance: r.metrics.initial_balance + cerradas.reduce((a, t) => a + t.pnl, 0), n: cerradas.length, abierta };
        }
        function htmlReplay() {
            if (!st.res) return '<p class="lab-vacio">Corre un backtest para reproducir su período vela por vela.</p>';
            const m = st.res.meta;
            return `
            <div class="lab-replay">
                <p class="lab-nota">El replay usa NLT Bar Replay: el servidor entrega las velas de a una y el futuro nunca llega al navegador. Arranca en la primera vela del backtest (${esc(fmtFecha(m.dataset.first))}); el Zone Engine se calcula en cada vela con el mismo motor.</p>
                <div class="lab-ctrl"><button type="button" class="lab-run" data-a="abrirReplay"><i class="ph ph-clock-counter-clockwise"></i> Reproducir en NLT Bar Replay</button></div>
            </div>`;
        }
        function pintarReplay() { if (st.tab === 'replay') pintar(); else chart.setStyles({}); }

        function pintar() {
            boton.classList.toggle('on', st.abierto);
            el.hidden = !st.abierto;
            if (!st.abierto) return;
            const cuerpo = { config: htmlConfig, resultados: htmlResultados, operaciones: htmlOperaciones, replay: htmlReplay }[st.tab]();
            el.classList.toggle('lab-min', !!st.min);
            el.innerHTML = `
                <div class="lab-head">
                    <b><i class="ph ph-flask"></i> NLT BACKTEST LAB</b>
                    <nav>${TABS.map(([k, n, ic]) => `<button type="button" data-tab="${k}" class="${st.tab === k ? 'on' : ''}"><i class="ph ${ic}"></i><span>${n}</span></button>`).join('')}</nav>
                    <span class="lab-sp"></span>
                    ${st.enGrafico ? `<label class="lab-nota"><input type="checkbox" data-a="zonas"${st.verZonas ? ' checked' : ''}> zonas</label><button type="button" class="lab-sec" data-a="vivo"><i class="ph ph-broadcast"></i> Volver al vivo</button>` : ''}
                    <button type="button" class="ch-tool" data-a="min" title="${st.min ? 'Mostrar el panel' : 'Ocultar el panel para ver y operar en el gráfico'}" aria-label="${st.min ? 'Mostrar el panel' : 'Ocultar el panel'}"><i class="ph ${st.min ? 'ph-caret-up' : 'ph-caret-down'}"></i></button>
                    <button type="button" class="ch-tool" data-a="cerrar" aria-label="Cerrar Backtest Lab"><i class="ph ph-x"></i></button>
                </div>
                <div class="lab-body">${cuerpo}</div>`;
            if (st.enGrafico) chart.setStyles({});
        }

        // ───────────── eventos ─────────────
        el.addEventListener('click', async (ev) => {
            const tab = ev.target.closest('[data-tab]');
            if (tab) { st.tab = tab.dataset.tab; pintar(); return; }
            const th = ev.target.closest('[data-orden]');
            if (th) { const k = th.dataset.orden; st.orden = { k, dir: st.orden.k === k ? -st.orden.dir : 1 }; pintar(); return; }
            const fila = ev.target.closest('tr[data-t]');
            if (fila) { const t = st.res.trades.find((x) => x.id === +fila.dataset.t); if (t) irATrade(t); return; }
            const a = ev.target.closest('[data-a]');
            if (!a) return;
            const acc = a.dataset.a;
            if (acc === 'cerrar') { api.abrir(false); return; }
            if (acc === 'min') { st.min = !st.min; pintar(); setTimeout(() => window.dispatchEvent(new Event('resize')), 50); return; }
            if (acc === 'run') correr();
            if (acc === 'cancel') cancelar();
            if (acc === 'vivo') { salirGrafico(); pintar(); }
            if (acc === 'zonas') { st.verZonas = a.checked; chart.setStyles({}); }
            if (acc === 'play') play();
            if (acc === 'pause') { detenerReplay(); pintar(); }
            if (acc === 'step') { if (!st.replay.activo) iniciarReplay(); detenerReplay(); paso(); pintar(); }
            if (acc === 'reset') { detenerReplay(); iniciarReplay(); pintar(); }
            if (acc === 'guardarPreset') guardarPreset();
            if (acc === 'reintentarConfig') { st.error = ''; pintar(); cargarConfig(); }
            if (acc === 'reintentarRes' && st.reintentarRes) { const id = st.reintentarRes; st.error = ''; pintar(); cargarResultado(id).finally(pintar); }
            if (acc === 'abrirReplay' && NLTCharts.replayApi) { const m = st.res.meta; salirGrafico(); api.abrir(false); NLTCharts.replayApi.iniciar(m.symbol, m.timeframe, m.dataset.first); }
        });
        el.addEventListener('change', (ev) => {
            const x = ev.target, k = x.dataset.k, g = x.dataset.g;
            if (!k || x.dataset.a) return;
            if (g === 'filtro') { st.filtros[k] = x.value; pintar(); return; }
            if (g === 'replay') { st.replay.vel = +x.value; if (st.replay.timer) play(); return; }
            if (g === 'form') {
                form[k] = x.value;
                if (k === 'preset') { form.strategy = {}; form.execution = {}; }
                if (k !== 'nombrePreset') pintar();
                return;
            }
            const destino = g === 'strategy' ? form.strategy : form.execution;
            if (x.type === 'checkbox') {
                const actual = new Set(valorS(k));
                if (x.checked) actual.add(x.dataset.v); else actual.delete(x.dataset.v);
                destino[k] = [...actual];
            } else if (x.type === 'number') {
                destino[k] = x.value === '' ? undefined : Number(x.value);
            } else destino[k] = x.value;
            pintar();
        });

        async function guardarPreset() {
            const nombre = (form.nombrePreset || '').trim();
            if (!nombre) { st.presetsMsg = 'Pon un nombre para el preset.'; pintar(); return; }
            const base = presetActual();
            const p = pedido();
            try {
                await NLT_API.chartsBacktestGuardarPreset({ name: nombre, strategy: { ...base.strategy, ...p.strategy }, execution: { ...base.execution, ...p.execution } });
                st.presetsMsg = 'Preset guardado.';
                await cargarPresets();
            } catch (err) { st.presetsMsg = err.message; }
            pintar();
        }
        async function cargarPresets() {
            try { st.presetsUsuario = (await NLT_API.chartsBacktestPresets()).user || []; } catch (err) { st.presetsUsuario = []; st.presetsMsg = err.status === 503 ? 'Guardar presets en la cuenta todavía no está disponible.' : ''; }
        }
        async function cargarConfig() {
            try {
                st.error = '';
                st.cfg = await NLT_API.chartsBacktestConfig();
                if (!st.cfg.symbols.includes(form.symbol)) form.symbol = st.cfg.symbols[0];
            } catch (err) { st.error = err.message; }
            await cargarPresets();
            pintar();
        }

        const api = {
            abrir(si) {
                st.abierto = si === undefined ? !st.abierto : !!si;
                if (st.abierto && !st.cfg) cargarConfig();
                if (!st.abierto) salirGrafico();
                pintar();
                setTimeout(() => chart.resize(), 0);
            },
            salirGrafico: () => { salirGrafico(); pintar(); },
            estado: () => ({ enGrafico: st.enGrafico, job: st.job, trades: st.res ? st.res.trades.length : 0, replay: { ...st.replay, klines: undefined } }),
        };
        boton.addEventListener('click', () => api.abrir());
        if (location.hash === '#lab') api.abrir(true);
        window.addEventListener('hashchange', () => { if (location.hash === '#lab') api.abrir(true); });   // menú lateral
        window.NLTCharts.backtestLab = api;
        return api;
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.backtest = { montar };
})();
