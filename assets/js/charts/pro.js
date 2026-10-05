/* NLT Charts -- NLT Zone Engine V13.3.3: sección PRO del panel, configuración,
 * dibujo y tablas.
 *
 * Este archivo NO decide acceso ni calcula nada del motor. El servidor corre el
 * Zone Engine completo (/charts/pro/zone-engine) y devuelve SOLO lo que V13.3.3
 * dibuja: cajas, líneas, etiquetas, formas y sus dos tablas, con los textos y
 * colores del indicador. Acá solo se pinta. Si alguien modifica este JS para
 * "encender" el PRO sin permiso, el backend responde 403 y no hay nada que dibujar.
 *
 * Es el Zone Engine V13.3.3 (el que se vende, sin IA). NLT AI es OTRO
 * indicador: recibe eventos del motor y muestra su análisis por separado.
 *
 * Configuración: Entradas (las 61 de V13.3.3, las da el servidor solo a quien
 * tiene acceso), Estilo (color, opacidad, grosor, tipo de línea, tamaño y
 * visibilidad de cada cosa que dibuja; por defecto, los colores del Pine) y
 * Visibilidad (por temporalidad). Lo visual no recalcula: cada objeto viene
 * marcado con su toggle y su clave de estilo y se filtra/pinta acá, aplicando
 * el pool de 500 etiquetas/líneas de TradingView.
 *
 * Zona manual (📦 ZONA MANUAL de V13.3.3): una por símbolo. Se define en la
 * configuración o conectando un rectángulo ("NLT Engine" en la barra del
 * dibujo); las dos quedan sincronizadas. Se re-analiza al moverla, al cambiar
 * la configuración y con cada vela nueva. */
