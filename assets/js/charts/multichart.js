/* NLT Charts -- Multi-gráfico (hasta 8 gráficos en pantalla) y Comparar símbolos.
 *
 * El gráfico PRINCIPAL no se toca: sigue siendo #chart con todo su motor (indicadores, dibujos, replay,
 * Unified). Este módulo solo le cambia el tamaño/posición dentro del escenario y agrega gráficos
 * SECUNDARIOS, que son KLineChart "limpios" con velas propias (NLT_API.chartsVelas), sin pasar por
 * NLTCharts.market (su contador de generaciones y su estado de conexión son del principal).
 *
 *  - Sincronización (como TradingView): símbolo, intervalo, cruz (crosshair) y tiempo. Cada una se activa aparte.
 *  - Refresco de los secundarios: cada 10 s pidiendo solo las últimas velas, y en pausa con la pestaña oculta
 *    (el servidor limita a 120 pedidos/min por usuario; 7 secundarios + 3 comparaciones quedan muy por debajo).
 *  - Comparar: cada símbolo comparado es un indicador de la vela principal (línea) re-basada a la primera
 *    vela en común, así que todas arrancan del mismo punto y se ve el rendimiento relativo. El % mostrado
 *    es el del tramo visible.
 *  - Todo es visual: no hay permisos ni datos de cuenta aquí. Se guarda en prefs.multi / prefs.compare. */
