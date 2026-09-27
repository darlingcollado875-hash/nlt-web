/* NLT Unified Suite (FREE, indicador por defecto de NLT Charts).
 *
 * Port a JavaScript de indicator/NLT_UNIFIED_SUITE.pine, bloque por bloque
 * y en el mismo orden de ejecución, con las mismas entradas (título, grupo,
 * inline, valor por defecto) para que se configure igual que en TradingView:
 *   ① Soporte & Resistencia  ② BOS & CHoCH  ③ ICT Pro  ④ SMC Market Bias
 *
 * Diferencias conocidas con el .pine (limitaciones de NLT Charts V1, no de
 * lógica): las alertas no están disponibles todavía; los timeframes HTF se
 * limitan a los que tiene el proveedor de precios (sin 2H ni semanal); la
 * historia disponible es la que carga el gráfico, no la de TradingView. */
(function () {
    const P = NLTCharts.pine;
    const ID = 'NLT_UNIFIED';

    const C = {
        BULL: '#26A69A', BEAR: '#EF5350', WHITE: '#FFFFFF', GOLD: '#FFD700', PURPLE: '#9C27B0', CYAN: '#00BCD4',
    };
    const TF_PINE = [
        { v: '1', t: '1 minuto' }, { v: '5', t: '5 minutos' }, { v: '15', t: '15 minutos' }, { v: '30', t: '30 minutos' },
        { v: '60', t: '1 hora' }, { v: '240', t: '4 horas' }, { v: 'D', t: '1 día' },
    ];
    const TF_A_NLT = { '1': '1m', '5': '5m', '15': '15m', '30': '30m', '60': '1H', '240': '4H', 'D': '1D' };
    const HTF_OPC = ['5 Mins', '15 Mins', '30 Mins', '1 Hour', '4 Hours', '1 Day'];
    const HTF_A_NLT = { '5 Mins': '5m', '15 Mins': '15m', '30 Mins': '30m', '1 Hour': '1H', '4 Hours': '4H', '1 Day': '1D' };
    const POS4 = ['Bottom Left', 'Bottom Right', 'Top Left', 'Top Right'];

    // ─────────────────────────────── entradas (mismas que el .pine) ───────────────────────────────
    const G0 = '🔘 MÓDULOS ACTIVOS';
    const G1C = '① S/R — Cálculo', G1H = '① S/R — Hybrid Logic', G1V = '① S/R — Visuales';
    const G2 = '② BOS & CHoCH — General';
    const G3S = '③ ICT Pro — Sesiones', G3G = '③ ICT Pro — General', G3OB = '③ ICT Pro — Order Blocks',
        G3F = '③ ICT Pro — Fair Value Gaps', G3L = '③ ICT Pro — Liquidez', G3H = '③ ICT Pro — HTF Fair Value Gaps', G3D = '③ ICT Pro — Dashboard';
    const G4S = '④ SMC Bias — Estructura (Price Action)', G4T = '④ SMC Bias — Temporalidades HTF',
        G4D = '④ SMC Bias — Modo Debug (Estructura Visual)', G4U = '④ SMC Bias — Diseño (Dark Luxury)';
    const b = (id, def, titulo, grupo, inline, tooltip) => ({ id, tipo: 'bool', def, titulo, grupo, inline, tooltip });
    const n = (id, tipo, def, titulo, grupo, extra = {}) => ({ id, tipo, def, titulo, grupo, ...extra });
    const c = (id, hex, t, titulo, grupo, inline) => ({ id, tipo: 'color', def: P.col(hex, t), titulo, grupo, inline });
    const s = (id, def, titulo, grupo, opciones, extra = {}) => ({ id, tipo: 'string', def, titulo, grupo, opciones, ...extra });

    const INPUTS = [
        b('m1_on', true, '① Soporte & Resistencia', G0), b('m2_on', true, '② BOS & CHoCH', G0),
        b('m3_on', true, '③ ICT Pro (OB · FVG · Sesiones · Liquidez)', G0), b('m4_on', true, '④ SMC Market Bias (Multi-Timeframe)', G0),

        n('srp_pivotLookback', 'int', 10, 'Pivot Lookback', G1C, { min: 1 }),
        s('srp_zoneWidthMode', 'ATR', 'Zone Width Mode', G1C, ['ATR', 'Fixed %']),
        n('srp_atrLength', 'int', 14, 'Longitud ATR', G1C, { min: 1 }),
        n('srp_zoneWidthMult', 'float', 0.3, 'Zone Width Multiplier', G1C, { step: 0.05 }),
        n('srp_maxZoneWidth', 'float', 0.8, 'Max Individual Zone Width', G1C, { step: 0.1 }),
        n('srp_minTests', 'int', 2, 'Minimum Tests to Highlight', G1C, { min: 1 }),
        n('srp_strongTests', 'int', 3, 'Strong Zone Tests', G1C, { min: 1 }),
        n('srp_maxZonesPerType', 'int', 6, 'Max Zones Per Type', G1C, { min: 1, max: 20 }),
        n('srp_mergeThreshold', 'float', 0.25, 'Merge / Proximity Threshold', G1H, { step: 0.05 }),
        n('srp_minBarsBetween', 'int', 8, 'Min Bars Between Real Tests', G1H, { min: 1 }),
        n('srp_breakBufferMult', 'float', 0.25, 'Break Buffer Multiplier', G1H, { step: 0.05 }),
        n('srp_breakCloses', 'int', 2, 'Break Confirmation Closes', G1H, { min: 1 }),
        b('srp_keepBroken', true, 'Keep Broken Zones', G1H),
        n('srp_maxBrokenAge', 'int', 150, 'Max Broken Zone Age', G1H, { min: 1 }),
        c('srp_colorSupport', '#00B5AD', 75, 'Support Color', G1V),
        c('srp_colorResistance', '#FF4D4D', 75, 'Resistance Color', G1V),
        c('srp_colorBroken', '#6A707C', 85, 'Broken Zone Color', G1V),
        b('srp_showLabels', true, 'Show Zone Labels', G1V), b('srp_showPrice', true, 'Show Price In Label', G1V),
        b('srp_extendRight', true, 'Extend Zones to Right', G1V), b('srp_showDashboard', true, 'Show Dashboard', G1V),
        s('srp_dashPositionIn', 'Bottom Left', 'Dashboard Position', G1V, POS4),

        n('bos_length', 'int', 5, 'Pivot Length', G2, { min: 1 }),
        b('bos_showLabels', true, 'Show Labels', G2),
        c('bos_colBull', '#089981', 0, 'Bullish Color', G2), c('bos_colBear', '#F23645', 0, 'Bearish Color', G2),

        b('i_showSOD', true, 'Start of Day', G3S, 's1'), { id: 'i_sodTime', tipo: 'session', def: '0000-0001', titulo: '', grupo: G3S, inline: 's1' },
        c('i_sodCol', '#2962FF', 88, '', G3S, 's1'),
        b('i_showLon', true, 'London', G3S, 's2'), { id: 'i_lonTime', tipo: 'session', def: '0300-0500', titulo: '', grupo: G3S, inline: 's2' },
        c('i_lonCol', '#4CAF50', 88, '', G3S, 's2'),
        b('i_showNYC', true, 'New York', G3S, 's3'), { id: 'i_nycTime', tipo: 'session', def: '0800-1100', titulo: '', grupo: G3S, inline: 's3' },
        c('i_nycCol', '#FF6D00', 88, '', G3S, 's3'),
        b('i_sessLines', true, 'Session open lines', G3S),
        s('i_mit', 'Close', 'Mitigation', G3G, ['Close', 'Wick']),
        b('i_simple', true, 'Simple (no extend)', G3G, 'si'),
        n('i_maxBoxes', 'int', 8, 'Max boxes shown', G3G, { min: 1, max: 30, inline: 'si' }),
        b('i_showOB', true, 'Show OB', G3OB, 'ob0'), b('i_delOB', true, 'Delete Mitigated', G3OB, 'ob0'),
        b('i_colOBbar', true, 'Color OB candles', G3OB, 'ob0'), b('i_obMidLine', true, 'Show 50% midline', G3OB, 'ob0'),
        c('i_obBullB', C.CYAN, 70, 'Bull Border', G3OB, 'ob1'), c('i_obBearB', C.PURPLE, 70, 'Bear Border', G3OB, 'ob1'),
        c('i_obBullF', C.CYAN, 92, 'Bull Fill', G3OB, 'ob2'), c('i_obBearF', C.PURPLE, 92, 'Bear Fill', G3OB, 'ob2'),
        c('i_obBullC', C.BULL, 0, 'Bull Candle', G3OB, 'ob3'), c('i_obBearC', C.BEAR, 0, 'Bear Candle', G3OB, 'ob3'),
        c('i_obTxtC', C.WHITE, 20, 'Label', G3OB, 'ob3'),
        b('i_showFVG', true, 'Show FVG', G3F, 'f0'), b('i_delFVG', false, 'Delete Mitigated', G3F, 'f0'),
        b('i_fvgDyn', true, 'Dynamic color (near price)', G3F, 'f0'),
        c('i_fvgBullB', C.BULL, 75, 'Bull Border', G3F, 'f1'), c('i_fvgBearB', C.BEAR, 75, 'Bear Border', G3F, 'f1'),
        c('i_fvgBullF', C.BULL, 92, 'Bull Fill', G3F, 'f2'), c('i_fvgBearF', C.BEAR, 92, 'Bear Fill', G3F, 'f2'),
        c('i_fvgNearB', C.GOLD, 60, 'Near Border', G3F, 'f3'), c('i_fvgNearF', C.GOLD, 85, 'Near Fill', G3F, 'f3'),
        b('i_showLiq', true, 'Show BSL/SSL', G3L, 'l0'), n('i_liqLen', 'int', 10, 'Swing length', G3L, { min: 3, max: 50, inline: 'l0' }),
        c('i_bslCol', C.BULL, 0, 'BSL color', G3L, 'l1'), c('i_sslCol', C.BEAR, 0, 'SSL color', G3L, 'l1'),
        c('i_liqSweepC', C.GOLD, 0, 'Sweep color', G3L, 'l1'),
        b('i_htf1On', false, 'HTF 1', G3H, 'h1'), s('i_htf1', '1 Hour', '', G3H, HTF_OPC, { inline: 'h1' }),
        b('i_htf2On', false, 'HTF 2', G3H, 'h2'), s('i_htf2', '4 Hours', '', G3H, HTF_OPC, { inline: 'h2' }),
        c('i_h1BB', '#26A69A', 72, 'HTF1 Bull', G3H, 'hc1'), c('i_h1BrB', '#EF5350', 72, 'Bear', G3H, 'hc1'),
        c('i_h1BF', '#26A69A', 92, 'Fill Bull', G3H, 'hc2'), c('i_h1BrF', '#EF5350', 92, 'Bear', G3H, 'hc2'),
        c('i_h2BB', '#2196F3', 72, 'HTF2 Bull', G3H, 'hc3'), c('i_h2BrB', '#FF9800', 72, 'Bear', G3H, 'hc3'),
        c('i_h2BF', '#2196F3', 92, 'Fill Bull', G3H, 'hc4'), c('i_h2BrF', '#FF9800', 92, 'Bear', G3H, 'hc4'),
        b('i_showDash', true, 'Show Dashboard', G3D, 'd0'),
        s('i_dashPos', 'Top Right', 'Position', G3D, ['Top Right', 'Top Left', 'Bottom Right', 'Bottom Left'], { inline: 'd0' }),

        n('smc_swingLen', 'int', 10, 'Sensibilidad de Estructura (Pivot Length)', G4S, {
            min: 2, max: 50,
            tooltip: "Controla qué tan rápido reacciona el bias.\nBAJO (ej. 5)  = pivotes cortos, cambia de bias rápido (más señales, más ruido).\nALTO (ej. 15) = solo estructura mayor, cambia lento (más fiable en tendencia).\nSi ves 'falsos alcistas' en tendencia bajista → SUBE este número.",
        }),
        { id: 'smc_tf1', tipo: 'timeframe', def: '60', titulo: 'Alta Temporalidad 1', grupo: G4T, opciones: TF_PINE },
        { id: 'smc_tf2', tipo: 'timeframe', def: '240', titulo: 'Alta Temporalidad 2', grupo: G4T, opciones: TF_PINE },
        { id: 'smc_tf3', tipo: 'timeframe', def: 'D', titulo: 'Alta Temporalidad 3', grupo: G4T, opciones: TF_PINE },
        b('smc_showDebug', false, 'Mostrar Líneas de Estructura (Modo Debug)', G4D, undefined,
            "OFF = gráfico limpio (solo el panel).\nON = dibuja los Swing High/Low de referencia y marca BOS/CHOCH en las rupturas.\nDibuja la estructura de la TEMPORALIDAD DEL GRÁFICO actual (pon el gráfico en 1H para auditar la fila 1H, etc.)."),
        s('smc_posInput', 'Inferior Derecha', 'Posición del Panel', G4U, ['Inferior Derecha', 'Inferior Izquierda', 'Superior Derecha', 'Superior Izquierda']),
        s('smc_sizeInput', 'Normal', 'Tamaño del Texto', G4U, ['Pequeño', 'Normal', 'Grande']),
        s('smc_titleEmoji', '🏦', 'Emoji del Encabezado', G4U, ['🏦', '🌍', '💎']),
    ];

    // Entradas solo visuales (recalc: false): los colores y lo que se usa únicamente al
    // armar la salida (etiquetas, extender, dashboards). Cambiarlas no reprocesa velas.
    const VISUALES = new Set(['srp_showLabels', 'srp_showPrice', 'srp_extendRight', 'srp_showDashboard', 'srp_dashPositionIn',
        'i_showDash', 'i_dashPos', 'smc_posInput', 'smc_sizeInput', 'smc_titleEmoji']);
    INPUTS.forEach((inp) => { if (inp.tipo === 'color' || VISUALES.has(inp.id)) inp.recalc = false; });

    // Colores como fichas: el cálculo guarda { k: entrada } y el dibujo lo resuelve con los
    // valores actuales (paleta.v). Mismo resultado que el .pine, sin recalcular por un color.
    const paleta = { v: {} };
    const FICHAS = Object.fromEntries(INPUTS.filter((inp) => inp.tipo === 'color').map((inp) => [inp.id, Object.freeze({ k: inp.id, pal: paleta })]));
    function conFichas(v) { return { ...v, ...FICHAS }; }
    // Clave de cálculo: solo las entradas que cambian el resultado.
    function claveCalculo(v) { return JSON.stringify(INPUTS.filter((inp) => inp.recalc !== false).map((inp) => v[inp.id])); }
    function firmaVisual(v) { return JSON.stringify(INPUTS.filter((inp) => inp.recalc === false && inp.tipo !== 'color').map((inp) => v[inp.id])); }

    // ─────────────────────────────── contexto (símbolo, velas HTF) ───────────────────────────────
    let simbolo = null, precision = 5;
    const cacheHTF = new Map();
    const htfEnVuelo = new Map();
    let genHTF = 0;   // limpiarCache() la sube: una respuesta pedida antes (p. ej. del vivo, antes del replay) no se guarda
    // Un pedido por símbolo+temporalidad a la vez; un error se recuerda 30 s (antes cada recálculo,
    // o sea cada tick, volvía a pedir: con TickerAll real eso era un bucle de pedidos fallidos).
    async function velasHTF(tfNLT) {
        const k = `${simbolo}|${tfNLT}`;
        const c0 = cacheHTF.get(k);
        if (c0 && Date.now() - c0.t < (c0.error ? 30000 : 60000)) {
            if (c0.error) throw c0.error;
            return c0.v;
        }
        if (htfEnVuelo.has(k)) return htfEnVuelo.get(k);
        const gen = genHTF;
        const pedido = NLTCharts.market.velas(simbolo, tfNLT, { limit: 1500 })
            .then((r) => {
                if (gen !== genHTF) return velasHTF(tfNLT);          // llegó tarde: se vuelve a pedir a la fuente actual
                cacheHTF.set(k, { t: Date.now(), v: r.velas }); return r.velas;
            }, (err) => { if (gen === genHTF) cacheHTF.set(k, { t: Date.now(), error: err }); throw err; })
            .finally(() => htfEnVuelo.delete(k));
        htfEnVuelo.set(k, pedido);
        return pedido;
    }
    // Igual, pero con la hora en que se trajeron (sirve de "versión" para las cachés).
    async function velasHTFconFecha(tfNLT) {
        await velasHTF(tfNLT);
        return cacheHTF.get(`${simbolo}|${tfNLT}`);
    }

    // ─────────────────────────────── ④ motor de estructura HTF (smc_f_struct) ───────────────────────────────
    function smcStruct(d, len) {
        const ph = P.pivots(d.map((x) => x.high), len, len, true);
        const pl = P.pivots(d.map((x) => x.low), len, len, false);
        let lastHigh = null, lastLow = null, highBroken = false, lowBroken = false, bias = 0, event = 0;
        const out = [];
        for (let i = 0; i < d.length; i++) {
            if (ph[i] !== null) { lastHigh = ph[i]; highBroken = false; }
            if (pl[i] !== null) { lastLow = pl[i]; lowBroken = false; }
            if (lastHigh !== null && d[i].close > lastHigh && !highBroken) { highBroken = true; event = bias === -1 ? 2 : 1; bias = 1; }
            if (lastLow !== null && d[i].close < lastLow && !lowBroken) { lowBroken = true; event = bias === 1 ? -2 : -1; bias = -1; }
            out.push(event);
        }
        return out;
    }

    // request.security(..., lookahead_off) de una serie HTF en cada vela del gráfico:
    // las velas del gráfico dentro de la vela HTF j ven el valor de j-1, salvo la
    // última vela del gráfico de ese período (y la vela en curso), que ven el de j.
    function mapearHTF(d, htf, serie) {
        const out = new Array(d.length).fill(null);
        if (!htf.length) return out;
        let j = 0;
        for (let i = 0; i < d.length; i++) {
            while (j + 1 < htf.length && htf[j + 1].timestamp <= d[i].timestamp) j++;
            if (htf[j].timestamp > d[i].timestamp) continue;
            const ultimaDelPeriodo = i === d.length - 1 || !(d[i + 1].timestamp < (htf[j + 1] ? htf[j + 1].timestamp : Infinity));
            const k = ultimaDelPeriodo ? j : j - 1;
            out[i] = k >= 0 ? serie[k] : null;
        }
        return out;
    }

    // ─────────────────────────────── cálculo principal (motor con estado) ───────────────────────────────
    // Mismo recorrido vela por vela que el .pine. Para no reprocesar toda la historia en cada tick,
    // el estado se guarda tras la última vela CERRADA: un tick reprocesa solo la vela en curso y una
    // vela nueva solo las dos últimas. Cambio de símbolo / TF / historia / parámetro -> cálculo completo.

    const TZ = -5; // "UTC-5", huso FIJO (sin horario de verano) -- igual que ict_TZ del .pine
    const HTF_DEFS = (v) => [
        [v.i_htf1On, v.i_htf1, v.i_h1BB, v.i_h1BrB, v.i_h1BF, v.i_h1BrF, 'HTF1 FVG'],
        [v.i_htf2On, v.i_htf2, v.i_h2BB, v.i_h2BrB, v.i_h2BF, v.i_h2BrF, 'HTF2 FVG'],
    ];

    // Series HTF crudas (en la temporalidad mayor): FVG y valuewhen de sus bordes.
    function seriesHTFcrudas(hv) {
        const bull = [], bear = [], bTop = [], bBot = [], rTop = [], rBot = [];
        let vbT = null, vbB = null, vrT = null, vrB = null;
        hv.forEach((x, j) => {
            const bu = j >= 2 && x.low - hv[j - 2].high > 0 && hv[j - 1].open < hv[j - 1].close;
            const be = j >= 2 && hv[j - 2].low - x.high > 0 && hv[j - 1].open > hv[j - 1].close;
            if (bu) { vbT = hv[j - 2].high; vbB = x.low; }
            if (be) { vrT = x.high; vrB = hv[j - 2].low; }
            bull.push(bu); bear.push(be); bTop.push(vbT); bBot.push(vbB); rTop.push(vrT); rBot.push(vrB);
        });
        return { bull, bear, bTop, bBot, rTop, rBot };
    }

    // mapearHTF para un solo índice (misma regla que mapearHTF).
    function mapearHTFen(d, htf, serie, i) {
        if (!htf.length) return null;
        let lo = 0, hi = htf.length - 1, j = -1;
        while (lo <= hi) { const m = (lo + hi) >> 1; if (htf[m].timestamp <= d[i].timestamp) { j = m; lo = m + 1; } else hi = m - 1; }
        if (j < 0) return null;
        const ultimaDelPeriodo = i === d.length - 1 || !(d[i + 1].timestamp < (htf[j + 1] ? htf[j + 1].timestamp : Infinity));
        const k = ultimaDelPeriodo ? j : j - 1;
        return k >= 0 ? serie[k] : null;
    }

    // ── series por vela: dependen solo de las velas y de los parámetros ──
    async function prepararSeries(d, v) {
        const high = d.map((x) => x.high), low = d.map((x) => x.low);
        const se = {
            high, low,
            atr: P.atr(d, v.srp_atrLength),
            srpPH: P.pivots(high, v.srp_pivotLookback, v.srp_pivotLookback, true),
            srpPL: P.pivots(low, v.srp_pivotLookback, v.srp_pivotLookback, false),
            bosPH: P.pivots(high, v.bos_length, v.bos_length, true),
            bosPL: P.pivots(low, v.bos_length, v.bos_length, false),
            liqPH: P.pivots(high, v.i_liqLen, v.i_liqLen, true),
            liqPL: P.pivots(low, v.i_liqLen, v.i_liqLen, false),
            smcPH: P.pivots(high, v.smc_swingLen, v.smc_swingLen, true),
            smcPL: P.pivots(low, v.smc_swingLen, v.smc_swingLen, false),
            inSOD: d.map((x) => P.enSesion(x.timestamp, v.i_sodTime, TZ)),
            inLon: d.map((x) => P.enSesion(x.timestamp, v.i_lonTime, TZ)),
            inNYC: d.map((x) => P.enSesion(x.timestamp, v.i_nycTime, TZ)),
            htf: [], htfVersion: '',
        };
        for (const [on, tfIn, bb, brb, bf, brf, nombre] of HTF_DEFS(v)) {
            if (!v.m3_on || !on || !simbolo) { se.htf.push(null); continue; }
            let hv = [], t = 0;
            try { const r = await velasHTFconFecha(HTF_A_NLT[tfIn]); hv = r.v; t = r.t; } catch (_) { hv = []; }
            const cr = seriesHTFcrudas(hv);
            se.htfVersion += `${tfIn}:${t};`;
            se.htf.push({
                hv, cr, bb, brb, bf, brf, nombre,
                bull: mapearHTF(d, hv, cr.bull), bear: mapearHTF(d, hv, cr.bear), bTop: mapearHTF(d, hv, cr.bTop),
                bBot: mapearHTF(d, hv, cr.bBot), rTop: mapearHTF(d, hv, cr.rTop), rBot: mapearHTF(d, hv, cr.rBot),
            });
        }
        return se;
    }

    // Recalcula las series en los índices [desde, N) (N puede haber crecido en 1).
    function actualizarSeries(se, d, v, desde) {
        const n = v.srp_atrLength;
        for (let i = desde; i < d.length; i++) {
            se.high[i] = d[i].high; se.low[i] = d[i].low;
            const prev = se.atr[i - 1];
            if (i < n || prev === null || prev === undefined) {
                se.atr = P.atr(d, n);   // sin valor previo (principio de la serie): completo
            } else {
                const b = d[i], c1 = d[i - 1].close;
                const tr = Math.max(Math.max(b.high - b.low, Math.abs(b.high - c1)), Math.abs(b.low - c1));
                se.atr[i] = (1 / n) * tr + (1 - 1 / n) * prev;
            }
            se.srpPH[i] = P.pivotEn(se.high, i, v.srp_pivotLookback, v.srp_pivotLookback, true);
            se.srpPL[i] = P.pivotEn(se.low, i, v.srp_pivotLookback, v.srp_pivotLookback, false);
            se.bosPH[i] = P.pivotEn(se.high, i, v.bos_length, v.bos_length, true);
            se.bosPL[i] = P.pivotEn(se.low, i, v.bos_length, v.bos_length, false);
            se.liqPH[i] = P.pivotEn(se.high, i, v.i_liqLen, v.i_liqLen, true);
            se.liqPL[i] = P.pivotEn(se.low, i, v.i_liqLen, v.i_liqLen, false);
            se.smcPH[i] = P.pivotEn(se.high, i, v.smc_swingLen, v.smc_swingLen, true);
            se.smcPL[i] = P.pivotEn(se.low, i, v.smc_swingLen, v.smc_swingLen, false);
            se.inSOD[i] = P.enSesion(d[i].timestamp, v.i_sodTime, TZ);
            se.inLon[i] = P.enSesion(d[i].timestamp, v.i_lonTime, TZ);
            se.inNYC[i] = P.enSesion(d[i].timestamp, v.i_nycTime, TZ);
            se.htf.forEach((h) => {
                if (!h) return;
                ['bull', 'bear', 'bTop', 'bBot', 'rTop', 'rBot'].forEach((k) => { h[k][i] = mapearHTFen(d, h.hv, h.cr[k], i); });
            });
        }
    }

    function estadoNuevo() {
        return {
            zones: [], lastBreak: 'Ninguno', activeCount: 0, closestSup: null, closestRes: null,
            swHP: null, swHI: null, swLP: null, swLI: null, trend: 0,
            bullFVGs: [], bearFVGs: [], bullOBs: [], bearOBs: [], bullMid: [], bearMid: [],
            lastBSL: null, lastSSL: null, bslLine: null, sslLine: null, bslLbl: null, sslLbl: null,
            barc: [[], [], []], bg: [], fueraLineas: [], fueraLabels: [], htfBoxes: [[], []],
            dHi: null, dLo: null, dHiBroken: false, dLoBroken: false, dBias: 0,
        };
    }

    // Copia profunda de lo que se modifica en el lugar; lo inmutable se comparte.
    function clonar(S) {
        const cajas = (a) => a.map((b) => ({ ...b }));
        return {
            ...S,
            zones: S.zones.map((z) => ({ ...z })),
            bullFVGs: cajas(S.bullFVGs), bearFVGs: cajas(S.bearFVGs), bullOBs: cajas(S.bullOBs), bearOBs: cajas(S.bearOBs),
            bullMid: S.bullMid.slice(), bearMid: S.bearMid.slice(),
            barc: S.barc.map((a) => a.slice()), bg: S.bg.slice(),
            fueraLineas: S.fueraLineas.slice(), fueraLabels: S.fueraLabels.slice(),
            htfBoxes: S.htfBoxes.map((a) => a.slice()),
        };
    }

    // Una vela del .pine, en el mismo orden de bloques: ① ② ③ ④.
    function procesarVela(S, se, d, v, i) {
        const N = d.length;
        const bar = d[i];
        const high = se.high, low = se.low;
        const op = (k) => (i - k >= 0 ? d[i - k].open : null);
        const cl = (k) => (i - k >= 0 ? d[i - k].close : null);
        const hi = (k) => (i - k >= 0 ? high[i - k] : null), lo = (k) => (i - k >= 0 ? low[i - k] : null);
        const gt = (a, x) => a !== null && x !== null && a > x;
        const lt = (a, x) => a !== null && x !== null && a < x;
        const le = (a, x) => a !== null && x !== null && a <= x, ge = (a, x) => a !== null && x !== null && a >= x;
        const dif = (a, x) => (a === null || x === null ? null : a - x);   // na - x = na (en JS null - x daría un número)
        const push500 = (arr, x) => { arr.push(x); if (arr.length > 500) arr.shift(); };   // objetos "fire and forget"
        const trim = (arr, maxN) => { while (arr.length > maxN) arr.shift(); };
        const extRight = !v.i_simple;

        // ===== ① S/R =====
        S.activeCount = 0; S.closestSup = null; S.closestRes = null;   // no son `var`: se reinician en cada vela
        if (v.m1_on) {
            const atrVal = se.atr[i];
            const calcW = atrVal === null && v.srp_zoneWidthMode === 'ATR' ? null
                : v.srp_zoneWidthMode === 'ATR' ? atrVal * v.srp_zoneWidthMult : bar.close * v.srp_zoneWidthMult * 0.001;
            const maxW = atrVal === null ? null : atrVal * v.srp_maxZoneWidth;
            const finalW = calcW === null || maxW === null ? null : Math.min(calcW, maxW);
            const addZone = (price, isSup, pivotBar) => {
                const top = finalW === null ? null : price + finalW / 2;
                const bottom = finalW === null ? null : price - finalW / 2;
                let merge = false;
                for (const z of S.zones) {
                    if (z.isSupport === isSup && !z.isBroken && atrVal !== null && Math.abs(z.midPrice - price) <= atrVal * v.srp_mergeThreshold) { merge = true; break; }
                }
                if (!merge) S.zones.push({ top, bottom, midPrice: price, startBar: pivotBar, isSupport: isSup, testCount: 1, lastTestBar: pivotBar, isBroken: false, isRetested: false, breakBar: 0, closesOut: 0 });
            };
            if (se.srpPH[i] !== null) addZone(se.srpPH[i], false, i - v.srp_pivotLookback);
            if (se.srpPL[i] !== null) addZone(se.srpPL[i], true, i - v.srp_pivotLookback);

            if (S.zones.length > 0) {
                let supCount = 0, resCount = 0;
                for (let k = S.zones.length - 1; k >= 0; k--) {
                    const z = S.zones[k];
                    let quitar = false;
                    if (z.isBroken) {
                        if (!v.srp_keepBroken || (i - z.breakBar > v.srp_maxBrokenAge)) quitar = true;
                    } else if (z.isSupport) {
                        supCount += 1; if (supCount > v.srp_maxZonesPerType) quitar = true;
                    } else {
                        resCount += 1; if (resCount > v.srp_maxZonesPerType) quitar = true;
                    }
                    if (quitar) { S.zones.splice(k, 1); continue; }
                    const buffer = atrVal === null ? null : atrVal * v.srp_breakBufferMult;
                    if (!z.isBroken) {
                        S.activeCount += 1;
                        if (z.isSupport && z.midPrice <= bar.close) S.closestSup = S.closestSup === null ? z.midPrice : Math.max(S.closestSup, z.midPrice);
                        else if (!z.isSupport && z.midPrice >= bar.close) S.closestRes = S.closestRes === null ? z.midPrice : Math.min(S.closestRes, z.midPrice);
                        const touched = buffer !== null && z.bottom !== null && bar.high >= z.bottom - buffer && bar.low <= z.top + buffer;
                        if (touched && (i - z.lastTestBar >= v.srp_minBarsBetween)) { z.testCount += 1; z.lastTestBar = i; }
                        const closedOut = buffer !== null && z.bottom !== null && (z.isSupport ? bar.close < z.bottom - buffer : bar.close > z.top + buffer);
                        z.closesOut = closedOut ? z.closesOut + 1 : 0;
                        if (z.closesOut >= v.srp_breakCloses) { z.isBroken = true; z.breakBar = i; S.lastBreak = z.isSupport ? 'Bearish' : 'Bullish'; }
                    } else if (!z.isRetested) {
                        const retested = (z.isSupport && bar.high >= z.bottom) || (!z.isSupport && bar.low <= z.top);
                        if (retested) {
                            z.isRetested = true;
                            push500(S.fueraLabels, { x: i, y: z.isSupport ? bar.high : bar.low, text: 'retest', style: z.isSupport ? 'down' : 'up', color: P.col('#2962FF', 20), textColor: P.col('#FFFFFF', 0), size: 'tiny' });
                        }
                    }
                }
            }
        }

        // ===== ② BOS & CHoCH =====
        if (v.m2_on) {
            if (se.bosPH[i] !== null) { S.swHP = high[i - v.bos_length]; S.swHI = i - v.bos_length; }
            if (se.bosPL[i] !== null) { S.swLP = low[i - v.bos_length]; S.swLI = i - v.bos_length; }
            const bosLinea = (x1, y1, x2, y2, color, txt) => {
                push500(S.fueraLineas, { x1, y1, x2, y2, color, style: 'solid', width: 1 });
                if (v.bos_showLabels) push500(S.fueraLabels, { x: Math.trunc((x1 + x2) / 2), y: y1, text: txt, style: 'down', color: P.col('#FFFFFF', 100), textColor: color, size: 'tiny' });
            };
            if (S.swHP !== null && bar.close > S.swHP) {
                bosLinea(S.swHI, S.swHP, i, S.swHP, v.bos_colBull, S.trend === -1 ? 'CHoCH' : 'BOS');
                S.trend = 1; S.swHP = null;
            }
            if (S.swLP !== null && bar.close < S.swLP) {
                bosLinea(S.swLI, S.swLP, i, S.swLP, v.bos_colBear, S.trend === 1 ? 'CHoCH' : 'BOS');
                S.trend = -1; S.swLP = null;
            }
        }

        // ===== ③ ICT Pro =====
        const capas = [];
        if (v.m3_on && v.i_showSOD && se.inSOD[i]) capas.push(v.i_sodCol);
        if (v.m3_on && v.i_showLon && se.inLon[i]) capas.push(v.i_lonCol);
        if (v.m3_on && v.i_showNYC && se.inNYC[i]) capas.push(v.i_nycCol);
        S.bg[i] = capas;
        [
            [v.i_showSOD && se.inSOD[i] && !(i > 0 && se.inSOD[i - 1]), '#2962FF'],
            [v.i_showLon && se.inLon[i] && !(i > 0 && se.inLon[i - 1]), '#4CAF50'],
            [v.i_showNYC && se.inNYC[i] && !(i > 0 && se.inNYC[i - 1]), '#FF6D00'],
        ].forEach(([abre, hex]) => {
            if (v.m3_on && v.i_sessLines && abre) push500(S.fueraLineas, { x1: i, y1: bar.low * 0.999, x2: i, y2: bar.high * 1.001, color: P.col(hex, 40), style: 'dashed', width: 1 });
        });

        const mitLow = v.i_mit === 'Close' ? cl(1) : bar.low;
        const mitHigh = v.i_mit === 'Close' ? cl(1) : bar.high;
        const fBull = i >= 2 && low[i] - high[i - 2] > 0 && op(1) < cl(1);
        const fBear = i >= 2 && low[i - 2] - high[i] > 0 && op(1) > cl(1);

        if (v.m3_on && fBull && v.i_showFVG) {
            S.bullFVGs.push({ left: i - 2, top: high[i - 2], right: i, bottom: bar.low, border: v.i_simple ? P.col(C.BULL, 75) : v.i_fvgBullB, bg: v.i_fvgBullF, text: 'FVG', textColor: P.col(C.WHITE, 40), textSize: 'tiny', extendRight: extRight });
            trim(S.bullFVGs, v.i_maxBoxes);
        }
        if (v.m3_on && fBear && v.i_showFVG) {
            S.bearFVGs.push({ left: i - 2, top: low[i - 2], right: i, bottom: bar.high, border: v.i_simple ? P.col(C.BEAR, 75) : v.i_fvgBearB, bg: v.i_fvgBearF, text: 'FVG', textColor: P.col(C.WHITE, 40), textSize: 'tiny', extendRight: extRight });
            trim(S.bearFVGs, v.i_maxBoxes);
        }
        // Nota (paridad con el .pine, documentado, NO corregido): el FVG alcista se crea con
        // box.new(..., top=high[2], ..., bottom=low), "top" queda por debajo de "bottom", rng < 0 y el
        // color dinámico nunca se aplica a los alcistas.
        if (v.m3_on) {
            for (let k = S.bullFVGs.length - 1; k >= 0; k--) {
                const bx = S.bullFVGs[k], rng = bx.top - bx.bottom;
                if (v.i_fvgDyn && rng > 0 && bar.close > bx.bottom && bar.close < bx.top + rng * 0.3) { bx.border = v.i_fvgNearB; bx.bg = v.i_fvgNearF; }
                if (!v.i_simple && lt(mitLow, bx.bottom)) { bx.right = i; bx.extendRight = false; S.bullFVGs.splice(k, 1); if (!v.i_delFVG) push500(S.fueraLineas, { caja: bx }); }
            }
            for (let k = S.bearFVGs.length - 1; k >= 0; k--) {
                const bx = S.bearFVGs[k], rng = bx.top - bx.bottom;
                if (v.i_fvgDyn && rng > 0 && bar.close < bx.top && bar.close > bx.bottom - rng * 0.3) { bx.border = v.i_fvgNearB; bx.bg = v.i_fvgNearF; }
                if (!v.i_simple && gt(mitHigh, bx.top)) { bx.right = i; bx.extendRight = false; S.bearFVGs.splice(k, 1); if (!v.i_delFVG) push500(S.fueraLineas, { caja: bx }); }
            }
        }

        // Order Blocks
        const b2 = gt(op(2), cl(2)), b3 = gt(op(3), cl(3)), b4 = gt(op(4), cl(4));   // vela bajista k atrás
        const u2 = lt(op(2), cl(2)), u3 = lt(op(3), cl(3)), u4 = lt(op(4), cl(4));   // vela alcista k atrás
        const obBullN = fBull && b2 && gt(cl(1), hi(2));
        const obBullC1 = fBull && le(op(2), cl(2)) && b3 && gt(cl(1), hi(3)) && !b2;
        const obBullC2 = fBull && le(op(2), cl(2)) && le(op(3), cl(3)) && b4 && gt(cl(1), hi(4)) && !b2 && !b3;
        const noFC1 = !(gt(dif(lo(1), hi(3)), 0) && b3);
        const noFC2 = !(gt(dif(lo(1), hi(3)), 0) && b3) && !(gt(dif(lo(2), hi(4)), 0) && b4);
        const obBearN = fBear && u2 && lt(cl(1), lo(2));
        const obBearC1 = fBear && ge(op(2), cl(2)) && u3 && lt(cl(1), lo(3)) && !u2;
        const obBearC2 = fBear && ge(op(2), cl(2)) && ge(op(3), cl(3)) && u4 && lt(cl(1), lo(4)) && !u2 && !u3;
        const noBFC1 = !(gt(dif(lo(3), hi(1)), 0) && u3);
        const noBFC2 = !(gt(dif(lo(3), hi(1)), 0) && u3) && !(gt(dif(lo(4), hi(2)), 0) && u4);

        const nuevoOB = (arr, mids, k, texto, borde, relleno, colMid) => {
            arr.push({ left: i - k, top: high[i - k], right: i, bottom: low[i - k], border: borde, bg: relleno, text: texto, textColor: v.i_obTxtC, textSize: 'tiny', extendRight: extRight });
            if (v.i_obMidLine) {
                const mid = (high[i - k] + low[i - k]) / 2;
                mids.push({ x1: i - k, y1: mid, x2: i + 20, y2: mid, color: P.col(colMid, 40), style: 'dashed', width: 1 });
                trim(mids, v.i_maxBoxes);
            }
            trim(arr, v.i_maxBoxes);
        };
        if (v.m3_on && v.i_showOB) {
            if (obBullN) nuevoOB(S.bullOBs, S.bullMid, 2, 'Naked OB', v.i_obBullB, v.i_obBullF, C.CYAN);
            if (obBullC1 && noFC1) nuevoOB(S.bullOBs, S.bullMid, 3, 'Covered OB', v.i_obBullB, v.i_obBullF, C.CYAN);
            if (obBullC2 && noFC2) nuevoOB(S.bullOBs, S.bullMid, 4, 'Covered OB', v.i_obBullB, v.i_obBullF, C.CYAN);
            if (obBearN) nuevoOB(S.bearOBs, S.bearMid, 2, 'Naked OB', v.i_obBearB, v.i_obBearF, C.PURPLE);
            if (obBearC1 && noBFC1) nuevoOB(S.bearOBs, S.bearMid, 3, 'Covered OB', v.i_obBearB, v.i_obBearF, C.PURPLE);
            if (obBearC2 && noBFC2) nuevoOB(S.bearOBs, S.bearMid, 4, 'Covered OB', v.i_obBearB, v.i_obBearF, C.PURPLE);
        }
        if (v.m3_on && !v.i_simple) {
            for (let k = S.bullOBs.length - 1; k >= 0; k--) {
                const bx = S.bullOBs[k];
                if (lt(mitLow, bx.bottom)) { bx.right = i; bx.extendRight = false; S.bullOBs.splice(k, 1); if (!v.i_delOB) push500(S.fueraLineas, { caja: bx }); }
            }
            for (let k = S.bearOBs.length - 1; k >= 0; k--) {
                const bx = S.bearOBs[k];
                if (gt(mitHigh, bx.top)) { bx.right = i; bx.extendRight = false; S.bearOBs.splice(k, 1); if (!v.i_delOB) push500(S.fueraLineas, { caja: bx }); }
            }
        }
        // barcolor con offset -2 / -3 / -4 (el último barcolor gana)
        if (v.m3_on && v.i_colOBbar) {
            if (obBullN) S.barc[0][i - 2] = v.i_obBullC; else if (obBearN) S.barc[0][i - 2] = v.i_obBearC;
            if (obBullC1 && noFC1) S.barc[1][i - 3] = v.i_obBullC; else if (obBearC1 && noBFC1) S.barc[1][i - 3] = v.i_obBearC;
            if (obBullC2 && noFC2) S.barc[2][i - 4] = v.i_obBullC; else if (obBearC2 && noBFC2) S.barc[2][i - 4] = v.i_obBearC;
        }

        // Liquidez
        if (v.m3_on && v.i_showLiq && se.liqPH[i] !== null) {
            S.lastBSL = se.liqPH[i];
            S.bslLine = { x1: i - v.i_liqLen, y1: S.lastBSL, x2: i + 30, y2: S.lastBSL, color: P.conT(v.i_bslCol, 50), style: 'dotted', width: 2 };
            S.bslLbl = { x: i - v.i_liqLen, y: S.lastBSL, text: 'BSL', style: 'right', color: P.conT(v.i_bslCol, 80), textColor: v.i_bslCol, size: 'tiny' };
        }
        if (v.m3_on && v.i_showLiq && se.liqPL[i] !== null) {
            S.lastSSL = se.liqPL[i];
            S.sslLine = { x1: i - v.i_liqLen, y1: S.lastSSL, x2: i + 30, y2: S.lastSSL, color: P.conT(v.i_sslCol, 50), style: 'dotted', width: 2 };
            S.sslLbl = { x: i - v.i_liqLen, y: S.lastSSL, text: 'SSL', style: 'right', color: P.conT(v.i_sslCol, 80), textColor: v.i_sslCol, size: 'tiny' };
        }
        const bullSweep = v.m3_on && v.i_showLiq && S.lastSSL !== null && bar.low < S.lastSSL && bar.close > S.lastSSL;
        const bearSweep = v.m3_on && v.i_showLiq && S.lastBSL !== null && bar.high > S.lastBSL && bar.close < S.lastBSL;
        if (bullSweep) { push500(S.fueraLabels, { x: i, y: bar.low, text: '⚡ SSL Swept', style: 'up', color: P.col(C.GOLD, 70), textColor: P.col(C.GOLD, 0), size: 'small' }); S.lastSSL = null; }
        if (bearSweep) { push500(S.fueraLabels, { x: i, y: bar.high, text: '⚡ BSL Swept', style: 'down', color: P.col(C.GOLD, 70), textColor: P.col(C.GOLD, 0), size: 'small' }); S.lastBSL = null; }

        // HTF FVG
        se.htf.forEach((h, idx) => {
            if (!h) return;
            const cajas = S.htfBoxes[idx];
            if (h.bull[i] && h.bBot[i] !== null) { cajas.push({ left: i, bottom: h.bBot[i], top: h.bTop[i], right: N - 1 + 20, border: h.bb, bg: h.bf, text: h.nombre, textColor: P.col(C.WHITE, 40), textSize: 'tiny', halign: 'right', extendRight: true }); trim(cajas, 5); }
            if (h.bear[i] && h.rBot[i] !== null) { cajas.push({ left: i, bottom: h.rBot[i], top: h.rTop[i], right: N - 1 + 20, border: h.brb, bg: h.brf, text: h.nombre, textColor: P.col(C.WHITE, 40), textSize: 'tiny', halign: 'right', extendRight: true }); trim(cajas, 5); }
        });

        // ===== ④ debug (estructura del TF del gráfico) =====
        if (v.m4_on) {
            if (se.smcPH[i] !== null) {
                S.dHi = se.smcPH[i]; S.dHiBroken = false;
                if (v.smc_showDebug) push500(S.fueraLineas, { x1: i - v.smc_swingLen, y1: S.dHi, x2: i, y2: S.dHi, color: P.col('#8A2BE2', 15), style: 'dotted', width: 1 });
            }
            if (se.smcPL[i] !== null) {
                S.dLo = se.smcPL[i]; S.dLoBroken = false;
                if (v.smc_showDebug) push500(S.fueraLineas, { x1: i - v.smc_swingLen, y1: S.dLo, x2: i, y2: S.dLo, color: P.col('#00FF00', 15), style: 'dotted', width: 1 });
            }
            if (S.dHi !== null && bar.close > S.dHi && !S.dHiBroken) {
                S.dHiBroken = true;
                const choch = S.dBias === -1; S.dBias = 1;
                if (v.smc_showDebug) push500(S.fueraLabels, { x: i, y: bar.high, yloc: 'abovebar', text: choch ? 'CHOCH' : 'BOS', style: 'down', color: P.col('#000000', 15), textColor: P.col('#00FF00', 0), size: 'small' });
            }
            if (S.dLo !== null && bar.close < S.dLo && !S.dLoBroken) {
                S.dLoBroken = true;
                const choch = S.dBias === 1; S.dBias = -1;
                if (v.smc_showDebug) push500(S.fueraLabels, { x: i, y: bar.low, yloc: 'belowbar', text: choch ? 'CHOCH' : 'BOS', style: 'up', color: P.col('#000000', 15), textColor: P.col('#8A2BE2', 0), size: 'small' });
            }
        }
    }

    // Salida con el estado de la última vela (como los objetos de TradingView en barstate.islast).
    function construirSalida(S, se, d, v, sesgosSMC) {
        const N = d.length;
        const ultima = N - 1;
        const o = { boxes: [], lines: [], labels: [], bg: S.bg, barColor: new Array(N).fill(null), dash: {} };
        if (v.m1_on) {
            S.zones.forEach((z) => {
                if (z.top === null) return;
                const right = v.srp_extendRight ? ultima + 10 : ultima;
                o.boxes.push({
                    left: z.startBar, right, top: z.top, bottom: z.bottom,
                    bg: z.isBroken ? v.srp_colorBroken : (z.isSupport ? v.srp_colorSupport : v.srp_colorResistance),
                    border: z.isBroken ? P.col('#787B86', 60) : (z.isSupport ? P.col('#00B5AD', 20) : P.col('#FF4D4D', 20)),
                    borderStyle: z.isBroken ? 'dashed' : 'solid',
                });
                if (v.srp_showLabels) {
                    const estado = z.isBroken ? (z.isRetested ? ' | Rota + Retest' : ' | Rota') : (z.testCount >= v.srp_minTests ? ' | Validada' : '');
                    const precioTxt = v.srp_showPrice ? P.formatoPrecio(z.midPrice, 5) + ' | ' : '';
                    o.labels.push({ x: right, y: z.midPrice, text: `${precioTxt}${z.testCount}T${estado}`, style: 'left', color: P.col('#000000', 100), textColor: P.col('#FFFFFF', 0), size: 'small' });
                }
            });
            if (v.srp_showDashboard) o.dash.sr = { pos: v.srp_dashPositionIn, html: tablaSR(S.closestRes, S.closestSup, S.lastBreak, S.activeCount) };
        }
        S.fueraLineas.forEach((x) => (x.caja ? o.boxes.push(x.caja) : o.lines.push(x)));
        o.boxes.push(...S.bullFVGs, ...S.bearFVGs, ...S.bullOBs, ...S.bearOBs);
        S.htfBoxes.forEach((a) => o.boxes.push(...a));
        o.lines.push(...S.bullMid, ...S.bearMid);
        [S.bslLine, S.sslLine].forEach((l) => l && o.lines.push(l));
        o.labels.push(...S.fueraLabels);
        [S.bslLbl, S.sslLbl].forEach((l) => l && o.labels.push(l));
        for (let i = 0; i < N; i++) o.barColor[i] = S.barc[2][i] || S.barc[1][i] || S.barc[0][i] || null;

        if (v.m3_on && v.i_showDash) {
            const sesion = se.inSOD[ultima] ? 'Start of Day 🔵' : se.inLon[ultima] ? 'London 🟢' : se.inNYC[ultima] ? 'New York 🟠' : 'Off-Hours ⚫';
            const hb = se.htf.map((h) => (h ? !!h.bull[ultima] : false)), hr = se.htf.map((h) => (h ? !!h.bear[ultima] : false));
            const anyB = hb[0] || hb[1], anyR = hr[0] || hr[1];
            const sesgo = anyB && !anyR ? 'Bullish 🟢' : anyR && !anyB ? 'Bearish 🔴' : 'Neutral ⚪';
            const fmt = (x) => (x === null ? 'Swept' : x.toFixed(precision));
            o.dash.ict = {
                pos: v.i_dashPos,
                html: `<pre class="ud-pre">╔══ ICT PRO ══════════════╗\n║ Session : ${sesion}\n║ HTF Bias: ${sesgo}\n║ Bull OBs: ${S.bullOBs.length}  Bear OBs: ${S.bearOBs.length}\n║ Bull FVG: ${S.bullFVGs.length}  Bear FVG: ${S.bearFVGs.length}\n║ BSL: ${fmt(S.lastBSL)}  SSL: ${fmt(S.lastSSL)}\n╚═════════════════════════╝</pre>`,
                clase: 'ud-ict',
            };
        }
        if (v.m4_on && sesgosSMC) {
            o.dash.smc = { pos: { 'Inferior Derecha': 'Bottom Right', 'Inferior Izquierda': 'Bottom Left', 'Superior Derecha': 'Top Right', 'Superior Izquierda': 'Top Left' }[v.smc_posInput], html: tablaSMC(v, sesgosSMC), clase: 'ud-smc' };
        }
        // Firma del contenido de los dashboards: el DOM solo se toca si cambió.
        o.dashFirma = JSON.stringify(o.dash);
        return o;
    }

    // ④ panel SMC: solo se recalcula cuando cambian las velas HTF (cache por TF).
    const cacheSMC = new Map();
    async function sesgosSMC(v) {
        if (!v.m4_on || !simbolo) return null;
        const out = [];
        for (const tf of [v.smc_tf1, v.smc_tf2, v.smc_tf3]) {
            try {
                const r = await velasHTFconFecha(TF_A_NLT[tf]);
                const clave = `${simbolo}|${tf}|${r.t}|${v.smc_swingLen}`;
                let b = cacheSMC.get(clave);
                if (b === undefined) {
                    // s[1] con lookahead_off en la vela en curso = evento tras la última vela HTF cerrada
                    const cerradas = r.v.slice(0, -1);
                    const ev = cerradas.length ? smcStruct(cerradas, v.smc_swingLen).pop() : 0;
                    b = ev > 0 ? 1 : ev < 0 ? -1 : 0;
                    if (cacheSMC.size > 50) cacheSMC.clear();
                    cacheSMC.set(clave, b);
                }
                out.push(b);
            } catch (_) { out.push(0); }
        }
        return out;
    }

    /** Cálculo completo, sin caché (lo usan los tests). */
    async function calcular(d, v) {
        const N = d.length;
        if (!N) return { boxes: [], lines: [], labels: [], bg: [], barColor: [], dash: {}, dashFirma: '{}' };
        const se = await prepararSeries(d, v);
        const S = estadoNuevo();
        for (let i = 0; i < N; i++) procesarVela(S, se, d, v, i);
        return construirSalida(S, se, d, v, await sesgosSMC(v));
    }

    // Motor incremental por instancia de indicador.
    const motores = new Map();
    const stats = { completo: 0, tick: 0, velaNueva: 0 };
    async function calcularIncremental(id, d, vUsuario) {
        const N = d.length;
        if (!N) return calcular(d, vUsuario);
        paleta.v = vUsuario;
        const v = conFichas(vUsuario);
        const clave = claveCalculo(vUsuario) + '|' + simbolo;
        let m = motores.get(id);
        let S = null;
        if (m && m.clave === clave && N >= 4 && m.primerTs === d[0].timestamp) {
            // Si cambiaron las velas HTF (se refrescan cada 60 s), completo.
            let htfVersion = '';
            for (const [on, tfIn] of HTF_DEFS(v)) {
                if (!v.m3_on || !on || !simbolo) continue;
                try { htfVersion += `${tfIn}:${(await velasHTFconFecha(HTF_A_NLT[tfIn])).t};`; } catch (_) { /* sin HTF */ }
            }
            if (htfVersion === m.se.htfVersion) {
                if (N === m.N && d[N - 2].timestamp === m.tsPenultima) {
                    actualizarSeries(m.se, d, v, N - 1);
                    S = clonar(m.snap);
                    procesarVela(S, m.se, d, v, N - 1);
                    stats.tick += 1;
                } else if (N === m.N + 1 && d[N - 2].timestamp === m.tsUltima) {
                    actualizarSeries(m.se, d, v, N - 2);
                    S = clonar(m.snap);
                    procesarVela(S, m.se, d, v, N - 2);
                    m.snap = clonar(S);
                    procesarVela(S, m.se, d, v, N - 1);
                    stats.velaNueva += 1;
                }
            }
        }
        if (!S) {
            const se = await prepararSeries(d, v);
            S = estadoNuevo();
            for (let i = 0; i < N - 1; i++) procesarVela(S, se, d, v, i);
            m = { clave, se, snap: clonar(S) };
            procesarVela(S, se, d, v, N - 1);
            stats.completo += 1;
        }
        m.N = N; m.primerTs = d[0].timestamp; m.tsPenultima = d[N - 2] ? d[N - 2].timestamp : null; m.tsUltima = d[N - 1].timestamp;
        m.S = S; m.sesgos = await sesgosSMC(v); m.firmaVisual = firmaVisual(vUsuario);
        motores.set(id, m);
        return construirSalida(S, m.se, d, v, m.sesgos);
    }

    // Cambio solo visual: se rearma la salida desde el estado guardado (sin reprocesar velas).
    function salidaVisual(id, d, vUsuario) {
        const m = motores.get(id);
        if (!m || !m.S) return null;
        const f = firmaVisual(vUsuario);
        if (f === m.firmaVisual) return null;
        m.firmaVisual = f;
        return construirSalida(m.S, m.se, d, conFichas(vUsuario), m.sesgos);
    }

    function tablaSR(res, sup, brk, activas) {
        const f = (x) => (x === null ? 'N/A' : P.formatoPrecio(x, 5));
        const colBrk = brk === 'Bearish' ? '#FF4D4D' : brk === 'Bullish' ? '#00B5AD' : '#C0C0C0';
        return `<table class="ud-tabla ud-sr"><tr><th colspan="2">S/R Dashboard</th></tr>
            <tr><td>Resistencia</td><td style="color:#FF4D4D">${f(res)}</td></tr>
            <tr><td>Soporte</td><td style="color:#00B5AD">${f(sup)}</td></tr>
            <tr><td>Último break</td><td style="color:${colBrk}">${NLTCharts.ui.esc(brk)}</td></tr>
            <tr><td>Zonas activas</td><td style="color:#fff">${activas}</td></tr></table>`;
    }

    function tablaSMC(v, [b1, b2, b3]) {
        const esc = NLTCharts.ui.esc;
        const emoji = (x) => (x === 1 ? '🐂' : x === -1 ? '🐻' : '⚖️');
        const word = (x) => (x === 1 ? 'ALCISTA' : x === -1 ? 'BAJISTA' : 'RANGO');
        const col = (x) => (x === 1 ? '#00FF00' : x === -1 ? '#8A2BE2' : '#FFC400');
        const tfLabel = (tf) => ({ '60': '1 H', '240': '4 H', 'D': '1 D', 'W': '1 W', '15': '15 M' }[tf] || tf);
        const allBull = b1 === 1 && b2 === 1 && b3 === 1, allBear = b1 === -1 && b2 === -1 && b3 === -1;
        const g = allBull ? ['🚀', 'COMPRA FUERTE', '#00FF00'] : allBear ? ['🩸', 'VENTA FUERTE', '#8A2BE2'] : ['⚖️', 'PRECAUCIÓN', '#FFC400'];
        const sz = { 'Pequeño': 's', 'Normal': 'n', 'Grande': 'l' }[v.smc_sizeInput] || 'n';
        const fila = (tf, x, bgc) => `<tr style="background:${bgc}"><td class="ud-muted">${esc(tfLabel(tf))}</td><td style="color:${col(x)};text-align:right">${emoji(x)}  ${word(x)}</td></tr>`;
        return `<table class="ud-tabla ud-smc-t ud-sz-${sz}">
            <tr class="ud-head"><td colspan="2" class="ud-titulo">${esc(v.smc_titleEmoji)}  ${esc(simbolo || '')}</td></tr>
            <tr class="ud-head"><td colspan="2" class="ud-sub">💎  SMC MARKET BIAS</td></tr>
            ${fila(v.smc_tf1, b1, 'rgba(16,16,16,.88)')}${fila(v.smc_tf2, b2, 'rgba(8,8,8,.88)')}${fila(v.smc_tf3, b3, 'rgba(16,16,16,.88)')}
            <tr><td colspan="2" style="background:rgba(138,43,226,.4);height:3px;padding:0"></td></tr>
            <tr class="ud-head"><td colspan="2" style="color:${g[2]};text-align:center">${g[0]}  ${g[1]}</td></tr></table>`;
    }

    // ─────────────────────────────── dashboards (tablas de TradingView) ───────────────────────────────
    // Tocar un dashboard lo minimiza a su título (en celular S/R e ICT arrancan minimizados).
    // Se guarda en las preferencias del usuario (viaja con el layout de la cuenta).
    let minimizados = null;
    function dashMinimizados() {
        if (!minimizados) {
            const guardado = NLTCharts.state.prefs().dashMin;
            minimizados = new Set(Array.isArray(guardado) ? guardado : (window.innerWidth < 768 ? ['sr', 'ict'] : []));
        }
        return minimizados;
    }

    // Cada tabla va en su espacio del tablero compartido (ui.tablero): se apila con las de otros
    // indicadores (ej. el panel del Zone Engine) en vez de taparlas.
    const DASHES = ['sr', 'ict', 'smc'];
    function slotDash(k, pos) {
        const el = NLTCharts.ui.tablero.slot(pos, `suite-${k}`);
        if (el && !el.dataset.oyente) {
            el.dataset.oyente = '1';
            el.addEventListener('click', (ev) => {
                const dsh = ev.target.closest('[data-dash]');
                if (!dsh) return;
                const mins = dashMinimizados();
                mins.has(k) ? mins.delete(k) : mins.add(k);
                NLTCharts.state.savePrefs({ dashMin: [...mins] });
                dsh.classList.toggle('ud-min', mins.has(k));
            });
        }
        return el;
    }

    let ultimoHTML = '';
    function pintarDashboards(dash, chart) {
        NLTCharts.ui.tablero.ajustar(chart);
        const firma = (dash && dash.firma) || '';
        if (firma === ultimoHTML) return;   // el DOM solo se toca si cambió el contenido
        ultimoHTML = firma;
        DASHES.forEach((k) => {
            const d = dash && dash[k];
            if (!d) { NLTCharts.ui.tablero.quitar(`suite-${k}`); return; }
            const el = slotDash(k, d.pos || 'Top Right');
            if (el) el.innerHTML = `<div class="ud-dash ${d.clase || ''}${dashMinimizados().has(k) ? ' ud-min' : ''}" data-dash="${k}" title="Tocá para minimizar o expandir">${d.html}</div>`;
        });
    }

    function limpiar() {
        ultimoHTML = '';
        DASHES.forEach((k) => NLTCharts.ui.tablero.quitar(`suite-${k}`));
    }

    // ─────────────────────────────── registro en el motor ───────────────────────────────
    const salidas = new Map();
    let registrado = false;
    function registrar() {
        if (registrado) return;
        registrado = true;
        NLTCharts.settings.registrar(ID, { titulo: 'NLT Unified Suite', inputs: INPUTS });
        klinecharts.registerIndicator({
            name: ID,
            shortName: 'NLT Unified',
            figures: [],
            calcParams: [0],
            calc: async (dataList, indicator) => {
                const salida = await calcularIncremental(indicator.id || ID, dataList, NLTCharts.settings.valores(ID));
                salidas.set(indicator.id || ID, { salida, velas: dataList });
                // No hace falta pedir redibujado: al terminar un calc async el motor ya
                // llama a layout({ update: true }). (Forzarlo con overrideIndicator
                // causaba un bucle de recálculos: medido con diag.js.)
                return dataList.map(() => ({}));
            },
            createTooltipDataSource: ({ indicator }) => ({ name: 'NLT Unified', calcParamsText: '', features: NLTCharts.leyenda.features(indicator), legends: [] }),
            draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
                const s0 = salidas.get(indicator.id || ID);
                if (!s0) return false;
                const vUsuario = NLTCharts.settings.valores(ID);
                paleta.v = vUsuario;
                const nueva = salidaVisual(indicator.id || ID, s0.velas, vUsuario);
                if (nueva) s0.salida = nueva;
                const { salida, velas } = s0;
                const L = P.lienzo(ctx, chart, bounding, xAxis, yAxis);
                const { from, to } = chart.getVisibleRange();
                ctx.save();
                // bgcolor (sesiones): cada capa en tramos continuos, un solo rectángulo por
                // tramo (rectángulos por vela se superponen y la transparencia se duplica)
                for (let capa = 0; capa < 3; capa++) {
                    let ini = -1, colIni = null;
                    const fin = Math.min(to, salida.bg.length);
                    for (let i = Math.max(0, from); i <= fin; i++) {
                        const col = i < fin && salida.bg[i] ? salida.bg[i][capa] : null;
                        const igual = col && colIni && P.mismoColor(col, colIni);
                        if (ini >= 0 && !igual) { P.fondo(L, ini, i - 1, colIni); ini = -1; colIni = null; }
                        if (col && ini < 0) { ini = i; colIni = col; }
                    }
                }
                salida.boxes.forEach((bx) => { if ((bx.extendRight || bx.right >= from) && bx.left <= to + 40) P.caja(L, bx); });
                salida.lines.forEach((ln) => { if (Math.max(ln.x1, ln.x2) >= from - 1 && Math.min(ln.x1, ln.x2) <= to + 40) P.linea(L, ln); });
                for (let i = Math.max(0, from); i < Math.min(to, velas.length); i++) {
                    if (salida.barColor[i]) P.pintarVela(L, velas[i], i, salida.barColor[i]);
                }
                salida.labels.forEach((lb) => { if (lb.x >= from - 5 && lb.x <= to + 40) P.etiqueta(L, lb, velas); });
                ctx.restore();
                pintarDashboards({ ...salida.dash, firma: salida.dashFirma }, chart);
                return false;
            },
        });
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.unified = {
        ID, INPUTS, registrar, limpiar, calcular, calcularIncremental, stats,
        // NLT Bar Replay: las velas HTF guardadas del vivo (o de la vela anterior del replay) no sirven
        limpiarCache() { genHTF += 1; cacheHTF.clear(); htfEnVuelo.clear(); },
        setContexto({ symbol, pricePrecision }) {
            if (symbol !== simbolo) cacheHTF.clear();
            simbolo = symbol;
            if (pricePrecision != null) precision = pricePrecision;
        },
        // para tests en el navegador
        _smcStruct: smcStruct, _mapearHTF: mapearHTF,
    };
})();
