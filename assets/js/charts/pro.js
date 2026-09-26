/* NLT Charts -- NLT Zone Engine V13.4: sección PRO del panel, configuración,
 * dibujo y tablas.
 *
 * Este archivo NO decide acceso ni calcula nada del motor. El servidor corre el
 * Zone Engine completo (/charts/pro/zone-engine) y devuelve SOLO lo que V13.4
 * dibuja: cajas, líneas, etiquetas, formas y sus dos tablas, con los textos y
 * colores del indicador. Acá solo se pinta. Si alguien modifica este JS para
 * "encender" el PRO sin permiso, el backend responde 403 y no hay nada que dibujar.
 *
 * La configuración (las 66 entradas de V13.4) la da el servidor solo a quien
 * tiene acceso. Las entradas "visual" (mostrar OB/FVG/CRT/EQ/Asian/OTE/swings,
 * S/R, Fibonacci, panel, expandir, diagnóstico, panel NLT AI) no recalculan:
 * cada objeto viene marcado con su toggle y se filtra acá, aplicando el pool
 * de 500 etiquetas/líneas de TradingView.
 *
 * Zona manual (📦 ZONA MANUAL de V13.4): una por símbolo. Se define en la
 * configuración o conectando un rectángulo ("NLT Engine" en la barra del
 * dibujo); las dos quedan sincronizadas. Se re-analiza al moverla, al cambiar
 * la configuración y con cada vela nueva. */