(function () {
    const ZE = 'NLT_ZONE_ENGINE';
    const REFRESCO_MS = 30000;
    // Mercado cerrado (forex/metales el fin de semana): nada cambia. La vela de la reapertura
    // dispara velaNueva() y el motor se recalcula en el acto; esto es solo por las dudas.
    const REFRESCO_CERRADO_MS = 300000;
    const espera = () => (NLTCharts.market.estado() === 'cerrado' ? REFRESCO_CERRADO_MS : REFRESCO_MS);
    const PREF = 'nlt_charts_pro_ver_v1';
    const ZONA_IDS = ['zoneTop', 'zoneBot', 'zoneIsOB', 'zoneIsBull'];
    const POOL = 500;   // max_labels_count / max_lines_count de V13.3.3
    const TAM_FORMA = { tiny: 7, small: 9, normal: 11, large: 15 };

    // Las cuatro entradas de la zona manual (V13.3.3). Son datos del usuario, no parámetros del motor.
    const ZONA_INPUTS = [
        { id: 'zoneTop', tipo: 'float', def: 0, titulo: 'Zona TOP', grupo: '📦 ZONA MANUAL (OB / FVG)', step: 0.00001 },
        { id: 'zoneBot', tipo: 'float', def: 0, titulo: 'Zona BOTTOM', grupo: '📦 ZONA MANUAL (OB / FVG)', step: 0.00001 },
        { id: 'zoneIsOB', tipo: 'bool', def: true, titulo: 'Es Order Block? (desmarcar = FVG)', grupo: '📦 ZONA MANUAL (OB / FVG)' },
        { id: 'zoneIsBull', tipo: 'bool', def: true, titulo: '¿Zona ALCISTA? (desmarcar = Bajista)', grupo: '📦 ZONA MANUAL (OB / FVG)' },
    ];

    const col = (c) => (c ? NLTCharts.pine.css({ hex: c[0], t: c[1] }) : 'transparent');

    // ---------------------------------------------------------------- pestaña Estilo
    // Un elemento por cada cosa que V13.3.3 dibuja, con sus colores de Pine como valor por
    // defecto. Lo que el usuario no cambió se pinta con el color que manda el motor (así los
    // colores que dependen del estado o del modo quedan como en TradingView).
    const PC = { lime: '#00E676', red: '#FF5252', yellow: '#FFEB3B', orange: '#FF9800', teal: '#00897B', maroon: '#880E4F',
        aqua: '#00BCD4', fuchsia: '#E040FB', blue: '#2196F3', purple: '#9C27B0', gray: '#787B86', white: '#FFFFFF' };
    const FASES = [['detectado', 'Detectado'], ['armado', 'Armado'], ['confirmado', 'Confirmado'], ['listo', 'Entry ready / usado']];
    const ELEMENTOS = [
        ...FASES.map(([f, t]) => ['caja', `obBull_${f}`, '🧱 Order Block alcista', t, { detectado: PC.teal, armado: PC.orange, confirmado: PC.yellow, listo: PC.lime }[f], 87, 50, 1]),
        ...FASES.map(([f, t]) => ['caja', `obBear_${f}`, '🧱 Order Block bajista', t, { detectado: PC.maroon, armado: PC.orange, confirmado: PC.yellow, listo: PC.red }[f], 87, 50, 1]),
        ...FASES.map(([f, t]) => ['caja', `fvgBull_${f}`, '⚡ FVG alcista', t, { detectado: PC.aqua, armado: PC.orange, confirmado: PC.yellow, listo: PC.lime }[f], 84, 42, 2]),
        ...FASES.map(([f, t]) => ['caja', `fvgBear_${f}`, '⚡ FVG bajista', t, { detectado: PC.fuchsia, armado: PC.orange, confirmado: PC.yellow, listo: PC.red }[f], 84, 42, 2]),
        ['etiqueta', 'fvgUp', '⚡ FVG — etiquetas', 'FVG↑', PC.lime, 60, PC.white, 0],
        ['etiqueta', 'fvgDown', '⚡ FVG — etiquetas', 'FVG↓', PC.red, 60, PC.white, 0],
        ['caja', 'zona_alta', '📦 Zona manual', 'Calidad ≥ 70', PC.lime, 88, 0, 2],
        ['caja', 'zona_media', '📦 Zona manual', 'Calidad 50-69', PC.yellow, 88, 0, 2],
        ['caja', 'zona_baja', '📦 Zona manual', 'Calidad < 50', PC.red, 88, 0, 2],
        ['etiqueta', 'explicacion', '📦 Zona manual', 'Explicación', '#0D0D0D', 15, PC.white, 5],
        ['linea', 'pdh', '📌 Niveles clave', 'PDH', PC.red, 42, 2, 'solid'],
        ['linea', 'pdl', '📌 Niveles clave', 'PDL', PC.lime, 42, 2, 'solid'],
        ['linea', 'pwh', '📌 Niveles clave', 'PWH', PC.red, 72, 1, 'dotted'],
        ['linea', 'pwl', '📌 Niveles clave', 'PWL', PC.lime, 72, 1, 'dotted'],
        ['linea', 'pdMid', '📌 Niveles clave', 'Medio diario', PC.gray, 72, 1, 'dashed'],
        ['etiqueta', 'pdhLabel', '📌 Niveles clave', 'Etiqueta PDH', PC.red, 78, PC.red, 0],
        ['etiqueta', 'pdlLabel', '📌 Niveles clave', 'Etiqueta PDL', PC.lime, 78, PC.lime, 0],
        ['caja', 'ote', '🎯 Zona OTE', 'OTE', PC.purple, 94, 68, 1],
        ['caja', 'asian', '🌏 Rango asiático', 'Caja', PC.blue, 92, 50, 1],
        ['linea', 'asianLine', '🌏 Rango asiático', 'Líneas', PC.blue, 52, 1, 'dotted'],
        ['caja', 'crtBox', '🕯 CRT', 'Caja', PC.yellow, 91, 45, 2],
        ['etiqueta', 'crtLabel', '🕯 CRT', 'Etiqueta', PC.yellow, 55, PC.white, 0],
        ['forma', 'crtUp', '🕯 CRT', 'Flecha alcista', PC.yellow, 10, 'tiny'],
        ['forma', 'crtDown', '🕯 CRT', 'Flecha bajista', PC.yellow, 10, 'tiny'],
        ['linea', 'eqhLine', '💧 Liquidez EQH/EQL', 'Línea EQH', PC.red, 45, 1, 'dashed'],
        ['linea', 'eqlLine', '💧 Liquidez EQH/EQL', 'Línea EQL', PC.lime, 45, 1, 'dashed'],
        ['etiqueta', 'eqhLabel', '💧 Liquidez EQH/EQL', 'Etiqueta EQH', PC.red, 35, PC.white, 0],
        ['etiqueta', 'eqlLabel', '💧 Liquidez EQH/EQL', 'Etiqueta EQL', PC.lime, 35, PC.white, 0],
        ['etiqueta', 'judasUp', '🪤 Judas swing', 'Alcista', PC.purple, 45, PC.white, 0],
        ['etiqueta', 'judasDown', '🪤 Judas swing', 'Bajista', PC.purple, 45, PC.white, 0],
        ['etiqueta', 'swingAlto', '〽️ Swings', 'Máximo (H)', PC.red, 70, PC.white, 0],
        ['etiqueta', 'swingBajo', '〽️ Swings', 'Mínimo (L)', PC.lime, 70, PC.white, 0],
        ['linea', 'srSup', '🧱 Soporte / resistencia', 'Soporte', PC.aqua, 35, 1, 'dotted'],
        ['linea', 'srRes', '🧱 Soporte / resistencia', 'Resistencia', PC.fuchsia, 35, 1, 'dotted'],
        ['etiqueta', 'srSupLabel', '🧱 Soporte / resistencia', 'Etiqueta soporte', PC.aqua, 80, PC.aqua, 0],
        ['etiqueta', 'srResLabel', '🧱 Soporte / resistencia', 'Etiqueta resistencia', PC.fuchsia, 80, PC.fuchsia, 0],
        ['linea', 'fib50', '📐 Fibonacci', '50%', PC.orange, 45, 1, 'dotted'],
        ['linea', 'fib618', '📐 Fibonacci', '61.8%', PC.orange, 25, 1, 'dotted'],
        ['linea', 'fib786', '📐 Fibonacci', '78.6%', PC.orange, 45, 1, 'dotted'],
        ['forma', 'entryLong', '⚔️ Entradas', 'LONG', PC.lime, 0, 'large'],
        ['forma', 'entryShort', '⚔️ Entradas', 'SHORT', PC.red, 0, 'large'],
    ];
    const LINEA_OPC = [{ v: 'solid', t: 'Sólida' }, { v: 'dashed', t: 'Guiones' }, { v: 'dotted', t: 'Puntos' }];
    const TAM_OPC = [{ v: 'tiny', t: 'Muy chico' }, { v: 'small', t: 'Chico' }, { v: 'normal', t: 'Normal' }, { v: 'large', t: 'Grande' }];
    function inputsEstilo() {
        const out = [];
        const add = (e, id, tipo, def, titulo, extra = {}) => out.push({ id: `st_${e[1]}_${id}`, tipo, def, titulo, grupo: e[2], tab: 'Estilo', inline: e[1], recalc: false, ...extra });
        ELEMENTOS.forEach((e) => {
            add(e, 'vis', 'bool', true, e[3]);
            if (e[0] === 'caja') {
                add(e, 'fondo', 'color', { hex: e[4], t: e[5] }, 'Relleno');
                add(e, 'borde', 'color', { hex: e[4], t: e[6] }, 'Borde');
                add(e, 'grosor', 'int', e[7], 'Grosor', { min: 1, max: 4 });
            } else if (e[0] === 'linea') {
                add(e, 'color', 'color', { hex: e[4], t: e[5] }, 'Color');
                add(e, 'grosor', 'int', e[6], 'Grosor', { min: 1, max: 4 });
                add(e, 'tipo', 'string', e[7], 'Tipo', { opciones: LINEA_OPC });
            } else if (e[0] === 'etiqueta') {
                add(e, 'fondo', 'color', { hex: e[4], t: e[5] }, 'Fondo');
                add(e, 'texto', 'color', { hex: e[6], t: e[7] }, 'Texto');
            } else {
                add(e, 'color', 'color', { hex: e[4], t: e[5] }, 'Color');
                add(e, 'tam', 'string', e[6], 'Tamaño', { opciones: TAM_OPC });
            }
        });
        out.push({ id: 'st_panel_escala', tipo: 'string', def: 'normal', titulo: 'Tamaño del texto', grupo: '📊 Panel', tab: 'Estilo', recalc: false,
            opciones: [{ v: 'small', t: 'Chico' }, { v: 'normal', t: 'Normal' }, { v: 'large', t: 'Grande' }] });
        return out;
    }
    const VIS_TF = [
        { id: 'vis_m', tipo: 'bool', def: true, titulo: 'Minutos', grupo: 'Mostrar en', tab: 'Visibilidad', recalc: false },
        { id: 'vis_h', tipo: 'bool', def: true, titulo: 'Horas', grupo: 'Mostrar en', tab: 'Visibilidad', recalc: false },
        { id: 'vis_d', tipo: 'bool', def: true, titulo: 'Días', grupo: 'Mostrar en', tab: 'Visibilidad', recalc: false },
    ];
    // Estilo efectivo de una clave: solo lo que el usuario cambió respecto del default de Pine.
    let estilos = {};
    function armarEstilos(v, defs) {
        estilos = {};
        const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        ELEMENTOS.forEach((e) => {
            const k = e[1], o = {};
            const val = (p) => v[`st_${k}_${p}`];
            const cambio = (p) => val(p) !== undefined && !igual(val(p), defs[`st_${k}_${p}`]);
            if (val('vis') === false) o.oculto = true;
            ['fondo', 'borde', 'color', 'texto'].forEach((p) => { if (cambio(p)) o[p] = [val(p).hex, val(p).t]; });
            if (cambio('grosor')) o.grosor = val('grosor');
            if (cambio('tipo')) o.tipo = val('tipo');
            if (cambio('tam')) o.tam = val('tam');
            if (Object.keys(o).length) estilos[k] = o;
        });
    }

    // ---------------------------------------------------------------- dibujo del indicador
    let dibujo = null;            // última respuesta (lo que V13.3.3 dibuja)
    // Generación del dataset con que se aceptó `dibujo`: si el gráfico pasó a OTRO dataset (vivo <-> histórico,
    // otra fecha, replay), el dibujo viejo no se pinta mientras llega el nuevo (visto 28/09: al saltar de 2025
    // a 2024 las zonas de 2025 quedaban sobre las velas de 2024 hasta que respondía el servidor).
    let dibujoGen = null;
    const dibujoVigente = () => !dibujo || dibujoGen === null || !NLTCharts.market || !NLTCharts.market.generacion
        || dibujoGen === NLTCharts.market.generacion();
    let zeOmitidos = 0;
    let vista = null;             // dibujo ya filtrado por toggles y pool (se rearma solo si cambia algo)
    let visuales = {};            // valores de las entradas visuales
    let registrado = false;
    let tfVisible = null;   // lo fija crear(): pestaña Visibilidad

    // Etiquetas y formas llegan compactas ([x, y, texto, estilo] / [x, estilo] + tabla de estilos).
    function expandir(d) {
        if (d._expandido) return;
        const st = d.styles || [];
        d.labels = d.labels.map(([x, y, t, i]) => { const e = st[i]; return { x, y, t, g: e[1], s: e[2], c: e[3], tc: e[4], z: e[5], a: e[6], k: e[7] }; });
        d.shapes = d.shapes.map(([x, i]) => { const e = st[i]; return { x, g: e[1], f: e[2], loc: e[3], c: e[4], z: e[5], t: e[6], k: e[7] }; });
        d._expandido = true;
    }

    function armarVista() {
        if (!dibujo) { vista = null; return; }
        expandir(dibujo);
        // visible = su toggle de V13.3.3 prendido y no oculto en la pestaña Estilo
        const ve = (o) => (!o.g || visuales[o.g] !== false) && !(estilos[o.k] && estilos[o.k].oculto);
        const pool = (lista) => { const f = lista.filter(ve); return f.length > POOL ? f.slice(f.length - POOL) : f; };
        // lo que el usuario cambió en Estilo reemplaza el color/grosor/tipo que mandó el motor
        const est = (o, mapa) => {
            const e = estilos[o.k];
            if (!e) return o;
            const r = { ...o };
            Object.entries(mapa).forEach(([de, a]) => { if (e[de] !== undefined) r[a] = e[de]; });
            return r;
        };
        vista = {
            boxes: dibujo.boxes.filter(ve).map((o) => est(o, { fondo: 'bg', borde: 'bc', grosor: 'bw' })),
            lines: pool(dibujo.lines).map((o) => est(o, { color: 'c', grosor: 'w', tipo: 's' })),
            labels: pool(dibujo.labels).map((o) => est(o, { fondo: 'c', texto: 'tc' })),
            shapes: dibujo.shapes.filter(ve).map((o) => est(o, { color: 'c', tam: 'z' })),
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
            createTooltipDataSource: ({ indicator }) => ({ name: '⚡ NLT ZONE ENGINE V13.3.3', calcParamsText: '', features: NLTCharts.leyenda.features(indicator), legends: [] }),
            draw: ({ ctx, chart, bounding, xAxis, yAxis }) => {
                if (!vista || (tfVisible && !tfVisible())) return false;
                if (!dibujoVigente()) { zeOmitidos++; return false; }     // de otro dataset: no se dibuja
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

    // ---------------------------------------------------------------- tabla de V13.3.3
    const esc = (t) => NLTCharts.ui.esc(t);
    const br = (t) => esc(t).replace(/\n/g, '<br>');

    function htmlPanel(p, v, minimizado) {
        const exp = !!v.expandPanel, diag = !!v.showContextDiag;
        const filas = p.filas.filter((f) => f.m === 's' || (f.m === 'x' && exp) || (f.m === 'c' && !exp) || (f.m === 'd' && diag));
        const div = (bg) => `<tr class="ze-div" style="background:${col(bg)}"><td>──────────────────</td><td>──────────</td></tr>`;
        return `<table class="ze-tabla${minimizado ? ' ze-min' : ''}">
            <tr class="ze-hdr" data-ze="minimizar" title="Toca para minimizar o expandir" style="background:${col(p.hdr.bg)}">
                <td style="color:${col(p.hdr.lc)}">${esc(p.hdr.l)}</td><td class="ze-v" style="color:${col(p.hdr.c)}">${esc(p.hdr.v)}</td></tr>
            ${div(p.div0)}
            ${filas.map((f) => (f.div ? div(f.bg) :
                `<tr${f.exp ? ' class="ze-exp" data-ze="expandir"' : ''} style="background:${col(f.bg)}"><td class="ze-l" style="color:${col(f.lc)}">${br(f.l)}</td><td class="ze-v ze-${esc(f.z)}" style="color:${col(f.c)}">${br(f.v)}</td></tr>`)).join('')}
        </table>`;
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
        tfVisible = () => visibleEnTf();
        const S = NLTCharts.settings;
        const state = NLTCharts.state;
        S.registrar(ZE, { titulo: '⚡ NLT ZONE ENGINE V13.3.3', inputs: ZONA_INPUTS });
        let catalogo = null;
        let error = '';
        let ver = leerPref();
        let oculto = !!state.prefs().proOculto;
        let dibujado = false;
        let esquema = null;           // entradas de V13.3.3 (solo con acceso)
        let rectId = null, rectVisto = false;
        let previa = null;            // valores mientras el diálogo está abierto
        let timer = null, timerCorto = null, seq = 0;
        const oyentes = [];           // otros indicadores que usan los eventos del motor (NLT AI)
        let fuenteZE = null;          // NLT Bar Replay: el motor calculado en el cursor (servidor)
        let zeDescartados = 0;        // respuestas de otro contexto que no se dibujaron (diagnóstico / tests)
        let nltAi = null;

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
        const defsEstilo = Object.fromEntries(inputsEstilo().map((e) => [e.id, e.def]));
        function actualizarVisuales() {
            const v = valores();
            visuales = {};
            (esquema || []).forEach((e) => { if (e.rol === 'visual') visuales[e.id] = v[e.id]; });
            armarEstilos(v, defsEstilo);
            armarVista();
        }
        // pestaña Visibilidad: ocultar el indicador en las temporalidades desmarcadas
        function visibleEnTf() {
            const tf = String(getTimeframe() || ''), u = tf.slice(-1);
            const clave = u === 'm' ? 'vis_m' : (u === 'H' || u === 'h') ? 'vis_h' : 'vis_d';
            return valores()[clave] !== false;
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

        // Sin esquema no se calcula: las entradas del usuario no viajarían y el motor usaría
        // los valores por defecto. Si el pedido falla (red, 429) se reintenta solo.
        let reintentoEsquema = null, esperaEsquema = 3000;
        async function cargarEsquema() {
            if (esquema || !tieneAcceso()) return;
            try {
                const r = await NLT_API.chartsZoneEngineAjustes();
                esquema = r.inputs;
                S.registrar(ZE, {
                    titulo: `⚡ NLT ZONE ENGINE ${r.version || ''}`.trim(),
                    inputs: [...r.inputs.map((e) => ({
                        id: e.id, tipo: e.tipo, def: e.def, titulo: e.titulo, grupo: e.grupo, min: e.min, max: e.max, step: e.step,
                        opciones: e.opciones, tooltip: e.tooltip,
                        recalc: e.rol === 'visual' ? false : undefined,
                    })), ...inputsEstilo(), ...VIS_TF],
                });
                actualizarVisuales();
                esperaEsquema = 3000;
            } catch (_) {
                clearTimeout(reintentoEsquema);
                reintentoEsquema = setTimeout(() => cargarEsquema().then(() => { if (esquema && ver) programar(100); }), esperaEsquema);
                esperaEsquema = Math.min(esperaEsquema * 2, 30000);
            }
        }

        function mostrarEnGrafico(si) {
            if (si && !dibujado) { chart.createIndicator({ name: 'NLT_PRO_ZONES', paneId: 'candle_pane', visible: !oculto }, true); dibujado = true; }
            if (!si && dibujado) { chart.removeIndicator({ name: 'NLT_PRO_ZONES' }); dibujado = false; dibujo = null; vista = null; }
            pintarTablas();
        }

        // ---- tablas en el tablero compartido (panel arriba a la derecha, NLT AI abajo a la derecha) ----
        let firmaPanel = '';
        function pintarTablas() {
            const v = valores();
            const activo = dibujado && !oculto && dibujo && visibleEnTf() && dibujoVigente();
            NLTCharts.ui.tablero.ajustar(chart);
            if (activo && v.showAIPanel !== false) {
                const g = state.prefs().dashMin;
                const minimizado = Array.isArray(g) ? g.includes('ze') : window.innerWidth < 768;
                const html = htmlPanel(dibujo.panel, v, minimizado).replace('class="ze-tabla', `class="ze-tabla ze-esc-${v.st_panel_escala || 'normal'}`);
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
        }

        // Sin catálogo no se sabe si hay acceso: si falla (token vencido al cargar, red, 429)
        // se reintenta solo, para no dejar sin el Zone Engine a quien lo pagó hasta que recargue.
        let reintentoCatalogo = null, esperaCatalogo = 3000;
        async function cargarCatalogo() {
            clearTimeout(reintentoCatalogo);
            try {
                catalogo = await NLT_API.chartsProCatalogo();
                error = '';
                esperaCatalogo = 3000;
            } catch (err) {
                error = err.message;
                if (!catalogo) {
                    reintentoCatalogo = setTimeout(() => cargarCatalogo().then(() => { if (catalogo && ver) programar(100); }), esperaCatalogo);
                    esperaCatalogo = Math.min(esperaCatalogo * 2, 30000);
                }
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
            if (document.visibilityState !== 'visible') { timer = setTimeout(refrescar, espera()); return; }
            if (!esquema) { await cargarEsquema(); if (!esquema) return; }   // el reintento vuelve a llamar
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
            const gen = NLTCharts.market.generacion ? NLTCharts.market.generacion() : 0;
            try {
                const r = fuenteZE ? await fuenteZE(entradasCalculo(valores()))
                    : await NLT_API.chartsZoneEngine(getSymbol(), getTimeframe(), entradasCalculo(valores()));
                if (n !== seq) return;
                // Contexto: misma generación del dataset (vivo/replay/símbolo/timeframe) y calculado sobre una
                // vela que el gráfico ya tiene (nunca después de la última visible). Si el gráfico avanzó, el
                // dibujo es histórico y válido (anclado por timestamp) y se pide otro para la vela nueva.
                if (NLTCharts.market.generacion && gen !== NLTCharts.market.generacion()) { zeDescartados++; return; }
                const dl = chart.getDataList(), ultTs = dl.length ? dl[dl.length - 1].timestamp : null;
                const calcTs = r.cursor_ts != null ? r.cursor_ts : r.last_candle;
                if (calcTs != null && ultTs != null && calcTs > ultTs) { zeDescartados++; programar(200); return; }
                if (calcTs != null && ultTs != null && calcTs < ultTs) programar(300);
                dibujo = r.drawing;
                dibujoGen = gen;
                actualizarVisuales();
                if (rect && dibujo) dibujos.marcarZona(rect.id, undefined, dibujo.manual_zone || null);
                mostrarEnGrafico(true);
                if (dibujado) chart.setStyles({});
                error = '';
                oyentes.forEach((fn) => fn());
            } catch (err) {
                if (n !== seq) return;
                error = err.message;
                if (err.status === 403) { ver = false; mostrarEnGrafico(false); await cargarCatalogo(); }
            }
            onCambio && onCambio();
            timer = setTimeout(refrescar, espera());
        }
        const programar = (ms) => { clearTimeout(timerCorto); timerCorto = setTimeout(refrescar, ms); };

        // ---- configuración (Entradas de V13.3.3 + Estilo + Visibilidad) ----
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
                    // una sola zona manual por símbolo, como V13.3.3: la anterior se desconecta
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
                        <p class="ch-ind-desc" style="margin-bottom:6px">Zona manual: dibuja un rectángulo y toca <strong>NLT Engine</strong> en su barra, o cargala en la configuración.</p>
                        ${z ? `<p class="ch-ind-desc" style="color:#E5E7EB">${z.esOB ? 'OB' : 'FVG'} ${z.alcista ? 'alcista' : 'bajista'} · ${esc(NLTCharts.drawings.formatear(z.bottom))} – ${esc(NLTCharts.drawings.formatear(z.top))}${rectId ? ' · conectada a un rectángulo' : ''}</p>` : ''}
                        ${m ? `<p class="ch-ind-desc" style="margin-top:4px; color:#E5E7EB">Estado: <strong>${esc(m.status)}</strong> · Setup Quality ${esc(m.quality)}% (${esc(m.grade)}) · ${esc(m.validity)} · ${esc(m.touches)} toques</p>` : ''}
                    </div>`;
            } else if (acc.trial_status === 'NOT_STARTED' && ind.trial) {
                cuerpo = `<button type="button" data-pro-trial class="ch-btn" style="margin-top:6px">Probar ${esc(ind.trial.days)} días gratis</button>`;
            } else if (acc.trial_status === 'EXPIRED') {
                cuerpo = `<p class="ch-ind-desc" style="margin-top:4px">Tu prueba gratis terminó.</p>
                          <a href="charts-plans.html" class="ch-btn" style="margin-top:6px; display:inline-flex">Ver planes del Zone Engine PRO</a>`;
            } else {
                cuerpo = `<a href="charts-plans.html" class="ch-btn" style="margin-top:6px; display:inline-flex">Ver planes del Zone Engine PRO</a>`;
            }
            const fav = favs.includes(ZE);
            const estrella = `<button type="button" class="ch-gear ch-ind-star${fav ? ' on' : ''}" data-fav-ind="${ZE}" title="${fav ? 'Quitar de favoritos' : 'Agregar a favoritos'}" aria-label="Favorito NLT Zone Engine"><i class="${fav ? 'ph-fill' : 'ph'} ph-star"></i></button>`;
            return `<div class="ch-pro" data-pro-card="${ZE}"><div class="ch-pro-head"><span class="ch-ind-name">${esc(ind.name)}</span><span style="display:flex; align-items:center; gap:4px">${estrella}${acc.has_access ? '<button type="button" class="ch-gear" data-pro-gear title="Configuración" aria-label="Configuración del Zone Engine"><i class="ph ph-gear-six"></i></button>' : '<span class="ch-lock">PRO</span>'}</span></div>
                    <p class="ch-ind-desc">${esc(ind.description)}</p>${cuerpo}</div>`;
        }

        function seccionProximamente(ind) {
            const extra = ind.access && ind.access.free_analyses_left != null
                ? ` · ${esc(ind.access.free_analyses_left)} análisis gratis cuando esté disponible` : '';
            return `<div class="ch-pro"><div class="ch-pro-head"><span class="ch-ind-name">${esc(ind.name)}</span><span class="ch-lock">PRÓXIMAMENTE</span></div>
                    <p class="ch-ind-desc">${esc(ind.description)}${extra}</p></div>`;
        }

        let favs = [];
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ver) programar(200); });

        return {
            iniciar() { return cargarCatalogo().then(refrescar); },
            refrescar,
            // filtro: texto del buscador de indicadores; favoritos: ids marcados con ⭐ (también PRO).
            renderSeccion(el, filtro = '', favoritos = []) {
                favs = favoritos;
                if (!catalogo) {
                    el.innerHTML = `<p class="ch-grupo">PRO</p><p class="ch-ind-desc" style="padding:0 8px">${error ? esc(error) : 'Cargando...'}</p>`;
                    return;
                }
                const q = filtro.trim().toLowerCase();
                const nombre = (ind) => (ind.id === 'NLT_INDICATOR_AI' ? 'NLT AI ' : '') + ind.name;
                const lista = catalogo.indicators.filter((ind) => !q || [nombre(ind), ind.description || '', ind.id].some((t) => t.toLowerCase().includes(q)));
                el.innerHTML = (lista.length ? '<p class="ch-grupo">PRO</p>' : '') + lista.map((ind) =>
                    ind.id === ZE && ind.status === 'available' ? seccionZoneEngine(ind)
                        : ind.id === 'NLT_INDICATOR_AI' && nltAi ? nltAi.htmlSeccion(ind, favs.includes(ind.id))
                            : seccionProximamente(ind)).join('') +
                    (error ? `<p class="ch-ind-desc" style="color:rgb(248,113,113); padding:0 8px">${esc(error)}</p>` : '');
                if (nltAi) nltAi.enlazar(el);

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
            // Para NLT AI (otro indicador que usa los eventos de este motor).
            conNltAi(api) { nltAi = api; },
            alRefrescar(fn) { oyentes.push(fn); },
            entradasActuales: () => entradasCalculo(valores()),
            zonaActual: () => zonaDe(getSymbol()),
            // ⭐ Favoritos del panel de indicadores
            visible: () => ver,
            alternar(si) { ver = !!si; guardarPref(ver); refrescar(); onCambio && onCambio(); },
            catalogoCargado: () => catalogo,
            vistaActual: () => vista,
            dibujoActual: () => (dibujoVigente() ? dibujo : null),
            dibujosOmitidos: () => zeOmitidos,
            descartados: () => zeDescartados,   // diagnóstico: lo que se está dibujando (ya filtrado y con estilos)
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
            // NLT Bar Replay: fn(entradas) -> {drawing} en el cursor; null vuelve al vivo
            fijarFuente(fn) { fuenteZE = fn || null; seq++; dibujo = null; vista = null; if (dibujado) chart.setStyles({}); pintarTablas(); if (ver) programar(100); },
            // Los dibujos del símbolo ya están en pantalla: buscar el rectángulo conectado.
            dibujosRestaurados() { if (ver) programar(150); },
            // Al cambiar de símbolo: cada símbolo tiene su zona y sus rectángulos.
            cambioDeSimbolo() { seq++; rectId = null; rectVisto = false; dibujo = null; vista = null; pintarTablas(); programar(600); },
            // Otra temporalidad: las zonas de la anterior no valen; un solo cálculo cuando llegan las velas nuevas.
            cambioDeTimeframe() { seq++; dibujo = null; vista = null; if (dibujado) chart.setStyles({}); pintarTablas(); programar(600); },
        };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.pro = { crear };
})();