(function () {
    const MAX_COMPARAR = 3;
    const COLORES_CMP = ['#F59E0B', '#A78BFA', '#34D399'];
    const REFRESCO_MS = 10000;
    const CABECERA = 26;

    // Distribución de cada diseño: [x, y, ancho, alto] en fracciones del escenario. La celda 0 es el gráfico principal.
    const DISENOS = {
        '1': { n: 1, nombre: 'Un gráfico' },
        '2h': { n: 2, nombre: '2 lado a lado' },
        '2v': { n: 2, nombre: '2 apilados' },
        '3': { n: 3, nombre: '3 (1 grande + 2)' },
        '4': { n: 4, nombre: '4 (2×2)' },
        '6': { n: 6, nombre: '6 (3×2)' },
        '8': { n: 8, nombre: '8 (4×2)' },
    };
    function rectas(id, ancho) {
        const d = DISENOS[id] || DISENOS['1'];
        const n = d.n;
        const grilla = (cols, filas) => Array.from({ length: n }, (_, i) => [(i % cols) / cols, Math.floor(i / cols) / filas, 1 / cols, 1 / filas]);
        // En pantalla angosta (celular) los gráficos se apilan: lado a lado quedarían ilegibles.
        if (ancho < 700 && n > 1) return n <= 4 ? grilla(1, n) : grilla(2, Math.ceil(n / 2));
        if (id === '2h') return grilla(2, 1);
        if (id === '2v') return grilla(1, 2);
        if (id === '3') return [[0, 0, 0.6, 1], [0.6, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]];
        if (id === '4') return grilla(2, 2);
        if (id === '6') return grilla(3, 2);
        if (id === '8') return grilla(4, 2);
        return [[0, 0, 1, 1]];
    }

    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const aKline = (c) => ({ timestamp: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v });

    function montar({ stage, principalEl, principal, simbolos, timeframes, estilos }) {
        const state = NLTCharts.state;
        const guardado = (state.prefs().multi) || {};
        const sync = { symbol: false, interval: false, crosshair: true, time: true, ...(guardado.sync || {}) };
        let diseno = DISENOS[guardado.diseno] ? guardado.diseno : '1';
        const panes = [];   // secundarios: { s, tf, cell, body, chart, timer, sub, hasta }
        const porSimbolo = Object.fromEntries(simbolos.map((s) => [s.symbol, s]));
        const guardar = () => state.savePrefs({ multi: { diseno, sync, panes: panes.map((p) => ({ s: p.s, tf: p.tf })) } });

        // ── Cruz sincronizada: una línea vertical por gráfico, dibujada en el escenario ──
        const lineas = new Map();
        const linea = (el) => {
            if (!lineas.has(el)) { const l = document.createElement('div'); l.className = 'mc-cruz'; l.hidden = true; stage.appendChild(l); lineas.set(el, l); }
            return lineas.get(el);
        };
        function ocultarCruces() { lineas.forEach((l) => { l.hidden = true; }); }
        function mostrarCruz(origen, ts) {
            if (!sync.crosshair) return;
            celdas().forEach((c) => {
                if (c.chart === origen) return;
                const l = linea(c.el);
                if (ts == null) { l.hidden = true; return; }
                const p = c.chart.convertToPixel({ timestamp: ts }, { paneId: 'candle_pane' });
                const x = p && p.x;
                if (x == null || !isFinite(x) || x < 0 || x > c.el.offsetWidth) { l.hidden = true; return; }
                l.style.left = `${c.el.offsetLeft + x}px`; l.style.top = `${c.el.offsetTop}px`; l.style.height = `${c.el.offsetHeight}px`;
                l.hidden = false;
            });
        }
        const celdas = () => [{ chart: principal.chart, el: principalEl, tf: principal.timeframe() }, ...panes.map((p) => ({ chart: p.chart, el: p.body, tf: p.tf }))];

        // ── Tiempo sincronizado (solo entre gráficos del mismo intervalo) ──
        function propagarTiempo(origen, tfOrigen) {
            if (!sync.time) return;
            const lista = origen.getDataList(); const r = origen.getVisibleRange();
            // scrollToTimestamp deja la vela pedida a 2 posiciones del borde derecho (realTo = índice + 2).
            const vela = lista[Math.min(lista.length - 1, Math.max(0, Math.floor(r.realTo != null ? r.realTo : r.to) - 2))];
            if (!vela) return;
            const espacio = origen.getBarSpace().bar;
            celdas().forEach((c) => {
                if (c.chart === origen || c.tf !== tfOrigen) return;
                c.chart.__mcBloqueo = Date.now() + 200;
                try { c.chart.setBarSpace(espacio); c.chart.scrollToTimestamp(vela.timestamp, 0); } catch (_) { /* gráfico recién creado */ }
            });
        }
        // Solo el gráfico que el usuario tiene bajo el dedo/mouse manda el tiempo: así una carga de datos o un
        // cambio de tamaño de otro gráfico no mueve el que se está mirando.
        let activo = null;
        function enlazar(chart, el, tfDe) {
            ['pointerenter', 'pointerdown', 'wheel', 'touchstart'].forEach((ev) => el.addEventListener(ev, () => { activo = chart; }, { passive: true }));
            chart.subscribeAction('onCrosshairChange', (c) => { mostrarCruz(chart, c && c.timestamp != null && c.kLineData ? c.timestamp : null); });
            chart.subscribeAction('onVisibleRangeChange', () => { if (chart === activo && (chart.__mcBloqueo || 0) <= Date.now()) propagarTiempo(chart, tfDe()); });
        }
        enlazar(principal.chart, principalEl, () => principal.timeframe());

        // ── Gráficos secundarios ──
        async function pedir(p, limite) {
            const r = await NLT_API.chartsVelas(p.s, p.tf, { limit: limite });
            return { velas: r.candles.map(aKline), precision: r.price_precision };
        }
        function estadoPane(p, txt) { p.msg.textContent = txt || ''; p.msg.hidden = !txt; }
        function cargarPane(p) {
            const gen = ++p.gen;
            const info = porSimbolo[p.s]; if (!info) return;
            estadoPane(p, 'Cargando…');
            clearInterval(p.timer);
            p.chart.setSymbol({ ticker: p.s, pricePrecision: info.price_precision, volumePrecision: 0 });
            p.chart.setPeriod(window.NLTCharts.market.PERIODOS[p.tf]);
            p.chart.setDataLoader({
                getBars: async ({ type, callback }) => {
                    if (type !== 'init') { callback([], { forward: false, backward: false }); return; }
                    try {
                        const r = await pedir(p, 500);
                        if (gen !== p.gen) { callback([], { forward: false, backward: false }); return; }
                        callback(r.velas, { forward: false, backward: false });
                        estadoPane(p, r.velas.length ? '' : 'Sin datos para este símbolo');
                    } catch (_) {
                        if (gen === p.gen) { callback([], { forward: false, backward: false }); estadoPane(p, 'No se pudieron cargar los precios'); }
                    }
                },
                subscribeBar: ({ callback }) => { p.empujar = callback; },
                unsubscribeBar: () => { p.empujar = null; },
            });
            p.timer = setInterval(async () => {
                if (document.hidden || !p.empujar) return;
                try {
                    const r = await pedir(p, 3);
                    if (gen !== p.gen || !p.empujar) return;
                    r.velas.forEach((v) => p.empujar(v));
                } catch (_) { /* el próximo ciclo reintenta */ }
            }, REFRESCO_MS);
        }
        function crearPane(s, tf) {
            const cell = document.createElement('div');
            cell.className = 'mc-cell';
            cell.innerHTML = `<div class="mc-cab"><select class="mc-sel" data-k="s" aria-label="Símbolo del gráfico">${simbolos.map((x) =>
                `<option value="${esc(x.symbol)}">${esc(x.symbol)}</option>`).join('')}</select><select class="mc-sel" data-k="tf" aria-label="Intervalo del gráfico">${timeframes.map((x) =>
                `<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></div><div class="mc-body"></div><div class="mc-msg" hidden></div>`;
            stage.appendChild(cell);
            const body = cell.querySelector('.mc-body');
            const p = { s, tf, cell, body, msg: cell.querySelector('.mc-msg'), gen: 0, timer: null, empujar: null };
            p.chart = klinecharts.init(body, { styles: estilos, locale: 'en-US' });
            p.chart.setOffsetRightDistance(40);
            p.ro = new ResizeObserver(() => p.chart.resize());
            p.ro.observe(body);
            enlazar(p.chart, body, () => p.tf);
            const selS = cell.querySelector('[data-k="s"]'), selT = cell.querySelector('[data-k="tf"]');
            selS.value = s; selT.value = tf;
            selS.addEventListener('change', () => { p.s = selS.value; guardar(); cargarPane(p); });
            selT.addEventListener('change', () => { p.tf = selT.value; guardar(); cargarPane(p); });
            p.selS = selS; p.selT = selT;
            cargarPane(p);
            return p;
        }
        function destruirPane(p) {
            clearInterval(p.timer); p.gen++;
            try { p.ro.disconnect(); klinecharts.dispose(p.body); } catch (_) { /* ya liberado */ }
            const l = lineas.get(p.body); if (l) { l.remove(); lineas.delete(p.body); }
            p.cell.remove();
        }

        // Los secundarios por defecto: los símbolos siguientes al principal, en su mismo intervalo.
        function sugerido(i) {
            const base = Math.max(0, simbolos.findIndex((x) => x.symbol === principal.symbol()));
            return simbolos[(base + i + 1) % simbolos.length].symbol;
        }
        function aplicarSync() {
            panes.forEach((p) => {
                if (sync.symbol && p.s !== principal.symbol()) { p.s = principal.symbol(); p.selS.value = p.s; cargarPane(p); }
                if (sync.interval && p.tf !== principal.timeframe()) { p.tf = principal.timeframe(); p.selT.value = p.tf; cargarPane(p); }
                p.selS.disabled = sync.symbol; p.selT.disabled = sync.interval;
            });
        }
        function acomodar() {
            const rs = rectas(diseno, stage.clientWidth);
            const pos = (el, r, arriba) => {
                el.style.left = `calc(${r[0] * 100}% + 1px)`; el.style.top = `calc(${r[1] * 100}% + 1px)`;
                el.style.width = `calc(${r[2] * 100}% - 2px)`; el.style.height = `calc(${r[3] * 100}% - 2px)`;
                if (arriba) el.style.right = 'auto', el.style.bottom = 'auto';
            };
            if (diseno === '1') { principalEl.style.cssText = ''; principalEl.classList.remove('mc-principal'); }
            else { principalEl.classList.add('mc-principal'); pos(principalEl, rs[0], true); }
            panes.forEach((p, i) => pos(p.cell, rs[i + 1], true));
            // El reloj de la vela va pegado al borde derecho del gráfico principal, no del escenario entero.
            stage.style.setProperty('--mc-der', diseno === '1' ? '0px' : `${Math.max(0, stage.clientWidth - principalEl.offsetLeft - principalEl.offsetWidth)}px`);
            ocultarCruces();
        }
        function aplicarDiseno(id, restaurar) {
            diseno = DISENOS[id] ? id : '1';
            const quiero = DISENOS[diseno].n - 1;
            while (panes.length > quiero) destruirPane(panes.pop());
            while (panes.length < quiero) {
                const prev = restaurar && restaurar[panes.length];
                const s = prev && porSimbolo[prev.s] ? prev.s : sugerido(panes.length);
                const tf = prev && timeframes.includes(prev.tf) ? prev.tf : principal.timeframe();
                panes.push(crearPane(s, tf));
            }
            stage.classList.toggle('mc-multi', diseno !== '1');
            aplicarSync(); acomodar(); guardar(); pintarMenu();
            requestAnimationFrame(() => { principal.chart.resize(); panes.forEach((p) => p.chart.resize()); });
        }
        new ResizeObserver(() => { if (diseno !== '1') acomodar(); }).observe(stage);

        // ── Botón y menú de diseño ──
        const btn = document.createElement('button');
        btn.type = 'button'; btn.id = 'chBtnMulti'; btn.className = 'ch-btn ch-herr'; btn.title = 'Diseño de gráficos (multi-gráfico)'; btn.setAttribute('aria-label', 'Diseño de gráficos');
        btn.innerHTML = '<i class="ph ph-squares-four"></i><span class="ch-btn-label">Diseño</span>';
        const menu = document.createElement('div');
        menu.className = 'mc-menu'; menu.id = 'chMultiMenu'; menu.hidden = true; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Diseño de gráficos');
        document.body.appendChild(menu);
        function pintarMenu() {
            const chk = (k, txt) => `<label class="mc-chk"><input type="checkbox" data-sync="${k}" ${sync[k] ? 'checked' : ''}> ${txt}</label>`;
            menu.innerHTML = `<div class="mc-tit">Diseño</div><div class="mc-dis">${Object.entries(DISENOS).map(([id, d]) =>
                `<button type="button" class="mc-d${id === diseno ? ' on' : ''}" data-d="${id}">${esc(d.nombre)}</button>`).join('')}</div>
                <div class="mc-tit">Sincronizar</div>${chk('symbol', 'Símbolo')}${chk('interval', 'Intervalo')}${chk('crosshair', 'Cruz (crosshair)')}${chk('time', 'Tiempo (desplazamiento y zoom)')}
                <p class="mc-nota">Los gráficos extra son de consulta: los indicadores y dibujos se hacen en el gráfico principal (el de arriba a la izquierda).</p>`;
        }
        menu.addEventListener('click', (e) => {
            const d = e.target.closest('[data-d]');
            if (d) aplicarDiseno(d.dataset.d, panes.map((p) => ({ s: p.s, tf: p.tf })));
        });
        menu.addEventListener('change', (e) => {
            const k = e.target.dataset && e.target.dataset.sync;
            if (!k) return;
            sync[k] = e.target.checked; aplicarSync(); guardar();
            if (k === 'time' && sync.time) propagarTiempo(principal.chart, principal.timeframe());
            if (!sync.crosshair) ocultarCruces();
        });
        const abrirMenu = (el, boton) => {
            const abierto = !el.hidden;
            document.querySelectorAll('.mc-menu').forEach((m) => { m.hidden = true; });
            if (abierto) return;
            el.hidden = false;
            const r = boton.getBoundingClientRect();
            el.style.top = `${r.bottom + 6}px`;
            el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8))}px`;
        };
        btn.addEventListener('click', (e) => { e.stopPropagation(); pintarMenu(); abrirMenu(menu, btn); });
        document.addEventListener('click', (e) => { const ruta = e.composedPath(); if (!ruta.some((n) => n.classList && (n.classList.contains('mc-menu') || n.id === 'chBtnMulti' || n.id === 'chBtnCompare' || n.id === 'chBtnAlertas' || n.id === 'chBtnAnalisis'))) document.querySelectorAll('.mc-menu').forEach((m) => { m.hidden = true; }); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.mc-menu').forEach((m) => { m.hidden = true; }); });

        // ── Comparar símbolos ──
        const cmp = [];   // { sym, color, mapa: Map(ts->close), slot }
        const global = (window.NLTCharts.compareData = window.NLTCharts.compareData || {});
        for (let i = 0; i < MAX_COMPARAR; i++) {
            const nombre = `NLT_CMP_${i}`;
            klinecharts.registerIndicator({
                name: nombre, shortName: nombre, series: 'price', precision: 5,
                figures: [{ key: 'v', title: '', type: 'line' }],
                calc: (dataList) => {
                    const d = global[nombre];
                    if (!d || !d.mapa.size) return dataList.map(() => ({}));
                    let base = null;
                    for (const v of dataList) { const c = d.mapa.get(v.timestamp); if (c != null) { base = { principal: v.close, cmp: c }; break; } }
                    if (!base) return dataList.map(() => ({}));
                    return dataList.map((v) => { const c = d.mapa.get(v.timestamp); return c == null ? {} : { v: base.principal * c / base.cmp }; });
                },
                createTooltipDataSource: () => {
                    const d = global[nombre];
                    return { name: d ? d.sym : '', calcParamsText: '', features: [], legends: [] };
                },
            });
        }
        const popCmp = document.createElement('div');
        popCmp.className = 'mc-menu'; popCmp.id = 'chCompareMenu'; popCmp.hidden = true; popCmp.setAttribute('role', 'dialog'); popCmp.setAttribute('aria-label', 'Comparar símbolos');
        document.body.appendChild(popCmp);
        const btnCmp = document.createElement('button');
        btnCmp.type = 'button'; btnCmp.id = 'chBtnCompare'; btnCmp.className = 'ch-btn ch-herr'; btnCmp.title = 'Comparar símbolos'; btnCmp.setAttribute('aria-label', 'Comparar símbolos');
        btnCmp.innerHTML = '<i class="ph ph-chart-line"></i><span class="ch-btn-label">Comparar</span>';

        const pctVisible = (lista, r, valor) => {
            const a = Math.max(0, Math.ceil(r.from)), b = Math.min(lista.length - 1, Math.floor(r.to) - 1);
            let ini = null, fin = null;
            for (let i = a; i <= b; i++) { const v = valor(lista[i]); if (v != null) { if (ini == null) ini = v; fin = v; } }
            return ini && fin != null ? (fin / ini - 1) * 100 : null;
        };
        function pintarCmp() {
            const chart = principal.chart; const lista = chart.getDataList(); let r = { from: 0, to: 0 };
            try { r = chart.getVisibleRange(); } catch (_) { /* sin datos */ }
            const fmt = (p) => (p == null ? '—' : `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`);
            const clase = (p) => (p == null ? '' : p >= 0 ? 'sube' : 'baja');
            const pPrin = pctVisible(lista, r, (v) => v.close);
            const filas = cmp.map((c, i) => {
                const p = pctVisible(lista, r, (v) => c.mapa.get(v.timestamp));
                return `<div class="mc-fila"><i style="background:${c.color}"></i><b>${esc(c.sym)}</b><span class="${clase(p)}">${fmt(p)}</span><button type="button" data-quitar="${i}" aria-label="Quitar ${esc(c.sym)}">✕</button></div>`;
            }).join('');
            popCmp.innerHTML = `<div class="mc-tit">Comparar símbolos</div>
                <div class="mc-fila"><i style="background:#22D3EE"></i><b>${esc(principal.symbol())}</b><span class="${clase(pPrin)}">${fmt(pPrin)}</span><span></span></div>${filas}
                ${cmp.length < MAX_COMPARAR ? `<div class="mc-add"><select id="chCmpSel" class="mc-sel">${simbolos.filter((x) => x.symbol !== principal.symbol() && !cmp.some((c) => c.sym === x.symbol)).map((x) =>
                    `<option value="${esc(x.symbol)}">${esc(x.symbol)}</option>`).join('')}</select><button type="button" id="chCmpAdd" class="mc-d on">Añadir</button></div>` : '<p class="mc-nota">Máximo 3 comparaciones.</p>'}
                <p class="mc-nota">Las líneas arrancan del mismo punto; el % es el del tramo visible en pantalla.</p>`;
        }
        function dibujarCmp() {
            const chart = principal.chart;
            for (let i = 0; i < MAX_COMPARAR; i++) {
                const nombre = `NLT_CMP_${i}`;
                try { chart.removeIndicator({ name: nombre }); } catch (_) { /* no estaba */ }
                const c = cmp[i];
                global[nombre] = c ? { sym: c.sym, mapa: c.mapa } : null;
                if (c) chart.createIndicator({ name: nombre, styles: { lines: [{ color: c.color, size: 1.5, style: 'solid' }] } }, true, { id: 'candle_pane' });
            }
            pintarCmp();
        }
        async function cargarCmp(c) {
            try {
                const r = await NLT_API.chartsVelas(c.sym, principal.timeframe(), { limit: 500 });
                c.mapa = new Map(r.candles.map((v) => [v.t, v.c]));
            } catch (_) { c.mapa = c.mapa || new Map(); }
        }
        async function recargarCmp() { await Promise.all(cmp.map(cargarCmp)); dibujarCmp(); }
        const guardarCmp = () => state.savePrefs({ compare: cmp.map((c) => c.sym) });
        popCmp.addEventListener('click', async (e) => {
            const q = e.target.closest('[data-quitar]');
            if (q) { cmp.splice(Number(q.dataset.quitar), 1); cmp.forEach((c, i) => { c.color = COLORES_CMP[i]; }); guardarCmp(); dibujarCmp(); return; }
            if (e.target.id === 'chCmpAdd') {
                const sym = popCmp.querySelector('#chCmpSel').value;
                if (!sym || cmp.length >= MAX_COMPARAR || cmp.some((c) => c.sym === sym)) return;
                const c = { sym, color: COLORES_CMP[cmp.length], mapa: new Map() };
                cmp.push(c); guardarCmp();
                e.target.disabled = true;
                await cargarCmp(c); dibujarCmp();
            }
        });
        btnCmp.addEventListener('click', (e) => { e.stopPropagation(); pintarCmp(); abrirMenu(popCmp, btnCmp); });
        let tPct = null;
        principal.chart.subscribeAction('onVisibleRangeChange', () => { clearTimeout(tPct); tPct = setTimeout(() => { if (!popCmp.hidden) pintarCmp(); }, 120); });
        setInterval(async () => { if (document.hidden || !cmp.length) return; await recargarCmp(); }, 15000);

        const ancla = document.getElementById('chBtnConfig');
        if (ancla) { ancla.before(btn); ancla.before(btnCmp); }

        // Refresco del principal (símbolo o intervalo): los secundarios sincronizados lo siguen y las comparaciones se re-piden.
        function cambioPrincipal() {
            aplicarSync();
            if (cmp.length) { cmp.forEach((c) => { c.mapa = new Map(); }); dibujarCmp(); recargarCmp(); }
            if (diseno !== '1') requestAnimationFrame(() => { propagarTiempo(principal.chart, principal.timeframe()); });
        }
        // Restaurar lo guardado
        aplicarDiseno(diseno, guardado.panes || []);
        const previas = (state.prefs().compare || []).filter((s) => porSimbolo[s] && s !== principal.symbol()).slice(0, MAX_COMPARAR);
        previas.forEach((s, i) => cmp.push({ sym: s, color: COLORES_CMP[i], mapa: new Map() }));
        if (cmp.length) recargarCmp();

        return {
            cambioPrincipal, aplicarDiseno, diseno: () => diseno, paneles: () => panes.map((p) => ({ s: p.s, tf: p.tf, chart: p.chart })),
            comparaciones: () => cmp.map((c) => c.sym), sync,
        };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.multi = { montar, DISENOS, rectas };
})();
