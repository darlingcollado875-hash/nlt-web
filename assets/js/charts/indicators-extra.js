/* NLT Charts -- indicadores adicionales (estilo TradingView) y las funciones de cálculo que comparte el panel
 * "Análisis técnico" (ratings.js).
 *
 * Se calculan en el navegador, igual que los demás indicadores gratis. Los que KLineChart ya trae (AO, Momentum,
 * ADX/DMI, OBV, ROC, TRIX) solo se agregan al panel; los demás se registran acá como indicadores propios:
 *   sobre el precio: VWAP, Hull MA, Keltner, Donchian, Supertrend, Ichimoku, Pivot Points
 *   en panel propio: ATR, MFI, Stoch RSI
 * Entran por el mismo camino que los clásicos de indicators.js (entradas, colores, grosores, visibilidad,
 * favoritos y plantillas), así que no hay código de interfaz nuevo acá. */
(function () {
    // ───────────── matemática sobre arrays (null = sin dato) ─────────────
    const num = (x) => x != null && Number.isFinite(x);
    function sma(v, n) {
        const out = new Array(v.length).fill(null); let s = 0, c = 0;
        for (let i = 0; i < v.length; i++) {
            if (num(v[i])) { s += v[i]; c++; }
            if (i >= n && num(v[i - n])) { s -= v[i - n]; c--; }
            if (i >= n - 1 && c === n) out[i] = s / n;
        }
        return out;
    }
    function ema(v, n, k = 2 / (n + 1)) {
        const out = new Array(v.length).fill(null); let prev = null, buf = [];
        for (let i = 0; i < v.length; i++) {
            if (!num(v[i])) continue;
            if (prev == null) { buf.push(v[i]); if (buf.length === n) { prev = buf.reduce((a, b) => a + b, 0) / n; out[i] = prev; } continue; }
            prev = v[i] * k + prev * (1 - k); out[i] = prev;
        }
        return out;
    }
    const rma = (v, n) => ema(v, n, 1 / n);   // media de Wilder
    function wma(v, n) {
        const out = new Array(v.length).fill(null); const den = (n * (n + 1)) / 2;
        for (let i = n - 1; i < v.length; i++) {
            let s = 0, ok = true;
            for (let j = 0; j < n; j++) { const x = v[i - j]; if (!num(x)) { ok = false; break; } s += x * (n - j); }
            if (ok) out[i] = s / den;
        }
        return out;
    }
    function hma(v, n) {
        const a = wma(v, Math.max(1, Math.floor(n / 2))), b = wma(v, n);
        return wma(v.map((_, i) => (num(a[i]) && num(b[i]) ? 2 * a[i] - b[i] : null)), Math.max(1, Math.round(Math.sqrt(n))));
    }
    function highest(v, n) { return v.map((_, i) => { if (i < n - 1) return null; let m = -Infinity; for (let j = 0; j < n; j++) m = Math.max(m, v[i - j]); return m; }); }
    function lowest(v, n) { return v.map((_, i) => { if (i < n - 1) return null; let m = Infinity; for (let j = 0; j < n; j++) m = Math.min(m, v[i - j]); return m; }); }
    function tr(d) { return d.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - d[i - 1].close), Math.abs(x.low - d[i - 1].close)))); }
    const atr = (d, n) => rma(tr(d), n);
    const cierres = (d) => d.map((x) => x.close);

    function rsi(c, n = 14) {
        const up = [null], dn = [null];
        for (let i = 1; i < c.length; i++) { const ch = c[i] - c[i - 1]; up.push(Math.max(ch, 0)); dn.push(Math.max(-ch, 0)); }
        const a = rma(up, n), b = rma(dn, n);
        return c.map((_, i) => (num(a[i]) && num(b[i]) ? (b[i] === 0 ? 100 : 100 - 100 / (1 + a[i] / b[i])) : null));
    }
    function stoch(d, n = 14, ks = 3, ds = 3) {
        const hh = highest(d.map((x) => x.high), n), ll = lowest(d.map((x) => x.low), n);
        const raw = d.map((x, i) => (num(hh[i]) && hh[i] !== ll[i] ? ((x.close - ll[i]) / (hh[i] - ll[i])) * 100 : null));
        const k = sma(raw, ks); return { k, d: sma(k, ds) };
    }
    function stochRsi(c, n = 14, ks = 3, ds = 3, sn = 14) {
        const r = rsi(c, n), hh = highest(r.map((x) => (num(x) ? x : 0)), sn), ll = lowest(r.map((x) => (num(x) ? x : 0)), sn);
        const raw = r.map((x, i) => (num(x) && num(hh[i]) && hh[i] !== ll[i] && i >= n + sn ? ((x - ll[i]) / (hh[i] - ll[i])) * 100 : null));
        const k = sma(raw, ks); return { k, d: sma(k, ds) };
    }
    function cci(d, n = 20) {
        const tp = d.map((x) => (x.high + x.low + x.close) / 3), m = sma(tp, n);
        return tp.map((x, i) => { if (!num(m[i])) return null; let s = 0; for (let j = 0; j < n; j++) s += Math.abs(tp[i - j] - m[i]); const dm = s / n; return dm ? (x - m[i]) / (0.015 * dm) : 0; });
    }
    function williams(d, n = 14) {
        const hh = highest(d.map((x) => x.high), n), ll = lowest(d.map((x) => x.low), n);
        return d.map((x, i) => (num(hh[i]) && hh[i] !== ll[i] ? ((x.close - hh[i]) / (hh[i] - ll[i])) * 100 : null));
    }
    function adx(d, n = 14) {
        const pdm = [0], mdm = [0];
        for (let i = 1; i < d.length; i++) {
            const up = d[i].high - d[i - 1].high, dn = d[i - 1].low - d[i].low;
            pdm.push(up > dn && up > 0 ? up : 0); mdm.push(dn > up && dn > 0 ? dn : 0);
        }
        const a = rma(tr(d), n), p = rma(pdm, n), m = rma(mdm, n);
        const pdi = d.map((_, i) => (num(a[i]) && a[i] ? (100 * p[i]) / a[i] : null)), mdi = d.map((_, i) => (num(a[i]) && a[i] ? (100 * m[i]) / a[i] : null));
        const dx = d.map((_, i) => (num(pdi[i]) && pdi[i] + mdi[i] ? (100 * Math.abs(pdi[i] - mdi[i])) / (pdi[i] + mdi[i]) : null));
        return { pdi, mdi, adx: rma(dx, n) };
    }
    function ao(d) { const m = d.map((x) => (x.high + x.low) / 2), a = sma(m, 5), b = sma(m, 34); return m.map((_, i) => (num(a[i]) && num(b[i]) ? a[i] - b[i] : null)); }
    const mom = (c, n = 10) => c.map((x, i) => (i >= n ? x - c[i - n] : null));
    function macd(c, f = 12, s = 26, g = 9) {
        const a = ema(c, f), b = ema(c, s), line = c.map((_, i) => (num(a[i]) && num(b[i]) ? a[i] - b[i] : null));
        const sig = ema(line, g); return { line, sig };
    }
    function uo(d, a = 7, b = 14, c = 28) {
        const bp = d.map((x, i) => (i ? x.close - Math.min(x.low, d[i - 1].close) : null)), t = d.map((x, i) => (i ? Math.max(x.high, d[i - 1].close) - Math.min(x.low, d[i - 1].close) : null));
        const avg = (n) => { const sb = sma(bp, n), st = sma(t, n); return d.map((_, i) => (num(sb[i]) && num(st[i]) && st[i] ? sb[i] / st[i] : null)); };
        const A = avg(a), B = avg(b), C = avg(c);
        return d.map((_, i) => (num(A[i]) && num(B[i]) && num(C[i]) ? (100 * (4 * A[i] + 2 * B[i] + C[i])) / 7 : null));
    }
    function mfi(d, n = 14) {
        const tp = d.map((x) => (x.high + x.low + x.close) / 3), pos = [], neg = [];
        d.forEach((x, i) => { const f = tp[i] * (x.volume || 1); pos.push(i && tp[i] > tp[i - 1] ? f : 0); neg.push(i && tp[i] < tp[i - 1] ? f : 0); });
        const sp = d.map((_, i) => (i >= n ? pos.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) : null)), sn = d.map((_, i) => (i >= n ? neg.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) : null));
        return d.map((_, i) => (num(sp[i]) ? (sn[i] === 0 ? 100 : 100 - 100 / (1 + sp[i] / sn[i])) : null));
    }
    // VWAP de la sesión (se reinicia cada día UTC); sin volumen cuenta cada vela por igual.
    function vwap(d) {
        let dia = null, pv = 0, v = 0;
        return d.map((x) => {
            const k = Math.floor(x.timestamp / 86400000);
            if (k !== dia) { dia = k; pv = 0; v = 0; }
            const w = x.volume > 0 ? x.volume : 1; pv += ((x.high + x.low + x.close) / 3) * w; v += w;
            return pv / v;
        });
    }
    function supertrend(d, n = 10, m = 3) {
        const a = atr(d, n), up = new Array(d.length).fill(null), dn = new Array(d.length).fill(null);
        let bandaSup = null, bandaInf = null, tend = 1;
        d.forEach((x, i) => {
            if (!num(a[i])) return;
            const hl2 = (x.high + x.low) / 2, sup = hl2 + m * a[i], inf = hl2 - m * a[i];
            bandaSup = bandaSup == null || sup < bandaSup || d[i - 1].close > bandaSup ? sup : bandaSup;
            bandaInf = bandaInf == null || inf > bandaInf || d[i - 1].close < bandaInf ? inf : bandaInf;
            if (tend === 1 && x.close < bandaInf) tend = -1; else if (tend === -1 && x.close > bandaSup) tend = 1;
            if (tend === 1) up[i] = bandaInf; else dn[i] = bandaSup;
        });
        return { up, dn };
    }
    function ichimoku(d, tn = 9, kn = 26, sn = 52) {
        const mid = (n) => { const h = highest(d.map((x) => x.high), n), l = lowest(d.map((x) => x.low), n); return d.map((_, i) => (num(h[i]) ? (h[i] + l[i]) / 2 : null)); };
        const t = mid(tn), k = mid(kn), b = mid(sn);
        const spanA = d.map((_, i) => (i >= kn && num(t[i - kn]) && num(k[i - kn]) ? (t[i - kn] + k[i - kn]) / 2 : null));
        const spanB = d.map((_, i) => (i >= kn && num(b[i - kn]) ? b[i - kn] : null));
        const chikou = d.map((_, i) => (i + kn < d.length ? d[i + kn].close : null));
        return { t, k, spanA, spanB, chikou };
    }
    // Pivot Points clásicos del día anterior (UTC).
    function pivots(d) {
        const out = d.map(() => ({})); let ant = null, act = null;
        d.forEach((x, i) => {
            const dia = Math.floor(x.timestamp / 86400000);
            if (!act || act.dia !== dia) { ant = act; act = { dia, h: x.high, l: x.low, c: x.close }; } else { act.h = Math.max(act.h, x.high); act.l = Math.min(act.l, x.low); act.c = x.close; }
            if (ant) { const p = (ant.h + ant.l + ant.c) / 3; out[i] = { p, r1: 2 * p - ant.l, s1: 2 * p - ant.h, r2: p + (ant.h - ant.l), s2: p - (ant.h - ant.l) }; }
        });
        return out;
    }

    // ───────────── indicadores que se agregan al panel ─────────────
    const GRUPOS = [
        {
            titulo: 'NLT Basics · más sobre el precio',
            items: [
                { id: 'NLT_VWAP', nombre: 'VWAP', desc: 'Precio medio ponderado por volumen, se reinicia cada día', pane: 'candle', params: [], lineas: ['VWAP'] },
                { id: 'NLT_HMA', nombre: 'Hull MA', pane: 'candle', params: [['Período', 21]], lineas: ['HMA'] },
                { id: 'NLT_KELTNER', nombre: 'Canales de Keltner', pane: 'candle', params: [['EMA', 20], ['ATR', 10], ['Múltiplo', 2]], lineas: ['Superior', 'Media', 'Inferior'] },
                { id: 'NLT_DONCHIAN', nombre: 'Canales de Donchian', pane: 'candle', params: [['Período', 20]], lineas: ['Superior', 'Media', 'Inferior'] },
                { id: 'NLT_SUPERTREND', nombre: 'Supertrend', pane: 'candle', params: [['ATR', 10], ['Múltiplo', 3]], lineas: ['Alcista', 'Bajista'] },
                { id: 'NLT_ICHIMOKU', nombre: 'Nube de Ichimoku', pane: 'candle', params: [['Conversión', 9], ['Base', 26], ['Span B', 52]], lineas: ['Conversión', 'Base', 'Span A', 'Span B', 'Chikou'] },
                { id: 'NLT_PIVOTS', nombre: 'Pivot Points', desc: 'Clásicos del día anterior', pane: 'candle', params: [], lineas: ['Pivote', 'R1', 'S1', 'R2', 'S2'] },
            ],
        },
        {
            titulo: 'NLT Basics · más osciladores y volumen',
            items: [
                { id: 'NLT_ATR', nombre: 'ATR', pane: 'sub', params: [['Período', 14]], precision: 5, lineas: ['ATR'] },
                { id: 'NLT_MFI', nombre: 'Money Flow Index', pane: 'sub', params: [['Período', 14]], precision: 2, lineas: ['MFI'] },
                { id: 'NLT_STOCHRSI', nombre: 'Stochastic RSI', pane: 'sub', params: [['RSI', 14], ['Estocástico', 14], ['K', 3], ['D', 3]], precision: 2, lineas: ['%K', '%D'] },
                { id: 'DMI', nombre: 'ADX / DMI', pane: 'sub', params: [['Período', 14], ['ADXR', 6]], precision: 2, lineas: ['+DI', '−DI', 'ADX', 'ADXR'] },
                { id: 'AO', nombre: 'Awesome Oscillator', pane: 'sub', params: [['Rápida', 5], ['Lenta', 34]], precision: 5, lineas: [], barras: true },
                { id: 'MTM', nombre: 'Momentum', pane: 'sub', params: [['Período', 12], ['Media', 6]], precision: 5, lineas: ['Momentum', 'Media'] },
                { id: 'ROC', nombre: 'Rate of Change', pane: 'sub', params: [['Período', 12], ['Media', 6]], precision: 2, lineas: ['ROC', 'Media'] },
                { id: 'OBV', nombre: 'On-Balance Volume', pane: 'sub', params: [['Media', 30]], precision: 0, lineas: ['OBV', 'Media'] },
                { id: 'TRIX', nombre: 'TRIX', pane: 'sub', params: [['Período', 12], ['Media', 9]], precision: 4, lineas: ['TRIX', 'Media'] },
            ],
        },
    ];

    const linea = (key) => ({ key, title: `${key}: `, type: 'line' });
    function registrar() {
        const R = (def) => klinecharts.registerIndicator(def);
        const p = (ind, k, def) => (ind.calcParams && ind.calcParams[k] != null ? ind.calcParams[k] : def);
        R({ name: 'NLT_VWAP', shortName: 'VWAP', series: 'price', calcParams: [], figures: [linea('vwap')], calc: (d) => vwap(d).map((v) => ({ vwap: v })) });
        R({ name: 'NLT_HMA', shortName: 'HMA', series: 'price', calcParams: [21], figures: [linea('hma')], calc: (d, i) => hma(cierres(d), p(i, 0, 21)).map((v) => ({ hma: v })) });
        R({ name: 'NLT_KELTNER', shortName: 'KC', series: 'price', calcParams: [20, 10, 2], figures: [linea('up'), linea('mid'), linea('dn')],
            calc: (d, i) => { const m = ema(cierres(d), p(i, 0, 20)), a = atr(d, p(i, 1, 10)), k = p(i, 2, 2); return d.map((_, j) => (num(m[j]) && num(a[j]) ? { up: m[j] + k * a[j], mid: m[j], dn: m[j] - k * a[j] } : {})); } });
        R({ name: 'NLT_DONCHIAN', shortName: 'DC', series: 'price', calcParams: [20], figures: [linea('up'), linea('mid'), linea('dn')],
            calc: (d, i) => { const n = p(i, 0, 20), h = highest(d.map((x) => x.high), n), l = lowest(d.map((x) => x.low), n); return d.map((_, j) => (num(h[j]) ? { up: h[j], mid: (h[j] + l[j]) / 2, dn: l[j] } : {})); } });
        R({ name: 'NLT_SUPERTREND', shortName: 'ST', series: 'price', calcParams: [10, 3], figures: [linea('up'), linea('dn')],
            calc: (d, i) => { const s = supertrend(d, p(i, 0, 10), p(i, 1, 3)); return d.map((_, j) => ({ up: s.up[j], dn: s.dn[j] })); } });
        R({ name: 'NLT_ICHIMOKU', shortName: 'Ichimoku', series: 'price', calcParams: [9, 26, 52],
            figures: [linea('t'), linea('k'), linea('a'), linea('b'), linea('c')],
            calc: (d, i) => { const r = ichimoku(d, p(i, 0, 9), p(i, 1, 26), p(i, 2, 52)); return d.map((_, j) => ({ t: r.t[j], k: r.k[j], a: r.spanA[j], b: r.spanB[j], c: r.chikou[j] })); },
            // La nube: relleno entre Span A y Span B (verde si A > B, rojo si no). Las líneas las dibuja el motor.
            draw: ({ ctx, chart, indicator, xAxis, yAxis }) => {
                const r = indicator.result || []; const { from, to } = chart.getVisibleRange();
                ctx.save();
                for (let i = Math.max(0, from); i < Math.min(r.length - 1, to); i++) {
                    const a = r[i], b = r[i + 1];
                    if (!a || !b || !num(a.a) || !num(a.b) || !num(b.a) || !num(b.b)) continue;
                    ctx.fillStyle = a.a >= a.b ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.14)';
                    const x1 = xAxis.convertToPixel(i), x2 = xAxis.convertToPixel(i + 1);
                    ctx.beginPath(); ctx.moveTo(x1, yAxis.convertToPixel(a.a)); ctx.lineTo(x2, yAxis.convertToPixel(b.a)); ctx.lineTo(x2, yAxis.convertToPixel(b.b)); ctx.lineTo(x1, yAxis.convertToPixel(a.b)); ctx.closePath(); ctx.fill();
                }
                ctx.restore();
                return false;
            } });
        R({ name: 'NLT_PIVOTS', shortName: 'Pivots', series: 'price', calcParams: [], figures: ['p', 'r1', 's1', 'r2', 's2'].map(linea), calc: (d) => pivots(d) });
        R({ name: 'NLT_ATR', shortName: 'ATR', series: 'normal', calcParams: [14], precision: 5, figures: [linea('atr')], calc: (d, i) => atr(d, p(i, 0, 14)).map((v) => ({ atr: v })) });
        R({ name: 'NLT_MFI', shortName: 'MFI', series: 'normal', calcParams: [14], precision: 2, figures: [linea('mfi')], calc: (d, i) => mfi(d, p(i, 0, 14)).map((v) => ({ mfi: v })) });
        R({ name: 'NLT_STOCHRSI', shortName: 'StochRSI', series: 'normal', calcParams: [14, 14, 3, 3], precision: 2, figures: [linea('k'), linea('d')],
            calc: (d, i) => { const r = stochRsi(cierres(d), p(i, 0, 14), p(i, 2, 3), p(i, 3, 3), p(i, 1, 14)); return d.map((_, j) => ({ k: r.k[j], d: r.d[j] })); } });
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.indicatorsExtra = {
        GRUPOS, registrar,
        calc: { sma, ema, rma, wma, hma, tr, atr, rsi, stoch, stochRsi, cci, williams, adx, ao, mom, macd, uo, mfi, vwap, supertrend, ichimoku, pivots, highest, lowest },
    };
})();