(function () {
    const ZE = 'NLT_ZONE_ENGINE';
    const REFRESCO_MS = 30000;
    const PREF = 'nlt_charts_pro_ver_v1';
    const ZONA_IDS = ['zoneTop', 'zoneBot', 'zoneIsOB', 'zoneIsBull'];
    const POOL = 500;   // max_labels_count / max_lines_count de V13.4
    const TAM_FORMA = { tiny: 7, small: 9, normal: 11, large: 15 };

    // Las cuatro entradas de la zona manual (V13.4). Son datos del usuario, no parámetros del motor.
    const ZONA_INPUTS = [
        { id: 'zoneTop', tipo: 'float', def: 0, titulo: 'Zona TOP', grupo: '📦 ZONA MANUAL (precios)', step: 0.00001 },
        { id: 'zoneBot', tipo: 'float', def: 0, titulo: 'Zona BOTTOM', grupo: '📦 ZONA MANUAL (precios)', step: 0.00001 },
        { id: 'zoneIsOB', tipo: 'bool', def: true, titulo: 'Tipo de zona: Order Block  (desmarcar = FVG)', grupo: '🌐 NLT AI (webhook)' },
        { id: 'zoneIsBull', tipo: 'bool', def: true, titulo: 'Dirección: ALCISTA / LONG  (desmarcar = Bajista / SHORT)', grupo: '🌐 NLT AI (webhook)' },
    ];

    const col = (c) => (c ? NLTCharts.pine.css({ hex: c[0], t: c[1] }) : 'transparent');

    // ---------------------------------------------------------------- dibujo del indicador
    let dibujo = null;            // última respuesta (lo que V13.4 dibuja)
    let vista = null;             // dibujo ya filtrado por toggles y pool (se rearma solo si cambia algo)
    let visuales = {};            // valores de las entradas visuales
    let registrado = false;

    // Etiquetas y formas llegan compactas ([x, y, texto, estilo] / [x, estilo] + tabla de estilos).
    function expandir(d) {
        if (d._expandido) return;
        const st = d.styles || [];
        d.labels = d.labels.map(([x, y, t, k]) => { const e = st[k]; return { x, y, t, g: e[1], s: e[2], c: e[3], tc: e[4], z: e[5], a: e[6] }; });
        d.shapes = d.shapes.map(([x, k]) => { const e = st[k]; return { x, g: e[1], f: e[2], loc: e[3], c: e[4], z: e[5], t: e[6] }; });
        d._expandido = true;
    }

    function armarVista() {
        if (!dibujo) { vista = null; return; }
        expandir(dibujo);
        const ve = (g) => !g || visuales[g] !== false;
        const pool = (lista) => { const f = lista.filter((o) => ve(o.g)); return f.length > POOL ? f.slice(f.length - POOL) : f; };
        vista = {
            boxes: dibujo.boxes.filter((o) => ve(o.g)),
            lines: pool(dibujo.lines),
            labels: pool(dibujo.labels),
            shapes: dibujo.shapes.filter((o) => ve(o.g)),
        };
    }

    // timestamp -> índice de vela del gráfico (velas futuras = última + N períodos)
    let idxCache = { clave: '', f: null };
    function indexador(dl, periodo) {
        const clave = `${dl.length}|${dl[0].timestamp}|${dl[dl.length - 1].timestamp}|${periodo}`;
        if (idxCache.clave === clave) return idxCache.f;
        const n = dl.length, first = dl[0].timestamp, last = dl[n - 1].timestamp;
        const mapa = new Map(dl.map((d, k) => [d.timestamp, k]));
        const f = (ts) => {
            const v = mapa.get(ts);
            if (v !== undefined) return v;
            if (ts > last) return n - 1 + Math.round((ts - last) / periodo);
            if (ts < first) return Math.round((ts - first) / periodo);
            let lo = 0, hi = n - 1;
            while (lo < hi) { const m = (lo + hi + 1) >> 1; if (dl[m].timestamp <= ts) lo = m; else hi = m - 1; }
            return lo;
        };
        idxCache = { clave, f };
        return f;
    }

    // plotshape (flechas del CRT, triángulos ⚔️ de entrada) debajo/encima de la vela
    function forma(L, sh, vela, x) {
        const { ctx } = L;
        const t = TAM_FORMA[sh.z] || 9;
        const abajo = sh.loc === 'below';
        const yBase = abajo ? L.y(vela.low) + 4 : L.y(vela.high) - 4;
        const px = L.x(x);
        ctx.fillStyle = col(sh.c);
        ctx.beginPath();
        if (sh.f === 'triangleup' || sh.f === 'arrowup') {
            ctx.moveTo(px, yBase); ctx.lineTo(px - t / 2, yBase + t); ctx.lineTo(px + t / 2, yBase + t);
        } else {
            ctx.moveTo(px, yBase); ctx.lineTo(px - t / 2, yBase - t); ctx.lineTo(px + t / 2, yBase - t);
        }
        ctx.closePath();
        ctx.fill();
        if (sh.f.startsWith('arrow')) ctx.fillRect(px - 1, abajo ? yBase + t : yBase - t - t * 0.6, 2, t * 0.6);
        if (sh.t) {
            ctx.font = `${t}px ${NLTCharts.pine.FUENTE}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = abajo ? 'top' : 'bottom';
            ctx.fillText(sh.t, px, abajo ? yBase + t + 2 : yBase - t - 2);
            ctx.textAlign = 'left';
        }
    }

    function registrar() {
        if (registrado) return;
        registrado = true;
        klinecharts.registerIndicator({
            name: 'NLT_PRO_ZONES',
            shortName: 'NLT Zone Engine',
            figures: [],
            calc: (dataList) => dataList.map(() => ({})),
            createTooltipDataSource: ({ indicator }) => ({ name: '⚡ NLT ZONE ENGINE V13.4', calcParamsText: '', features: NLTCharts.leyenda.features(indicator), legends: [] }),
            draw: ({ ctx, chart, bounding, xAxis, yAxis }) => {
                if (!vista) return false;
                const dl = chart.getDataList();
                if (!dl.length) return false;
                const p = chart.getPeriod();
                const periodo = ({ minute: 60000, hour: 3600000, day: 86400000, week: 604800000 }[p.type] || 60000) * p.span;
                const idx = indexador(dl, periodo);
                const P = NLTCharts.pine;
                const L = P.lienzo(ctx, chart, bounding, xAxis, yAxis);
                const { from, to } = chart.getVisibleRange();
                const visible = (a, b) => Math.max(a, b) >= from - 2 && Math.min(a, b) <= to + 60;
                ctx.save();
                vista.boxes.forEach((b) => {
                    const a = idx(b.x1), z = idx(b.x2);
                    if (!visible(a, z)) return;
                    P.caja(L, { left: a, right: z, top: b.top, bottom: b.bot, bg: { hex: b.bg[0], t: b.bg[1] }, border: { hex: b.bc[0], t: b.bc[1] }, borderWidth: b.bw });
                });
                vista.lines.forEach((l) => {
                    const a = idx(l.x1), z = idx(l.x2);
                    if (!visible(a, z)) return;
                    P.linea(L, { x1: a, y1: l.y1, x2: z, y2: l.y2, color: { hex: l.c[0], t: l.c[1] }, style: l.s, width: l.w });
                });
                vista.shapes.forEach((sh) => {
                    const k = idx(sh.x);
                    if (k < from || k > to || !dl[k]) return;
                    forma(L, sh, dl[k], k);
                });
                vista.labels.forEach((lb) => {
                    const k = idx(lb.x);
                    if (!visible(k, k)) return;
                    P.etiqueta(L, { x: k, y: lb.y, text: lb.t, style: lb.s, color: { hex: lb.c[0], t: lb.c[1] }, textColor: { hex: lb.tc[0], t: lb.tc[1] }, size: lb.z, align: lb.a }, dl);
                });
                ctx.restore();
                return false;
            },
        });
    }

    // ---------------------------------------------------------------- tablas de V13.4
    const esc = (t) => NLTCharts.ui.esc(t);
    const br = (t) => esc(t).replace(/\n/g, '<br>');

    function htmlPanel(p, v, minimizado) {
        const exp = !!v.expandPanel, diag = !!v.showContextDiag;
        const filas = p.filas.filter((f) => f.m === 's' || (f.m === 'x' && exp) || (f.m === 'c' && !exp) || (f.m === 'd' && diag));
        const div = (bg) => `<tr class="ze-div" style="background:${col(bg)}"><td>──────────────────</td><td>──────────</td></tr>`;
        return `<table class="ze-tabla${minimizado ? ' ze-min' : ''}">
            <tr class="ze-hdr" data-ze="minimizar" title="Tocá para minimizar o expandir" style="background:${col(p.hdr.bg)}">
                <td style="color:${col(p.hdr.lc)}">${esc(p.hdr.l)}</td><td class="ze-v" style="color:${col(p.hdr.c)}">${esc(p.hdr.v)}</td></tr>
            ${div(p.div0)}
            ${filas.map((f) => (f.div ? div(f.bg) :
                `<tr${f.exp ? ' class="ze-exp" data-ze="expandir"' : ''} style="background:${col(f.bg)}"><td class="ze-l" style="color:${col(f.lc)}">${br(f.l)}</td><td class="ze-v ze-${esc(f.z)}" style="color:${col(f.c)}">${br(f.v)}</td></tr>`)).join('')}
        </table>`;
    }

    function htmlPanelNlt(p) {
        return `<table class="ze-tabla ze-nlt">${p.filas.map(([l, v, lc, vc, z, bg]) =>
            `<tr${bg ? ` style="background:${col(bg)}"` : ''}><td class="ze-l ze-${esc(z)}" style="color:${col(lc)}">${esc(l)}</td><td class="ze-${esc(z)}" style="color:${col(vc)}">${esc(v)}</td></tr>`).join('')}</table>`;
    }

    // Mostrar/ocultar las zonas PRO: preferencia del usuario (viaja con el layout de la cuenta).
    function leerPref() {
        const v = NLTCharts.state.prefs().proZonasVisibles;
        if (v !== undefined) return v === true;
        try { return localStorage.getItem(PREF) === '1'; } catch (_) { return false; }   // valor anterior
    }
    function guardarPref(v) { NLTCharts.state.savePrefs({ proZonasVisibles: !!v }); }

    function tiempoRestante(iso) {
        const ms = new Date(iso).getTime() - Date.now();
        if (ms <= 0) return 'termina ahora';
        const h = Math.floor(ms / 3600000);
        return h >= 24 ? `quedan ${Math.floor(h / 24)} d ${h % 24} h` : `quedan ${h} h ${Math.floor((ms % 3600000) / 60000)} min`;
    }

    /**
     * crear({ chart, getSymbol, getTimeframe, dibujos, onCambio }) -> api
     *   dibujos: api de drawings.js (rectángulos conectados al motor)
     */
    function crear({ chart, getSymbol, getTimeframe, dibujos, onCambio }) {
        registrar();
        const S = NLTCharts.settings;
        const state = NLTCharts.state;
        S.registrar(ZE, { titulo: 'NLT Zone Engine V13.4', inputs: ZONA_INPUTS });
        let catalogo = null;
        let error = '';
        let ver = leerPref();
        let oculto = !!state.prefs().proOculto;
        let dibujado = false;
        let esquema = null;           // entradas de V13.4 (solo con acceso)
        let rectId = null, rectVisto = false;
        let previa = null;            // valores mientras el diálogo está abierto
        let timer = null, timerCorto = null, seq = 0;

        const zeAcceso = () => {
            const ze = catalogo && catalogo.indicators.find((i) => i.id === ZE);
            return ze ? ze.access : null;
        };
        const tieneAcceso = () => { const a = zeAcceso(); return !!(a && a.has_access); };

        // ---- zona manual por símbolo (prefs.zeZonas) ----
        function zonaDe(sym) {
            const z = (state.prefs().zeZonas || {})[sym];
            return z && z.top > 0 && z.bottom > 0 && z.top > z.bottom ? z : null;
        }
        function guardarZona(sym, z) {
            const todas = { ...(state.prefs().zeZonas || {}) };
            if (z) todas[sym] = { top: z.top, bottom: z.bottom, esOB: !!z.esOB, alcista: !!z.alcista }; else delete todas[sym];
            state.savePrefs({ zeZonas: todas });
        }
        const zonaDeValores = (v) => (v.zoneTop > 0 && v.zoneBot > 0 && v.zoneTop > v.zoneBot
            ? { top: v.zoneTop, bottom: v.zoneBot, esOB: v.zoneIsOB, alcista: v.zoneIsBull } : null);
        // Valores vigentes: configuración (o vista previa) + la zona del símbolo actual.
        function valores() {
            if (previa) return previa;
            const v = { ...S.valores(ZE) };
            const z = zonaDe(getSymbol());
            v.zoneTop = z ? z.top : 0; v.zoneBot = z ? z.bottom : 0;
            v.zoneIsOB = z ? z.esOB : true; v.zoneIsBull = z ? z.alcista : true;
            return v;
        }
        // Lo que viaja al servidor: entradas que cambian el cálculo (rol calc) + la zona manual.
        function entradasCalculo(v) {
            const out = {};
            if (esquema) esquema.forEach((e) => { if ((e.rol === 'calc' || e.rol === 'zona') && v[e.id] !== undefined) out[e.id] = v[e.id]; });
            else ZONA_IDS.forEach((k) => { out[k] = v[k]; });
            return out;
        }
        function actualizarVisuales() {
            const v = valores();
            visuales = {};
            (esquema || []).forEach((e) => { if (e.rol === 'visual') visuales[e.id] = v[e.id]; });
            armarVista();
        }

        // Rectángulo conectado (del símbolo actual). Si el usuario lo borró, la zona manual se quita.
        function resolverRect() {
            const con = dibujos.zonasConectadas();
            const r = con.length ? con[con.length - 1] : null;
            if (r) { rectId = r.id; rectVisto = true; return r; }
            if (rectVisto && rectId) { rectId = null; rectVisto = false; guardarZona(getSymbol(), null); }
            rectId = null;
            return null;
        }

        async function cargarEsquema() {
            if (esquema || !tieneAcceso()) return;
            try {
                const r = await NLT_API.chartsZoneEngineAjustes();
                esquema = r.inputs;
                S.registrar(ZE, {
                    titulo: `⚡ NLT ZONE ENGINE ${r.version || ''}`.trim(),
                    inputs: r.inputs.map((e) => ({
                        id: e.id, tipo: e.tipo, def: e.def, titulo: e.titulo, grupo: e.grupo, min: e.min, max: e.max, step: e.step,
                        opciones: e.opciones, tooltip: e.tooltip,
                        recalc: e.rol === 'visual' || e.rol === 'local' ? false : undefined,
                    })),
                });
                actualizarVisuales();
            } catch (_) { /* sin esquema: solo la zona manual */ }
        }

        function mostrarEnGrafico(si) {
            if (si && !dibujado) { chart.createIndicator({ name: 'NLT_PRO_ZONES', paneId: 'candle_pane', visible: !oculto }, true); dibujado = true; }
            if (!si && dibujado) { chart.removeIndicator({ name: 'NLT_PRO_ZONES' }); dibujado = false; dibujo = null; vista = null; }
            pintarTablas();
        }

        // ---- tablas en el tablero compartido (panel arriba a la derecha, NLT AI abajo a la derecha) ----
        let firmaPanel = '', firmaNlt = '';
        function pintarTablas() {
            const v = valores();
            const activo = dibujado && !oculto && dibujo;
            NLTCharts.ui.tablero.ajustar(chart);
            if (activo && v.showAIPanel !== false) {
                const g = state.prefs().dashMin;
                const minimizado = Array.isArray(g) ? g.includes('ze') : window.innerWidth < 768;
                const html = htmlPanel(dibujo.panel, v, minimizado);
                if (html !== firmaPanel) {
                    firmaPanel = html;
                    const el = NLTCharts.ui.tablero.slot('Top Right', 'ze');
                    if (el && !el.dataset.oyente) {
                        el.dataset.oyente = '1';
                        el.addEventListener('click', (ev) => {
                            const acc = ev.target.closest('[data-ze]');
                            if (!acc) return;
                            // En Pine esta fila es solo un aviso (no hay clicks); acá expande de verdad.
                            if (acc.dataset.ze === 'expandir') { S.guardar(ZE, { ...S.valores(ZE), expandPanel: true }); aplicarVisual(); return; }
                            const g2 = state.prefs().dashMin;
                            const mins = new Set(Array.isArray(g2) ? g2 : (window.innerWidth < 768 ? ['sr', 'ict', 'ze'] : []));
                            mins.has('ze') ? mins.delete('ze') : mins.add('ze');
                            state.savePrefs({ dashMin: [...mins] });
                            pintarTablas();
                        });
                    }
                    if (el) el.innerHTML = `<div class="ud-dash ze-panel">${html}</div>`;
                }
            } else { NLTCharts.ui.tablero.quitar('ze'); firmaPanel = ''; }
            if (activo && v.nltShowPanel !== false && dibujo.nlt_panel) {
                const html = htmlPanelNlt(dibujo.nlt_panel);
                if (html !== firmaNlt) {
                    firmaNlt = html;
                    const el = NLTCharts.ui.tablero.slot('Bottom Right', 'ze-nlt');
                    if (el) el.innerHTML = `<div class="ud-dash">${html}</div>`;
                }
            } else { NLTCharts.ui.tablero.quitar('ze-nlt'); firmaNlt = ''; }
        }

        async function cargarCatalogo() {
            try {
                catalogo = await NLT_API.chartsProCatalogo();
                error = '';
            } catch (err) {
                error = err.message;
            }
            await cargarEsquema();
            onCambio && onCambio();
        }

        // Cambio solo visual: refiltrar y redibujar (el motor no se toca).
        function aplicarVisual() {
            actualizarVisuales();
            if (dibujado) chart.setStyles({});
            pintarTablas();
        }

        // Pedido al servidor. `seq` descarta respuestas viejas (llegaron después de un pedido más nuevo).
        async function refrescar() {
            clearTimeout(timer); clearTimeout(timerCorto);
            if (!ver || !tieneAcceso()) { mostrarEnGrafico(false); return; }
            if (document.visibilityState !== 'visible') { timer = setTimeout(refrescar, REFRESCO_MS); return; }
            const rect = resolverRect();
            if (rect && !previa) {
                // el rectángulo manda sobre los precios de la zona (el usuario lo movió)
                const zr = dibujos.rectanguloComoZona(rect.id);
                const actual = zonaDe(getSymbol());
                if (zr && (!actual || actual.top !== zr.top || actual.bottom !== zr.bottom)) {
                    guardarZona(getSymbol(), { top: zr.top, bottom: zr.bottom, esOB: rect.extendData.zonaNLT.esOB, alcista: rect.extendData.zonaNLT.alcista });
                }
            }
            const n = ++seq;
            try {
                const r = await NLT_API.chartsZoneEngine(getSymbol(), getTimeframe(), entradasCalculo(valores()));
                if (n !== seq) return;
                dibujo = r.drawing;
                actualizarVisuales();
                if (rect && dibujo) dibujos.marcarZona(rect.id, undefined, dibujo.manual_zone || null);
                mostrarEnGrafico(true);
                if (dibujado) chart.setStyles({});
                error = '';
            } catch (err) {
                if (n !== seq) return;
                error = err.message;
                if (err.status === 403) { ver = false; mostrarEnGrafico(false); await cargarCatalogo(); }
            }
            onCambio && onCambio();
            timer = setTimeout(refrescar, REFRESCO_MS);
        }
        const programar = (ms) => { clearTimeout(timerCorto); timerCorto = setTimeout(refrescar, ms); };

        // ---- configuración (las 66 entradas de V13.4) ----
        function abrirAjustes(tab) {
            const e = S.esquema(ZE);
            const cambioZona = (cambiados) => cambiados.some((c) => ZONA_IDS.includes(c));
            NLTCharts.settings.abrirDialogo({
                titulo: e.titulo,
                inputs: e.inputs,
                valores: valores(),
                tab,
                alCambiar: (vals, cambiados) => {
                    previa = { ...vals };
                    if (S.exigeRecalculo(ZE, cambiados) || cambioZona(cambiados)) programar(300); else aplicarVisual();
                },
                alAceptar: (vals) => {
                    previa = null;
                    const soloConfig = { ...vals };
                    ZONA_IDS.forEach((k) => delete soloConfig[k]);
                    S.guardar(ZE, soloConfig);
                    const z = zonaDeValores(vals);
                    guardarZona(getSymbol(), z);
                    // zona editada con un rectángulo conectado: el rectángulo acompaña
                    if (rectId) {
                        if (z) { dibujos.fijarPrecios(rectId, z.top, z.bottom); dibujos.marcarZona(rectId, { esOB: z.esOB, alcista: z.alcista }); }
                        else { dibujos.marcarZona(rectId, null); rectId = null; rectVisto = false; }
                    }
                    ver = true; guardarPref(true);
                    actualizarVisuales();
                    refrescar();
                },
                alCancelar: () => { previa = null; actualizarVisuales(); refrescar(); },
            });
        }

        // "NLT Engine" en la barra de un rectángulo: conectar (o ajustar) esa zona al motor.
        function conectarZona(id) {
            const r = dibujos.rectanguloComoZona(id);
            if (!r) return;
            const conectada = r.zonaNLT;
            const precio = (chart.getDataList().slice(-1)[0] || {}).close;
            const valoresIni = {
                zoneTop: r.top, zoneBot: r.bottom,
                zoneIsOB: conectada ? conectada.esOB : true,
                // sin dato previo: zona debajo del precio = demanda (alcista), arriba = oferta
                zoneIsBull: conectada ? conectada.alcista : !(precio != null && precio < r.bottom),
            };
            NLTCharts.settings.abrirDialogo({
                titulo: 'Conectar zona al NLT Zone Engine',
                inputs: ZONA_INPUTS,
                valores: valoresIni,
                botones: conectada ? [{ id: 'desconectar', texto: 'Desconectar del motor', accion: () => { NLTCharts.settings.cerrar(); desconectar(id); } }] : [],
                alAceptar: (vals) => {
                    const z = zonaDeValores(vals);
                    if (!z) { error = 'La zona necesita un precio superior (TOP) mayor que el inferior (BOTTOM).'; onCambio && onCambio(); return; }
                    // una sola zona manual por símbolo, como V13.4: la anterior se desconecta
                    dibujos.zonasConectadas().forEach((o) => { if (o.id !== id) dibujos.marcarZona(o.id, null); });
                    if (z.top !== r.top || z.bottom !== r.bottom) dibujos.fijarPrecios(id, z.top, z.bottom);
                    dibujos.marcarZona(id, { esOB: z.esOB, alcista: z.alcista });
                    guardarZona(getSymbol(), z);
                    rectId = id; rectVisto = true;
                    ver = true; guardarPref(true);
                    refrescar();
                },
            });
        }
        function desconectar(id) {
            dibujos.marcarZona(id, null);
            if (id === rectId) { rectId = null; rectVisto = false; guardarZona(getSymbol(), null); }
            refrescar();
        }

        function seccionZoneEngine(ind) {
            const acc = ind.access;
            let cuerpo;
            if (acc.has_access) {
                const origen = acc.reason === 'trial' ? `Prueba gratis · ${esc(tiempoRestante(acc.trial_expires_at))}` :
                    acc.reason === 'admin' ? 'Acceso de administrador' : 'Incluido en tu plan';
                const m = dibujo && dibujo.manual_zone;
                const z = zonaDe(getSymbol());
                cuerpo = `
                    <label class="ch-ind" style="padding-left:0">
                        <input type="checkbox" data-pro-ver${ver ? ' checked' : ''}>
                        <span><span class="ch-ind-name block">Mostrar en el gráfico</span><span class="ch-ind-desc">${origen}</span></span>
                    </label>
                    <div class="ch-pro-manual">
                        <p class="ch-ind-desc" style="margin-bottom:6px">Zona manual: dibujá un rectángulo y tocá <strong>NLT Engine</strong> en su barra, o cargala en la configuración.</p>
                        ${z ? `<p class="ch-ind-desc" style="color:#E5E7EB">${z.esOB ? 'OB' : 'FVG'} ${z.alcista ? 'alcista' : 'bajista'} · ${esc(NLTCharts.drawings.formatear(z.bottom))} – ${esc(NLTCharts.drawings.formatear(z.top))}${rectId ? ' · conectada a un rectángulo' : ''}</p>` : ''}
                        ${m ? `<p class="ch-ind-desc" style="margin-top:4px; color:#E5E7EB">Estado: <strong>${esc(m.status)}</strong> · Setup Quality ${esc(m.quality)}% (${esc(m.grade)}) · ${esc(m.validity)} · ${esc(m.touches)} toques</p>` : ''}
                    </div>`;
            } else if (acc.trial_status === 'NOT_STARTED' && ind.trial) {
                cuerpo = `<button type="button" data-pro-trial class="ch-btn" style="margin-top:6px">Probar ${esc(ind.trial.days)} días gratis</button>`;
            } else if (acc.trial_status === 'EXPIRED') {
                cuerpo = `<p class="ch-ind-desc" style="margin-top:4px">Tu prueba gratis terminó.</p>
                          <a href="indicator.html" class="ch-btn" style="margin-top:6px; display:inline-flex">Ver planes de NLT Indicator</a>`;
            } else {
                cuerpo = `<a href="indicator.html" class="ch-btn" style="margin-top:6px; display:inline-flex">Ver planes de NLT Indicator</a>`;
            }
            return `<div class="ch-pro"><div class="ch-pro-head"><span class="ch-ind-name">${esc(ind.name)}</span>${acc.has_access ? '<button type="button" class="ch-gear" data-pro-gear title="Configuración" aria-label="Configuración del Zone Engine"><i class="ph ph-gear-six"></i></button>' : '<span class="ch-lock">PRO</span>'}</div>
                    <p class="ch-ind-desc">${esc(ind.description)}</p>${cuerpo}</div>`;
        }

        function seccionProximamente(ind) {
            const extra = ind.access && ind.access.free_analyses_left != null
                ? ` · ${esc(ind.access.free_analyses_left)} análisis gratis cuando esté disponible` : '';
            return `<div class="ch-pro"><div class="ch-pro-head"><span class="ch-ind-name">${esc(ind.name)}</span><span class="ch-lock">PRÓXIMAMENTE</span></div>
                    <p class="ch-ind-desc">${esc(ind.description)}${extra}</p></div>`;
        }

        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ver) programar(200); });

        return {
            iniciar() { return cargarCatalogo().then(refrescar); },
            refrescar,
            renderSeccion(el) {
                if (!catalogo) {
                    el.innerHTML = `<p class="ch-grupo">PRO</p><p class="ch-ind-desc" style="padding:0 8px">${error ? esc(error) : 'Cargando...'}</p>`;
                    return;
                }
                el.innerHTML = '<p class="ch-grupo">PRO</p>' + catalogo.indicators.map((ind) =>
                    ind.id === ZE && ind.status === 'available' ? seccionZoneEngine(ind) : seccionProximamente(ind)).join('') +
                    (error ? `<p class="ch-ind-desc" style="color:rgb(248,113,113); padding:0 8px">${esc(error)}</p>` : '');

                const cb = el.querySelector('[data-pro-ver]');
                if (cb) cb.addEventListener('change', () => { ver = cb.checked; guardarPref(ver); refrescar(); });
                const bt = el.querySelector('[data-pro-trial]');
                if (bt) bt.addEventListener('click', async () => {
                    bt.disabled = true;
                    try {
                        await NLT_API.chartsProIniciarTrial(ZE);
                        ver = true; guardarPref(true);
                        await cargarCatalogo();
                        await refrescar();
                    } catch (err) { error = err.message; onCambio && onCambio(); }
                });
                const gear = el.querySelector('[data-pro-gear]');
                if (gear) gear.addEventListener('click', () => {
                    document.getElementById('chPanel').hidden = true;
                    document.getElementById('chPanelBg').hidden = true;
                    abrirAjustes();
                });
            },
            tieneAcceso,
            abrirAjustes: () => abrirAjustes(),
            // ojo de la leyenda: oculta todo lo del indicador (dibujos y tablas) sin quitarlo
            alternarVisible() {
                oculto = !oculto;
                state.savePrefs({ proOculto: oculto });
                if (dibujado) chart.overrideIndicator({ name: 'NLT_PRO_ZONES', visible: !oculto });
                pintarTablas();
            },
            conectarZona,
            // Rectángulo conectado movido/estirado: re-analizar (agrupado).
            zonaMovida(id) { if (!rectId || id === rectId) programar(400); },
            velaNueva() { if (ver && dibujado) programar(300); },
            // Los dibujos del símbolo ya están en pantalla: buscar el rectángulo conectado.
            dibujosRestaurados() { if (ver) programar(150); },
            // Al cambiar de símbolo: cada símbolo tiene su zona y sus rectángulos.
            cambioDeSimbolo() { rectId = null; rectVisto = false; dibujo = null; vista = null; pintarTablas(); programar(600); },
        };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.pro = { crear };
})();
