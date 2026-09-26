/* NLT Charts -- sección PRO del panel, panel del Zone Engine y dibujo de sus zonas.
 *
 * Este archivo NO decide acceso ni calcula zonas. Muestra lo que dice el
 * backend (/charts/pro/catalog) y dibuja los resultados que devuelve
 * /charts/pro/zone-engine. Si alguien modifica este JS para "encender" el
 * PRO sin permiso, el backend responde 403 y no hay nada que dibujar.
 *
 * La configuración completa del Zone Engine (todas las entradas de V13.4,
 * con sus grupos, valores por defecto y ayudas) la da el backend SOLO a
 * quien tiene acceso: acá no hay parámetros del motor.
 *
 * Zona manual (como "📦 ZONA MANUAL" de V13.4): una por símbolo. Se define
 * en la configuración o conectando un rectángulo ("NLT Engine" en la barra
 * del dibujo); las dos cosas quedan sincronizadas. Se re-analiza al mover el
 * rectángulo, al cambiar la configuración y con cada vela nueva. */
(function () {
    const ZE = 'NLT_ZONE_ENGINE';
    const REFRESCO_MS = 30000;
    const PREF = 'nlt_charts_pro_ver_v1';
    const FUENTE = 'Inter, system-ui, sans-serif';
    const ZONA_IDS = ['zoneTop', 'zoneBot', 'zoneIsOB', 'zoneIsBull'];

    // Las cuatro entradas de la zona manual (grupo "📦 ZONA MANUAL (precios)" de V13.4).
    // Son datos del usuario (su zona), no permisos ni parámetros del motor.
    const ZONA_INPUTS = [
        { id: 'zoneTop', tipo: 'float', def: 0, titulo: 'Zona TOP', grupo: '📦 ZONA MANUAL (precios)', step: 0.00001, min: 0 },
        { id: 'zoneBot', tipo: 'float', def: 0, titulo: 'Zona BOTTOM', grupo: '📦 ZONA MANUAL (precios)', step: 0.00001, min: 0 },
        { id: 'zoneIsOB', tipo: 'bool', def: true, titulo: 'Tipo de zona: Order Block  (desmarcar = FVG)', grupo: '🌐 NLT AI (webhook)' },
        { id: 'zoneIsBull', tipo: 'bool', def: true, titulo: 'Dirección: ALCISTA / LONG  (desmarcar = Bajista / SHORT)', grupo: '🌐 NLT AI (webhook)' },
    ];

    // ---------------------------------------------------------------- dibujo de zonas
    let zonas = [];            // última respuesta del backend (solo para dibujar)
    let zonaSinRect = null;    // zona manual definida solo en la configuración: { top, bottom, estado }
    let visibles = { ob: true, fvg: true };
    let registrado = false;
    // Colores de estado de la zona manual = v12StatusColor de V13.4 (L2739-2742)
    const COLOR_ESTADO = { 'ARMED': '0,212,255', 'IN ZONE': '255,235,59', 'MITIGATED': '0,230,118', 'INVALIDATED': '255,82,82' };

    function registrar() {
        if (registrado) return;
        registrado = true;
        klinecharts.registerIndicator({
            name: 'NLT_PRO_ZONES',
            shortName: 'Zone Engine PRO',
            figures: [],
            calc: (dataList) => dataList.map(() => ({})),
            createTooltipDataSource: ({ indicator }) => ({ name: 'NLT Zone Engine', calcParamsText: '', features: NLTCharts.leyenda.features(indicator), legends: [] }),
            draw: ({ ctx, chart, bounding }) => {
                const ancho = bounding.width;
                ctx.save();
                ctx.font = `600 10px ${FUENTE}`;
                ctx.textBaseline = 'top';
                zonas.forEach((z) => {
                    if (!visibles[z.kind]) return;
                    const a = chart.convertToPixel({ timestamp: z.from, value: z.top });
                    const b = chart.convertToPixel({ timestamp: z.until || z.created, value: z.bottom });
                    if (a.x == null || a.y == null || b.y == null) return;
                    const x0 = a.x, x1 = z.until ? b.x : ancho;
                    if (x1 < 0 || x0 > ancho) return;
                    const activa = z.state === 'active';
                    const rgb = z.kind === 'ob' ? (z.dir === 'bull' ? '34,197,94' : '239,68,68') : (z.dir === 'bull' ? '45,212,191' : '251,146,60');
                    const top = Math.min(a.y, b.y), h = Math.max(1, Math.abs(b.y - a.y));
                    ctx.fillStyle = `rgba(${rgb},${activa ? 0.14 : 0.05})`;
                    ctx.fillRect(x0, top, x1 - x0, h);
                    ctx.setLineDash(activa ? [] : [4, 3]);
                    ctx.strokeStyle = `rgba(${rgb},${activa ? 0.8 : 0.35})`;
                    ctx.strokeRect(x0 + 0.5, top + 0.5, x1 - x0 - 1, h - 1);
                    if (h >= 10 && x1 - x0 > 30) {
                        ctx.fillStyle = `rgba(${rgb},${activa ? 0.95 : 0.5})`;
                        const estado = activa ? '' : z.state === 'invalidated' ? ' ✕ invalidada' : ' · reemplazada';
                        ctx.fillText(`${z.kind.toUpperCase()}${estado}`, Math.max(x0, 0) + 3, top + 2);
                    }
                });
                // Zona manual definida solo en la configuración (sin rectángulo): franja a todo el ancho.
                if (zonaSinRect) {
                    const yA = chart.convertToPixel({ value: zonaSinRect.top }).y, yB = chart.convertToPixel({ value: zonaSinRect.bottom }).y;
                    if (yA != null && yB != null) {
                        const rgb = COLOR_ESTADO[zonaSinRect.estado] || '59,130,246';
                        const top = Math.min(yA, yB), h = Math.max(1, Math.abs(yB - yA));
                        ctx.setLineDash([]);
                        ctx.fillStyle = `rgba(${rgb},0.10)`;
                        ctx.fillRect(0, top, ancho, h);
                        ctx.strokeStyle = `rgba(${rgb},0.85)`;
                        ctx.lineWidth = 1.5;
                        ctx.strokeRect(0.5, top + 0.5, ancho - 1, h - 1);
                        ctx.fillStyle = `rgba(${rgb},1)`;
                        ctx.fillText(`ZONA MANUAL · ${zonaSinRect.estado || 'analizando…'}`, 6, top + 3);
                    }
                }
                ctx.restore();
                return false;
            },
        });
    }

    // ---------------------------------------------------------------- panel V13.4
    // Mismas filas, textos y colores que la tabla de V13.4 (L3138-3322). Lo que depende de
    // la etapa 2 (probabilidad, confluencias, S/R, Fibonacci...) se muestra como "Etapa 2".
    const C = {
        lime: '#00E676', red: '#FF5252', yellow: '#FFEB3B', orange: '#FF9800', gray: '#787B86',
        blue: 'rgb(59,130,246)', gris: 'rgba(229,231,235,', rowA: 'rgba(13,17,23,.55)', rowB: 'rgba(31,41,55,.45)',
        hdr: 'rgba(31,41,55,.9)', sec: 'rgba(31,41,55,.65)',
    };
    const ETAPA2 = '<span class="ze-e2" title="Existe en V13.4; llega a NLT Charts en la etapa 2 del port (confluencias)">Etapa 2</span>';
    // f_wrap(txt, 16) de V13.4: corta en espacios en líneas de hasta 16 caracteres
    function envolver(txt, max = 16) {
        const esc = NLTCharts.ui.esc;
        if (txt.length <= max) return esc(txt);
        const out = [];
        let linea = '';
        txt.split(' ').filter(Boolean).forEach((w) => {
            const cand = linea ? `${linea} ${w}` : w;
            if (cand.length > max && linea) { out.push(linea); linea = w; } else linea = cand;
        });
        if (linea) out.push(linea);
        return out.map(esc).join('<br>');
    }

    function htmlPanel({ panel, manual, zonaValida, zona, simbolo, vals, minimizado }) {
        const esc = NLTCharts.ui.esc;
        const neon = zonaValida ? C.blue : 'rgb(255,51,51)';   // v12Neon: sin zona el score es 0 (rojo); con zona depende de la calidad (etapa 2)
        const exp = !!vals.expandPanel;
        const filas = [];
        const fila = (lbl, val, bg, color, tam = 's', crudo = false) =>
            filas.push(`<tr style="background:${bg}"><td class="ze-l">${lbl}</td><td class="ze-v ze-${tam}" style="color:${color}">${crudo ? val : envolver(val)}</td></tr>`);
        const div = () => filas.push(`<tr class="ze-div" style="background:${neon.replace('rgb', 'rgba').replace(')', ',.15)')}"><td colspan="2"></td></tr>`);
        const p = panel || {};
        const sesgo = (s) => (s === 'LONG' ? ['LONG 🟢', C.lime] : s === 'SHORT' ? ['SHORT 🔴', C.red] : ['NEUTRAL ⚪', C.yellow]);
        const macro = (s) => (s === 'LONG' ? ['LONG', C.lime] : s === 'SHORT' ? ['SHORT', C.red] : ['NEUTRAL', C.yellow]);
        const zonaLider = (z) => (!z ? '—' : `${z.kind} ${z.state}`);
        const colLider = (z) => (!z ? `${C.gris}.7)` : z.state === 'DETECTED' ? `${C.gris}.7)` : `${C.gris}.7)`);   // L3292: solo ENTRY_READY/CONFIRMED/ARMED tienen color (etapa 2)
        const estado = zonaValida && manual ? manual.status : null;
        const emoji = { 'ARMED': '🔵', 'IN ZONE': '🟡', 'MITIGATED': '✅', 'INVALIDATED': '❌' };

        fila('🧠  AI SCORE', ETAPA2, C.rowA, neon, 'n', true);
        const [bTxt, bCol] = sesgo(p.op_bias);
        fila('📍  OPERATIVE BIAS', bTxt, C.rowB, bCol, 'n');
        if (exp) {
            fila('⚡  SIGNAL', ETAPA2, C.rowA, C.gray, 's', true);
            fila('  ZONE QUALITY', ETAPA2, C.rowB, C.gray, 'n', true);
            div();
        }
        fila('📊  SETUP QUALITY', zonaValida ? ETAPA2 : '—', C.sec, neon, 'g', zonaValida);
        if (exp) {
            fila('🏆  GRADE', zonaValida ? ETAPA2 : '—', C.rowA, C.gray, 'g', zonaValida);
            fila('⚡  EXP.REACTION', zonaValida ? ETAPA2 : '—', C.sec, C.gray, 'n', zonaValida);
            fila('🎯  ZONE STATUS', estado ? `${emoji[estado] || ''} ${estado}` : (zonaValida ? 'analizando…' : '⚫ NO ZONE'), C.rowB,
                estado ? `rgb(${COLOR_ESTADO[estado]})` : C.red);
            div();
            fila('📦  ZONE TYPE', zonaValida ? `${zona.esOB ? 'OB' : 'FVG'} ${zona.alcista ? 'BULL' : 'BEAR'}` : '—', C.rowA, zona && zona.alcista ? C.lime : C.red);
            fila('🔒  FROZEN AT', '—', C.rowB, `${C.gris}.75)`);   // L3223: en TradingView la zona se fija en la vela 0 -> "—"
            const pie = `${p.session || 'OFF'} · ${p.structure || 'RANGING'} · ?/7 ✦`;
            filas.push(`<tr style="background:${C.rowA}"><td class="ze-l" style="color:${C.gris}.55)" title="Sesión · estructura · confluencias (etapa 2)">${envolver(pie)}</td><td class="ze-v ze-s" style="color:${p.session_active ? C.lime : C.gray}">${p.session_active ? '● LIVE' : '○ OFF'}</td></tr>`);
            fila('🌐  ASSET', simbolo, C.rowB, `${C.gris}.85)`);
            fila('🔴  MODO', p.mode === 'MALVADO' ? 'MALVADO 👹' : 'NORMAL ⚡', C.rowA, p.mode === 'MALVADO' ? C.red : C.blue);
            fila('🧱  SOPORTE', ETAPA2, C.rowB, C.gray, 's', true);
            fila('🧱  RESISTENCIA', ETAPA2, C.rowA, C.gray, 's', true);
            fila('📐  FIBONACCI', ETAPA2, C.rowB, C.gray, 's', true);
            fila('🔎  VERIFICATION', zonaValida ? ETAPA2 : '—', C.rowA, `${C.gris}.8)`, 's', zonaValida);
            fila('✅  ZONE VALIDITY', zonaValida ? ETAPA2 : '—', C.rowB, `${C.gris}.8)`, 's', zonaValida);
            fila('🌊  FLOW (proxy)', 'OFF (proxy)', C.rowA, `${C.gris}.55)`);
            const [mTxt, mCol] = macro(p.htf_bias);
            fila('🔭  MACRO BIAS', mTxt, C.rowB, mCol);
        }
        const entrada = p.entry_status || 'NO TRADE';
        fila('🎯  ENTRY STATUS', entrada, C.rowA, entrada === 'WAIT (detectado)' ? 'rgba(255,152,0,.85)' : C.gray);
        if (vals.showContextDiag) {
            fila('🔬  CTX LONG', ETAPA2, C.rowB, C.orange, 't', true);
            fila('🔬  CTX SHORT', ETAPA2, C.rowA, C.orange, 't', true);
        }
        if (exp) {
            fila('📦  ZONA LONG', zonaLider(p.long_zone), C.rowB, colLider(p.long_zone));
            fila('📦  ZONA SHORT', zonaLider(p.short_zone), C.rowA, colLider(p.short_zone));
        }
        const hayBias = p.op_bias === 'LONG' || p.op_bias === 'SHORT';
        fila('❓  FALTA', hayBias ? ETAPA2 : '—', C.rowB, `${C.gris}.85)`, 't', hayBias);
        const motivo = p.invalid_reason || '—';
        fila('🚫  MOTIVO INVALIDEZ', motivo, C.rowA, motivo === '—' ? `${C.gris}.6)` : C.orange, 't');
        if (!exp) filas.push(`<tr class="ze-exp" data-ze="expandir" style="background:${p.mode === 'MALVADO' ? 'rgba(255,82,82,.6)' : 'rgba(59,130,246,.6)'}"><td class="ze-l" style="color:#fff">🔍  EXPANDIR PANEL</td><td class="ze-v ze-s" style="color:#fff">⚙️  Configuración</td></tr>`);

        return `<table class="ze-tabla${minimizado ? ' ze-min' : ''}">
            <tr class="ze-hdr" data-ze="minimizar" title="Tocá para minimizar o expandir" style="background:${C.hdr}"><td style="color:${neon}">  NLT  ZONE  ENGINE</td><td class="ze-v" style="color:${neon.replace('rgb', 'rgba').replace(')', ',.35)')}">V13.3.3</td></tr>
            <tr class="ze-div" style="background:${neon.replace('rgb', 'rgba').replace(')', ',.15)')}"><td colspan="2"></td></tr>
            ${filas.join('')}
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
        const S = NLTCharts.settings;
        const state = NLTCharts.state;
        S.registrar(ZE, { titulo: 'NLT Zone Engine V13.4', inputs: ZONA_INPUTS });
        const esc = NLTCharts.ui.esc;
        let catalogo = null;
        let error = '';
        let ver = leerPref();
        let oculto = !!state.prefs().proOculto;
        let dibujado = false;
        let esquemaServidor = null;   // entradas de V13.4 (solo con acceso)
        let respuesta = null;         // última respuesta: { panel, manual_zone }
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
        // Entradas que cambian el cálculo -> se mandan al servidor con el nombre que él indicó.
        function paramsPara(v) {
            if (!esquemaServidor) return null;
            const out = {};
            esquemaServidor.filter((e) => e.rol === 'param').forEach((e) => { if (v[e.id] !== undefined) out[e.param] = v[e.id]; });
            return out;
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
            if (esquemaServidor || !tieneAcceso()) return;
            try {
                const r = await NLT_API.chartsZoneEngineAjustes();
                esquemaServidor = r.inputs;
                S.registrar(ZE, {
                    titulo: `NLT Zone Engine ${r.version || ''}`.trim(),
                    inputs: r.inputs.map((e) => ({
                        id: e.id, tipo: e.tipo, def: e.def, titulo: e.titulo, grupo: e.grupo, min: e.min, max: e.max, step: e.step,
                        opciones: e.opciones, tooltip: e.tooltip, etapa2: e.rol === 'etapa2', recalc: e.rol === 'visual' ? false : undefined,
                    })),
                });
            } catch (_) { /* sin esquema: solo la zona manual */ }
        }

        function mostrarEnGrafico(si) {
            if (si && !dibujado) { chart.createIndicator({ name: 'NLT_PRO_ZONES', paneId: 'candle_pane', visible: !oculto }, true); dibujado = true; }
            if (!si && dibujado) { chart.removeIndicator({ name: 'NLT_PRO_ZONES' }); dibujado = false; zonas = []; zonaSinRect = null; }
            pintarPanel();
        }

        // ---- panel (tabla V13.4) en el tablero compartido ----
        let firmaPanel = '';
        function pintarPanel() {
            const v = valores();
            const mostrar = dibujado && !oculto && v.showAIPanel !== false && respuesta;
            if (!mostrar) { NLTCharts.ui.tablero.quitar('ze'); firmaPanel = ''; return; }
            NLTCharts.ui.tablero.ajustar(chart);
            const z = zonaDeValores(v);
            const guardado = state.prefs().dashMin;
            // en celular arranca minimizado (como los tableros de la Suite)
            const minimizado = Array.isArray(guardado) ? guardado.includes('ze') : window.innerWidth < 768;
            const html = htmlPanel({ panel: respuesta.panel, manual: respuesta.manual_zone, zonaValida: !!z, zona: z, simbolo: getSymbol(), vals: v, minimizado });
            if (html === firmaPanel) return;
            firmaPanel = html;
            const el = NLTCharts.ui.tablero.slot('Top Right', 'ze');
            if (!el) return;
            if (!el.dataset.oyente) {
                el.dataset.oyente = '1';
                el.addEventListener('click', (ev) => {
                    const acc = ev.target.closest('[data-ze]');
                    if (!acc) return;
                    // En Pine esta fila es solo un aviso (no hay clicks); acá expande de verdad.
                    if (acc.dataset.ze === 'expandir') { S.guardar(ZE, { ...S.valores(ZE), expandPanel: true }); pintarPanel(); return; }
                    const g = state.prefs().dashMin;
                    const mins = new Set(Array.isArray(g) ? g : (window.innerWidth < 768 ? ['sr', 'ict', 'ze'] : []));
                    mins.has('ze') ? mins.delete('ze') : mins.add('ze');
                    state.savePrefs({ dashMin: [...mins] });
                    pintarPanel();
                });
            }
            el.innerHTML = `<div class="ud-dash ze-panel">${html}</div>`;
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

        // Aplica lo visual sin pedir nada al servidor (mostrar OB/FVG, panel).
        function aplicarVisual() {
            const v = valores();
            visibles = { ob: v.showOB !== false, fvg: v.showAutoFVG !== false };
            if (dibujado) chart.setStyles({});   // redibujar sin recalcular
            pintarPanel();
        }

        // Pedido al servidor. `seq` descarta respuestas viejas (llegaron después de un pedido más nuevo).
        async function refrescar() {
            clearTimeout(timer); clearTimeout(timerCorto);
            if (!ver || !tieneAcceso()) { mostrarEnGrafico(false); return; }
            if (document.visibilityState !== 'visible') { timer = setTimeout(refrescar, REFRESCO_MS); return; }
            const rect = resolverRect();
            const v = valores();
            if (rect && !previa) {
                // el rectángulo manda sobre los precios de la zona (el usuario lo movió)
                const zr = dibujos.rectanguloComoZona(rect.id);
                const actual = zonaDe(getSymbol());
                if (zr && (!actual || actual.top !== zr.top || actual.bottom !== zr.bottom)) {
                    guardarZona(getSymbol(), { top: zr.top, bottom: zr.bottom, esOB: rect.extendData.zonaNLT.esOB, alcista: rect.extendData.zonaNLT.alcista });
                }
            }
            const vv = valores();
            const z = zonaDeValores(vv);
            const desde = rect ? (dibujos.rectanguloComoZona(rect.id) || {}).desde : null;
            const n = ++seq;
            try {
                const r = await NLT_API.chartsZoneEngine(getSymbol(), getTimeframe(), z ? { ...z, desde } : null, paramsPara(v));
                if (n !== seq) return;
                zonas = r.zones || [];
                respuesta = { panel: r.panel, manual_zone: r.manual_zone };
                zonaSinRect = z && !rect ? { top: z.top, bottom: z.bottom, estado: r.manual_zone ? r.manual_zone.status : null } : null;
                if (rect && z) dibujos.marcarZona(rect.id, undefined, r.manual_zone || null);
                mostrarEnGrafico(true);
                aplicarVisual();
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

        // ---- configuración (todas las entradas de V13.4) ----
        function abrirAjustes(tab) {
            const e = S.esquema(ZE);
            const original = valores();
            const cambioZona = (cambiados) => cambiados.some((c) => ZONA_IDS.includes(c));
            NLTCharts.settings.abrirDialogo({
                titulo: e.titulo,
                inputs: e.inputs,
                valores: original,
                tab,
                alCambiar: (vals, cambiados) => {
                    previa = { ...vals };
                    if (S.exigeRecalculo(ZE, cambiados) || cambioZona(cambiados)) programar(250); else aplicarVisual();
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
                    refrescar();
                },
                alCancelar: () => { previa = null; refrescar(); },
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
                botones: conectada ? [{ id: 'desconectar', texto: 'Desconectar del motor', accion: () => { NLTCharts.settings.cerrar && NLTCharts.settings.cerrar(); desconectar(id); } }] : [],
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
                const m = respuesta && respuesta.manual_zone;
                const z = zonaDe(getSymbol());
                cuerpo = `
                    <label class="ch-ind" style="padding-left:0">
                        <input type="checkbox" data-pro-ver${ver ? ' checked' : ''}>
                        <span><span class="ch-ind-name block">Mostrar en el gráfico</span><span class="ch-ind-desc">${origen}</span></span>
                    </label>
                    <div class="ch-pro-manual">
                        <p class="ch-ind-desc" style="margin-bottom:6px">Zona manual: dibujá un rectángulo y tocá <strong>NLT Engine</strong> en su barra, o cargala en la configuración.</p>
                        ${z ? `<p class="ch-ind-desc" style="color:#E5E7EB">${z.esOB ? 'OB' : 'FVG'} ${z.alcista ? 'alcista' : 'bajista'} · ${esc(NLTCharts.drawings.formatear(z.bottom))} – ${esc(NLTCharts.drawings.formatear(z.top))}${rectId ? ' · conectada a un rectángulo' : ''}</p>` : ''}
                        ${m ? `<p class="ch-ind-desc" style="margin-top:4px; color:#E5E7EB">Estado: <strong>${esc(m.status)}</strong> · ${esc(m.touches)} toques${m.in_zone ? ' · precio en la zona' : m.near ? ' · precio cerca' : ''}${m.inverse_fvg ? ' · FVG invertido' : ''}</p>` : ''}
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

        const api = {
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
            // ojo de la leyenda: oculta zonas y panel sin quitar el indicador
            alternarVisible() {
                oculto = !oculto;
                state.savePrefs({ proOculto: oculto });
                if (dibujado) chart.overrideIndicator({ name: 'NLT_PRO_ZONES', visible: !oculto });
                pintarPanel();
            },
            conectarZona,
            // Rectángulo conectado movido/estirado: re-analizar (agrupado).
            zonaMovida(id) { if (!rectId || id === rectId) programar(400); },
            velaNueva() { if (ver && dibujado) programar(300); },
            // Los dibujos del símbolo ya están en pantalla: buscar el rectángulo conectado.
            dibujosRestaurados() { if (ver) programar(150); },
            // Al cambiar de símbolo: cada símbolo tiene su zona y sus rectángulos.
            cambioDeSimbolo() { rectId = null; rectVisto = false; respuesta = null; zonas = []; zonaSinRect = null; pintarPanel(); programar(600); },
        };
        return api;
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.pro = { crear };
})();
