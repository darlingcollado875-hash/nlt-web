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

    // ─────────────────────────────── contexto (símbolo, velas HTF) ───────────────────────────────
    let simbolo = null, precision = 5;
    const cacheHTF = new Map();
    async function velasHTF(tfNLT) {
        const k = `${simbolo}|${tfNLT}`;
        const c0 = cacheHTF.get(k);
        if (c0 && Date.now() - c0.t < 60000) return c0.v;
        const r = await NLTCharts.market.velas(simbolo, tfNLT, { limit: 1500 });
        cacheHTF.set(k, { t: Date.now(), v: r.velas });
        return r.velas;
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

    // ─────────────────────────────── cálculo principal ───────────────────────────────
    async function calcular(d, v) {
        const N = d.length;
        const o = { boxes: [], lines: [], labels: [], bg: [], barColor: new Array(N).fill(null), dash: {} };
        if (!N) return o;
        const high = d.map((x) => x.high), low = d.map((x) => x.low);
        const AT = (arr, i, k) => (i - k >= 0 ? arr[i - k] : null);
        const op = (i, k) => (i - k >= 0 ? d[i - k].open : null);
        const cl = (i, k) => (i - k >= 0 ? d[i - k].close : null);
        const hi = (i, k) => AT(high, i, k), lo = (i, k) => AT(low, i, k);
        const gt = (a, x) => a !== null && x !== null && a > x;
        const lt = (a, x) => a !== null && x !== null && a < x;
        const dif = (a, x) => (a === null || x === null ? null : a - x);   // na - x = na (en JS null - x daría un número)
        const fueraLineas = [], fueraLabels = [];   // objetos "fire and forget" (máx. 500, como TradingView)
        const push500 = (arr, x) => { arr.push(x); if (arr.length > 500) arr.shift(); };

        // ── ① S/R ──
        const atrS = P.atr(d, v.srp_atrLength);
        const srpPH = P.pivots(high, v.srp_pivotLookback, v.srp_pivotLookback, true);
        const srpPL = P.pivots(low, v.srp_pivotLookback, v.srp_pivotLookback, false);
        let zones = [];
        let lastBreak = 'Ninguno';
        let activeCount = 0, closestSup = null, closestRes = null;

        function addZone(price, isSup, pivotBar, width, atrVal) {
            const top = width === null ? null : price + width / 2;
            const bottom = width === null ? null : price - width / 2;
            let merge = false;
            for (const z of zones) {
                if (z.isSupport === isSup && !z.isBroken && atrVal !== null && Math.abs(z.midPrice - price) <= atrVal * v.srp_mergeThreshold) { merge = true; break; }
            }
            if (!merge) zones.push({ top, bottom, midPrice: price, startBar: pivotBar, isSupport: isSup, testCount: 1, lastTestBar: pivotBar, isBroken: false, isRetested: false, breakBar: 0, closesOut: 0 });
        }

        // ── ② BOS & CHoCH ──
        const bosPH = P.pivots(high, v.bos_length, v.bos_length, true);
        const bosPL = P.pivots(low, v.bos_length, v.bos_length, false);
        let swHP = null, swHI = null, swLP = null, swLI = null, trend = 0;
        const bosLinea = (x1, y1, x2, y2, color, txt) => {
            push500(fueraLineas, { x1, y1, x2, y2, color, style: 'solid', width: 1 });
            if (v.bos_showLabels) push500(fueraLabels, { x: Math.trunc((x1 + x2) / 2), y: y1, text: txt, style: 'down', color: P.col('#FFFFFF', 100), textColor: color, size: 'tiny' });
        };

        // ── ③ ICT Pro ──
        const TZ = -5; // "UTC-5", huso fijo
        const inSOD = d.map((x) => P.enSesion(x.timestamp, v.i_sodTime, TZ));
        const inLon = d.map((x) => P.enSesion(x.timestamp, v.i_lonTime, TZ));
        const inNYC = d.map((x) => P.enSesion(x.timestamp, v.i_nycTime, TZ));
        let bullFVGs = [], bearFVGs = [], bullOBs = [], bearOBs = [], bullMid = [], bearMid = [];
        const extRight = !v.i_simple;
        const trim = (arr, maxN) => { while (arr.length > maxN) arr.shift(); };
        const liqPH = P.pivots(high, v.i_liqLen, v.i_liqLen, true);
        const liqPL = P.pivots(low, v.i_liqLen, v.i_liqLen, false);
        let lastBSL = null, lastSSL = null, bslLine = null, sslLine = null, bslLbl = null, sslLbl = null;
        const barc = [new Array(N).fill(null), new Array(N).fill(null), new Array(N).fill(null)];
        const fvgFlag = (i) => ({
            bull: i >= 2 && low[i] - high[i - 2] > 0 && op(i, 1) < cl(i, 1),
            bear: i >= 2 && low[i - 2] - high[i] > 0 && op(i, 1) > cl(i, 1),
        });

        // HTF FVG (apagado por defecto): series en la temporalidad mayor, mapeadas como request.security
        const htf = [];
        for (const [on, tfIn, bb, brb, bf, brf, nombre] of [
            [v.i_htf1On, v.i_htf1, v.i_h1BB, v.i_h1BrB, v.i_h1BF, v.i_h1BrF, 'HTF1 FVG'],
            [v.i_htf2On, v.i_htf2, v.i_h2BB, v.i_h2BrB, v.i_h2BF, v.i_h2BrF, 'HTF2 FVG'],
        ]) {
            if (!v.m3_on || !on || !simbolo) { htf.push(null); continue; }
            let hv = [];
            try { hv = await velasHTF(HTF_A_NLT[tfIn]); } catch (_) { hv = []; }
            const bull = [], bear = [], bTop = [], bBot = [], rTop = [], rBot = [];
            let vbT = null, vbB = null, vrT = null, vrB = null;
            hv.forEach((x, j) => {
                const bu = j >= 2 && x.low - hv[j - 2].high > 0 && hv[j - 1].open < hv[j - 1].close;
                const be = j >= 2 && hv[j - 2].low - x.high > 0 && hv[j - 1].open > hv[j - 1].close;
                if (bu) { vbT = hv[j - 2].high; vbB = x.low; }
                if (be) { vrT = x.high; vrB = hv[j - 2].low; }
                bull.push(bu); bear.push(be); bTop.push(vbT); bBot.push(vbB); rTop.push(vrT); rBot.push(vrB);
            });
            htf.push({
                bull: mapearHTF(d, hv, bull), bear: mapearHTF(d, hv, bear), bTop: mapearHTF(d, hv, bTop), bBot: mapearHTF(d, hv, bBot),
                rTop: mapearHTF(d, hv, rTop), rBot: mapearHTF(d, hv, rBot), bb, brb, bf, brf, nombre, boxes: [],
            });
        }

        // ── ④ debug (estructura del TF del gráfico) ──
        const smcPH = P.pivots(high, v.smc_swingLen, v.smc_swingLen, true);
        const smcPL = P.pivots(low, v.smc_swingLen, v.smc_swingLen, false);
        let dHi = null, dLo = null, dHiBroken = false, dLoBroken = false, dBias = 0;

        for (let i = 0; i < N; i++) {
            const bar = d[i];
            // ===== ① =====
            activeCount = 0; closestSup = null; closestRes = null;   // no son `var`: se reinician en cada vela
            if (v.m1_on) {
                const atrVal = atrS[i];
                const calcW = atrVal === null && v.srp_zoneWidthMode === 'ATR' ? null
                    : v.srp_zoneWidthMode === 'ATR' ? atrVal * v.srp_zoneWidthMult : bar.close * v.srp_zoneWidthMult * 0.001;
                const maxW = atrVal === null ? null : atrVal * v.srp_maxZoneWidth;
                const finalW = calcW === null || maxW === null ? null : Math.min(calcW, maxW);
                if (srpPH[i] !== null) addZone(srpPH[i], false, i - v.srp_pivotLookback, finalW, atrVal);
                if (srpPL[i] !== null) addZone(srpPL[i], true, i - v.srp_pivotLookback, finalW, atrVal);

                if (zones.length > 0) {
                    let supCount = 0, resCount = 0;
                    for (let k = zones.length - 1; k >= 0; k--) {
                        const z = zones[k];
                        let quitar = false;
                        if (z.isBroken) {
                            if (!v.srp_keepBroken || (i - z.breakBar > v.srp_maxBrokenAge)) quitar = true;
                        } else if (z.isSupport) {
                            supCount += 1; if (supCount > v.srp_maxZonesPerType) quitar = true;
                        } else {
                            resCount += 1; if (resCount > v.srp_maxZonesPerType) quitar = true;
                        }
                        if (quitar) { zones.splice(k, 1); continue; }
                        const buffer = atrVal === null ? null : atrVal * v.srp_breakBufferMult;
                        if (!z.isBroken) {
                            activeCount += 1;
                            if (z.isSupport && z.midPrice <= bar.close) closestSup = closestSup === null ? z.midPrice : Math.max(closestSup, z.midPrice);
                            else if (!z.isSupport && z.midPrice >= bar.close) closestRes = closestRes === null ? z.midPrice : Math.min(closestRes, z.midPrice);
                            const touched = buffer !== null && z.bottom !== null && bar.high >= z.bottom - buffer && bar.low <= z.top + buffer;
                            if (touched && (i - z.lastTestBar >= v.srp_minBarsBetween)) { z.testCount += 1; z.lastTestBar = i; }
                            const closedOut = buffer !== null && z.bottom !== null && (z.isSupport ? bar.close < z.bottom - buffer : bar.close > z.top + buffer);
                            z.closesOut = closedOut ? z.closesOut + 1 : 0;
                            if (z.closesOut >= v.srp_breakCloses) { z.isBroken = true; z.breakBar = i; lastBreak = z.isSupport ? 'Bearish' : 'Bullish'; }
                        } else if (!z.isRetested) {
                            const retested = (z.isSupport && bar.high >= z.bottom) || (!z.isSupport && bar.low <= z.top);
                            if (retested) {
                                z.isRetested = true;
                                push500(fueraLabels, { x: i, y: z.isSupport ? bar.high : bar.low, text: 'retest', style: z.isSupport ? 'down' : 'up', color: P.col('#2962FF', 20), textColor: P.col('#FFFFFF', 0), size: 'tiny' });
                            }
                        }
                    }
                }
            }

            // ===== ② =====
            if (v.m2_on) {
                if (bosPH[i] !== null) { swHP = high[i - v.bos_length]; swHI = i - v.bos_length; }
                if (bosPL[i] !== null) { swLP = low[i - v.bos_length]; swLI = i - v.bos_length; }
                if (swHP !== null && bar.close > swHP) {
                    bosLinea(swHI, swHP, i, swHP, v.bos_colBull, trend === -1 ? 'CHoCH' : 'BOS');
                    trend = 1; swHP = null;
                }
                if (swLP !== null && bar.close < swLP) {
                    bosLinea(swLI, swLP, i, swLP, v.bos_colBear, trend === 1 ? 'CHoCH' : 'BOS');
                    trend = -1; swLP = null;
                }
            }

            // ===== ③ =====
            const capas = [];
            if (v.m3_on && v.i_showSOD && inSOD[i]) capas.push(v.i_sodCol);
            if (v.m3_on && v.i_showLon && inLon[i]) capas.push(v.i_lonCol);
            if (v.m3_on && v.i_showNYC && inNYC[i]) capas.push(v.i_nycCol);
            o.bg.push(capas);
            const aperturas = [
                [v.i_showSOD && inSOD[i] && !(i > 0 && inSOD[i - 1]), '#2962FF'],
                [v.i_showLon && inLon[i] && !(i > 0 && inLon[i - 1]), '#4CAF50'],
                [v.i_showNYC && inNYC[i] && !(i > 0 && inNYC[i - 1]), '#FF6D00'],
            ];
            aperturas.forEach(([abre, hex]) => {
                if (v.m3_on && v.i_sessLines && abre) push500(fueraLineas, { x1: i, y1: bar.low * 0.999, x2: i, y2: bar.high * 1.001, color: P.col(hex, 40), style: 'dashed', width: 1 });
            });

            const mitLow = v.i_mit === 'Close' ? cl(i, 1) : bar.low;
            const mitHigh = v.i_mit === 'Close' ? cl(i, 1) : bar.high;
            const f = fvgFlag(i);

            if (v.m3_on && f.bull && v.i_showFVG) {
                bullFVGs.push({ left: i - 2, top: high[i - 2], right: i, bottom: bar.low, border: v.i_simple ? P.col(C.BULL, 75) : v.i_fvgBullB, bg: v.i_fvgBullF, text: 'FVG', textColor: P.col(C.WHITE, 40), textSize: 'tiny', extendRight: extRight });
                trim(bullFVGs, v.i_maxBoxes);
            }
            if (v.m3_on && f.bear && v.i_showFVG) {
                bearFVGs.push({ left: i - 2, top: low[i - 2], right: i, bottom: bar.high, border: v.i_simple ? P.col(C.BEAR, 75) : v.i_fvgBearB, bg: v.i_fvgBearF, text: 'FVG', textColor: P.col(C.WHITE, 40), textSize: 'tiny', extendRight: extRight });
                trim(bearFVGs, v.i_maxBoxes);
            }
            // Nota: igual que en el .pine, para el FVG alcista box.new(..., top=high[2], ..., bottom=low) deja
            // "top" por debajo de "bottom", así que rng < 0 y el color dinámico nunca se aplica a los alcistas.
            if (v.m3_on) {
                for (let k = bullFVGs.length - 1; k >= 0; k--) {
                    const bx = bullFVGs[k], rng = bx.top - bx.bottom;
                    if (v.i_fvgDyn && rng > 0 && bar.close > bx.bottom && bar.close < bx.top + rng * 0.3) { bx.border = v.i_fvgNearB; bx.bg = v.i_fvgNearF; }
                    if (!v.i_simple && lt(mitLow, bx.bottom)) { bx.right = i; bx.extendRight = false; bullFVGs.splice(k, 1); if (!v.i_delFVG) push500(fueraLineas, { caja: bx }); }
                }
                for (let k = bearFVGs.length - 1; k >= 0; k--) {
                    const bx = bearFVGs[k], rng = bx.top - bx.bottom;
                    if (v.i_fvgDyn && rng > 0 && bar.close < bx.top && bar.close > bx.bottom - rng * 0.3) { bx.border = v.i_fvgNearB; bx.bg = v.i_fvgNearF; }
                    if (!v.i_simple && gt(mitHigh, bx.top)) { bx.right = i; bx.extendRight = false; bearFVGs.splice(k, 1); if (!v.i_delFVG) push500(fueraLineas, { caja: bx }); }
                }
            }

            // Order Blocks
            const b2 = gt(op(i, 2), cl(i, 2)), b3 = gt(op(i, 3), cl(i, 3)), b4 = gt(op(i, 4), cl(i, 4));   // vela bajista k atrás
            const u2 = lt(op(i, 2), cl(i, 2)), u3 = lt(op(i, 3), cl(i, 3)), u4 = lt(op(i, 4), cl(i, 4));   // vela alcista k atrás
            const obBullN = f.bull && b2 && gt(cl(i, 1), hi(i, 2));
            const le = (a, x) => a !== null && x !== null && a <= x, ge = (a, x) => a !== null && x !== null && a >= x;
            const obBullC1 = f.bull && le(op(i, 2), cl(i, 2)) && b3 && gt(cl(i, 1), hi(i, 3)) && !b2;
            const obBullC2 = f.bull && le(op(i, 2), cl(i, 2)) && le(op(i, 3), cl(i, 3)) && b4 && gt(cl(i, 1), hi(i, 4)) && !b2 && !b3;
            const noFC1 = !(gt(dif(lo(i, 1), hi(i, 3)), 0) && b3);
            const noFC2 = !(gt(dif(lo(i, 1), hi(i, 3)), 0) && b3) && !(gt(dif(lo(i, 2), hi(i, 4)), 0) && b4);
            const obBearN = f.bear && u2 && lt(cl(i, 1), lo(i, 2));
            const obBearC1 = f.bear && ge(op(i, 2), cl(i, 2)) && u3 && lt(cl(i, 1), lo(i, 3)) && !u2;
            const obBearC2 = f.bear && ge(op(i, 2), cl(i, 2)) && ge(op(i, 3), cl(i, 3)) && u4 && lt(cl(i, 1), lo(i, 4)) && !u2 && !u3;
            const noBFC1 = !(gt(dif(lo(i, 3), hi(i, 1)), 0) && u3);
            const noBFC2 = !(gt(dif(lo(i, 3), hi(i, 1)), 0) && u3) && !(gt(dif(lo(i, 4), hi(i, 2)), 0) && u4);

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
                if (obBullN) nuevoOB(bullOBs, bullMid, 2, 'Naked OB', v.i_obBullB, v.i_obBullF, C.CYAN);
                if (obBullC1 && noFC1) nuevoOB(bullOBs, bullMid, 3, 'Covered OB', v.i_obBullB, v.i_obBullF, C.CYAN);
                if (obBullC2 && noFC2) nuevoOB(bullOBs, bullMid, 4, 'Covered OB', v.i_obBullB, v.i_obBullF, C.CYAN);
                if (obBearN) nuevoOB(bearOBs, bearMid, 2, 'Naked OB', v.i_obBearB, v.i_obBearF, C.PURPLE);
                if (obBearC1 && noBFC1) nuevoOB(bearOBs, bearMid, 3, 'Covered OB', v.i_obBearB, v.i_obBearF, C.PURPLE);
                if (obBearC2 && noBFC2) nuevoOB(bearOBs, bearMid, 4, 'Covered OB', v.i_obBearB, v.i_obBearF, C.PURPLE);
            }
            if (v.m3_on && !v.i_simple) {
                for (let k = bullOBs.length - 1; k >= 0; k--) {
                    const bx = bullOBs[k];
                    if (lt(mitLow, bx.bottom)) { bx.right = i; bx.extendRight = false; bullOBs.splice(k, 1); if (!v.i_delOB) push500(fueraLineas, { caja: bx }); }
                }
                for (let k = bearOBs.length - 1; k >= 0; k--) {
                    const bx = bearOBs[k];
                    if (gt(mitHigh, bx.top)) { bx.right = i; bx.extendRight = false; bearOBs.splice(k, 1); if (!v.i_delOB) push500(fueraLineas, { caja: bx }); }
                }
            }
            // barcolor con offset -2 / -3 / -4 (el último barcolor gana)
            if (v.m3_on && v.i_colOBbar) {
                if (obBullN) barc[0][i - 2] = v.i_obBullC; else if (obBearN) barc[0][i - 2] = v.i_obBearC;
                if (obBullC1 && noFC1) barc[1][i - 3] = v.i_obBullC; else if (obBearC1 && noBFC1) barc[1][i - 3] = v.i_obBearC;
                if (obBullC2 && noFC2) barc[2][i - 4] = v.i_obBullC; else if (obBearC2 && noBFC2) barc[2][i - 4] = v.i_obBearC;
            }

            // Liquidez
            if (v.m3_on && v.i_showLiq && liqPH[i] !== null) {
                lastBSL = liqPH[i];
                bslLine = { x1: i - v.i_liqLen, y1: lastBSL, x2: i + 30, y2: lastBSL, color: P.conT(v.i_bslCol, 50), style: 'dotted', width: 2 };
                bslLbl = { x: i - v.i_liqLen, y: lastBSL, text: 'BSL', style: 'right', color: P.conT(v.i_bslCol, 80), textColor: v.i_bslCol, size: 'tiny' };
            }
            if (v.m3_on && v.i_showLiq && liqPL[i] !== null) {
                lastSSL = liqPL[i];
                sslLine = { x1: i - v.i_liqLen, y1: lastSSL, x2: i + 30, y2: lastSSL, color: P.conT(v.i_sslCol, 50), style: 'dotted', width: 2 };
                sslLbl = { x: i - v.i_liqLen, y: lastSSL, text: 'SSL', style: 'right', color: P.conT(v.i_sslCol, 80), textColor: v.i_sslCol, size: 'tiny' };
            }
            const bullSweep = v.m3_on && v.i_showLiq && lastSSL !== null && bar.low < lastSSL && bar.close > lastSSL;
            const bearSweep = v.m3_on && v.i_showLiq && lastBSL !== null && bar.high > lastBSL && bar.close < lastBSL;
            if (bullSweep) { push500(fueraLabels, { x: i, y: bar.low, text: '⚡ SSL Swept', style: 'up', color: P.col(C.GOLD, 70), textColor: P.col(C.GOLD, 0), size: 'small' }); lastSSL = null; }
            if (bearSweep) { push500(fueraLabels, { x: i, y: bar.high, text: '⚡ BSL Swept', style: 'down', color: P.col(C.GOLD, 70), textColor: P.col(C.GOLD, 0), size: 'small' }); lastBSL = null; }

            // HTF FVG
            htf.forEach((h) => {
                if (!h) return;
                if (h.bull[i] && h.bBot[i] !== null) { h.boxes.push({ left: i, bottom: h.bBot[i], top: h.bTop[i], right: N - 1 + 20, border: h.bb, bg: h.bf, text: h.nombre, textColor: P.col(C.WHITE, 40), textSize: 'tiny', halign: 'right', extendRight: true }); trim(h.boxes, 5); }
                if (h.bear[i] && h.rBot[i] !== null) { h.boxes.push({ left: i, bottom: h.rBot[i], top: h.rTop[i], right: N - 1 + 20, border: h.brb, bg: h.brf, text: h.nombre, textColor: P.col(C.WHITE, 40), textSize: 'tiny', halign: 'right', extendRight: true }); trim(h.boxes, 5); }
            });

            // ===== ④ debug =====
            if (v.m4_on) {
                if (smcPH[i] !== null) {
                    dHi = smcPH[i]; dHiBroken = false;
                    if (v.smc_showDebug) push500(fueraLineas, { x1: i - v.smc_swingLen, y1: dHi, x2: i, y2: dHi, color: P.col('#8A2BE2', 15), style: 'dotted', width: 1 });
                }
                if (smcPL[i] !== null) {
                    dLo = smcPL[i]; dLoBroken = false;
                    if (v.smc_showDebug) push500(fueraLineas, { x1: i - v.smc_swingLen, y1: dLo, x2: i, y2: dLo, color: P.col('#00FF00', 15), style: 'dotted', width: 1 });
                }
                if (dHi !== null && bar.close > dHi && !dHiBroken) {
                    dHiBroken = true;
                    const choch = dBias === -1; dBias = 1;
                    if (v.smc_showDebug) push500(fueraLabels, { x: i, y: bar.high, yloc: 'abovebar', text: choch ? 'CHOCH' : 'BOS', style: 'down', color: P.col('#000000', 15), textColor: P.col('#00FF00', 0), size: 'small' });
                }
                if (dLo !== null && bar.close < dLo && !dLoBroken) {
                    dLoBroken = true;
                    const choch = dBias === 1; dBias = -1;
                    if (v.smc_showDebug) push500(fueraLabels, { x: i, y: bar.low, yloc: 'belowbar', text: choch ? 'CHOCH' : 'BOS', style: 'up', color: P.col('#000000', 15), textColor: P.col('#8A2BE2', 0), size: 'small' });
                }
            }
        }

        // ── armar la salida con el estado de la última vela (como los objetos de TradingView) ──
        const ultima = N - 1;
        if (v.m1_on) {
            zones.forEach((z) => {
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
            if (v.srp_showDashboard) {
                o.dash.sr = {
                    pos: v.srp_dashPositionIn,
                    html: tablaSR(closestRes, closestSup, lastBreak, activeCount),
                };
            }
        }
        fueraLineas.forEach((x) => (x.caja ? o.boxes.push(x.caja) : o.lines.push(x)));
        o.boxes.push(...bullFVGs, ...bearFVGs, ...bullOBs, ...bearOBs);
        htf.forEach((h) => h && o.boxes.push(...h.boxes));
        o.lines.push(...bullMid, ...bearMid);
        [bslLine, sslLine].forEach((l) => l && o.lines.push(l));
        o.labels.push(...fueraLabels);
        [bslLbl, sslLbl].forEach((l) => l && o.labels.push(l));
        for (let i = 0; i < N; i++) o.barColor[i] = barc[2][i] || barc[1][i] || barc[0][i];

        if (v.m3_on && v.i_showDash) {
            const sesion = inSOD[ultima] ? 'Start of Day 🔵' : inLon[ultima] ? 'London 🟢' : inNYC[ultima] ? 'New York 🟠' : 'Off-Hours ⚫';
            const hb = htf.map((h) => (h ? !!h.bull[ultima] : false)), hr = htf.map((h) => (h ? !!h.bear[ultima] : false));
            const anyB = hb[0] || hb[1], anyR = hr[0] || hr[1];
            const sesgo = anyB && !anyR ? 'Bullish 🟢' : anyR && !anyB ? 'Bearish 🔴' : 'Neutral ⚪';
            const fmt = (x) => (x === null ? 'Swept' : x.toFixed(precision));
            o.dash.ict = {
                pos: v.i_dashPos,
                html: `<pre class="ud-pre">╔══ ICT PRO ══════════════╗\n║ Session : ${sesion}\n║ HTF Bias: ${sesgo}\n║ Bull OBs: ${bullOBs.length}  Bear OBs: ${bearOBs.length}\n║ Bull FVG: ${bullFVGs.length}  Bear FVG: ${bearFVGs.length}\n║ BSL: ${fmt(lastBSL)}  SSL: ${fmt(lastSSL)}\n╚═════════════════════════╝</pre>`,
                clase: 'ud-ict',
            };
        }

        if (v.m4_on && simbolo) {
            const sesgos = [];
            for (const tf of [v.smc_tf1, v.smc_tf2, v.smc_tf3]) {
                try {
                    const hv = await velasHTF(TF_A_NLT[tf]);
                    // s[1] con lookahead_off en la vela en curso = evento tras la última vela HTF cerrada
                    const cerradas = hv.slice(0, -1);
                    const ev = cerradas.length ? smcStruct(cerradas, v.smc_swingLen).pop() : 0;
                    sesgos.push(ev > 0 ? 1 : ev < 0 ? -1 : 0);
                } catch (_) { sesgos.push(0); }
            }
            o.dash.smc = { pos: { 'Inferior Derecha': 'Bottom Right', 'Inferior Izquierda': 'Bottom Left', 'Superior Derecha': 'Top Right', 'Superior Izquierda': 'Top Left' }[v.smc_posInput], html: tablaSMC(v, sesgos), clase: 'ud-smc' };
        }
        return o;
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
    const CLAVE_MIN = 'nlt_charts_dash_min_v1';
    let minimizados;
    try { minimizados = new Set(JSON.parse(localStorage.getItem(CLAVE_MIN) || 'null') || (window.innerWidth < 768 ? ['sr', 'ict'] : [])); }
    catch (_) { minimizados = new Set(window.innerWidth < 768 ? ['sr', 'ict'] : []); }

    let host = null;
    function hostDashboards() {
        if (host && document.body.contains(host)) return host;
        const stage = document.querySelector('.ch-stage');
        if (!stage) return null;
        host = document.createElement('div');
        host.className = 'ud-host';
        host.innerHTML = ['Top Left', 'Top Right', 'Bottom Left', 'Bottom Right'].map((p) => `<div class="ud-esq" data-pos="${p}"></div>`).join('');
        host.addEventListener('click', (ev) => {
            const dsh = ev.target.closest('[data-dash]');
            if (!dsh) return;
            const k = dsh.dataset.dash;
            minimizados.has(k) ? minimizados.delete(k) : minimizados.add(k);
            try { localStorage.setItem(CLAVE_MIN, JSON.stringify([...minimizados])); } catch (_) { /* sin almacenamiento */ }
            dsh.classList.toggle('ud-min', minimizados.has(k));
        });
        stage.appendChild(host);
        return host;
    }

    let ultimoHTML = '';
    function pintarDashboards(dash, chart) {
        const h = hostDashboards();
        if (!h) return;
        // Dentro del panel de velas (sin tapar ejes ni sub-paneles)
        const main = chart.getSize('candle_pane', 'main');
        if (main) {
            h.style.left = `${main.left}px`;
            h.style.top = `${main.top}px`;
            h.style.width = `${main.width}px`;
            h.style.height = `${main.height}px`;
        }
        const porPos = { 'Top Left': [], 'Top Right': [], 'Bottom Left': [], 'Bottom Right': [] };
        ['sr', 'ict', 'smc'].forEach((k) => { if (dash && dash[k]) porPos[dash[k].pos || 'Top Right'].push(`<div class="ud-dash ${dash[k].clase || ''}${minimizados.has(k) ? ' ud-min' : ''}" data-dash="${k}" title="Tocá para minimizar o expandir">${dash[k].html}</div>`); });
        const html = JSON.stringify(porPos);
        if (html === ultimoHTML) return;
        ultimoHTML = html;
        h.querySelectorAll('.ud-esq').forEach((e) => { e.innerHTML = porPos[e.dataset.pos].join(''); });
    }

    function limpiar() {
        ultimoHTML = '';
        if (host) host.querySelectorAll('.ud-esq').forEach((e) => { e.innerHTML = ''; });
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
                const salida = await calcular(dataList, NLTCharts.settings.valores(ID));
                salidas.set(indicator.id || ID, { salida, velas: dataList });
                // El cálculo es async (velas HTF): al terminar se pide un redibujado
                // (extendData solo redibuja, no vuelve a calcular: no hay bucle).
                requestAnimationFrame(() => {
                    const m = NLTCharts.motor;
                    if (m) m.chart.overrideIndicator({ name: ID, extendData: Date.now() });
                });
                return dataList.map(() => ({}));
            },
            createTooltipDataSource: () => ({ name: 'NLT Unified', calcParamsText: '', features: [], legends: [] }),
            draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
                const s0 = salidas.get(indicator.id || ID);
                if (!s0) return false;
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
                        const igual = col && colIni && col.hex === colIni.hex && col.t === colIni.t;
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
                pintarDashboards(salida.dash, chart);
                return false;
            },
        });
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.unified = {
        ID, INPUTS, registrar, limpiar, calcular,
        setContexto({ symbol, pricePrecision }) {
            if (symbol !== simbolo) cacheHTF.clear();
            simbolo = symbol;
            if (pricePrecision != null) precision = pricePrecision;
        },
        // para tests en el navegador
        _smcStruct: smcStruct, _mapearHTF: mapearHTF,
    };
})();
