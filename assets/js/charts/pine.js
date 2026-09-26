/* NLT Charts -- mini-runtime para portar indicadores FREE escritos en Pine.
 *
 * Solo lo que los scripts FREE necesitan, con la misma semántica que Pine:
 *   - series con `null` como `na` (comparar con na da falso)
 *   - ta.atr = rma(tr(true)), rma sembrada con SMA (mismas fórmulas que
 *     NLT_API/app/services/charts/pro/zone_engine/ta.py)
 *   - ta.pivothigh/pivotlow(src, left, right): avisan en la vela i que la
 *     vela i-right es pivote (empates: estrictamente mayor/menor, igual que
 *     el motor del servidor)
 *   - color.new(c, transp): transparencia 0-100 como en Pine
 *   - time("D", "HHMM-HHMM", "UTC-5"): sesión en huso FIJO (sin horario de verano)
 * Y el dibujo de box / line / label / barcolor / bgcolor con el aspecto de TradingView. */
(function () {
    const FUENTE = 'Inter, system-ui, sans-serif';
    const TAM = { tiny: 9, small: 11, normal: 13, large: 16, huge: 20 };

    // ------------------------------------------------------------ colores
    // Un color de Pine se guarda como { hex: '#RRGGBB', t: transparencia 0-100 }.
    function col(hex, t = 0) { return { hex, t }; }
    function css(c) {
        if (!c) return 'transparent';
        if (typeof c === 'string') return c;
        const h = c.hex.replace('#', '');
        const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${(1 - (c.t || 0) / 100).toFixed(3)})`;
    }
    // color.new(color_existente, t) -- reemplaza la transparencia
    function conT(c, t) { return { hex: c.hex, t }; }

    // ------------------------------------------------------------ ta.*
    function rma(xs, n) {
        const out = new Array(xs.length).fill(null);
        let prev = null;
        for (let i = 0; i < xs.length; i++) {
            if (prev === null) {
                if (i >= n - 1) {
                    let s = 0, ok = true;
                    for (let k = 0; k < n; k++) { const v = xs[i - k]; if (v === null) { ok = false; break; } s += v / n; }
                    prev = ok ? s : null;
                }
            } else if (xs[i] === null) {
                prev = null;
            } else {
                prev = (1 / n) * xs[i] + (1 - 1 / n) * prev;
            }
            out[i] = prev;
        }
        return out;
    }

    function atr(d, n) {
        const tr = d.map((b, i) => (i === 0 ? b.high - b.low
            : Math.max(Math.max(b.high - b.low, Math.abs(b.high - d[i - 1].close)), Math.abs(b.low - d[i - 1].close))));
        return rma(tr, n);
    }

    // pivote en i-right, avisado en la vela i; devuelve el precio o null
    function pivots(src, left, right, alto) {
        const out = new Array(src.length).fill(null);
        for (let i = left + right; i < src.length; i++) {
            const c = src[i - right];
            let ok = true;
            for (let k = 1; k <= left && ok; k++) { const v = src[i - right - k]; if (alto ? v >= c : v <= c) ok = false; }
            for (let k = 1; k <= right && ok; k++) { const v = src[i - right + k]; if (alto ? v >= c : v <= c) ok = false; }
            if (ok) out[i] = c;
        }
        return out;
    }

    // ------------------------------------------------------------ sesiones (huso fijo)
    function minutosDelDia(ts, offsetHoras) {
        const m = Math.floor(ts / 60000) + offsetHoras * 60;
        return ((m % 1440) + 1440) % 1440;
    }
    // "HHMM-HHMM" en [inicio, fin); si fin < inicio cruza la medianoche
    function enSesion(ts, sesion, offsetHoras) {
        const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(sesion || '');
        if (!m) return false;
        const ini = +m[1] * 60 + +m[2], fin = +m[3] * 60 + +m[4];
        const x = minutosDelDia(ts, offsetHoras);
        return ini <= fin ? (x >= ini && x < fin) : (x >= ini || x < fin);
    }

    // ------------------------------------------------------------ dibujo
    // Contexto de dibujo: convierte índice de vela y precio a píxeles.
    function lienzo(ctx, chart, bounding, xAxis, yAxis) {
        const esp = chart.getBarSpace();
        const media = Math.max(1, esp.halfGapBar);
        return {
            ctx, bounding, media, mitadBarra: esp.halfBar,
            x: (i) => xAxis.convertToPixel(i),
            y: (p) => yAxis.convertToPixel(p),
            ancho: bounding.width,
        };
    }

    function estiloLinea(ctx, estilo, ancho) {
        ctx.lineWidth = ancho || 1;
        ctx.setLineDash(estilo === 'dashed' ? [6, 4] : estilo === 'dotted' ? [2, 3] : []);
    }

    // box: { left, right, top, bottom, bg, border, borderStyle, extendRight, text, textColor, textSize, halign }
    function caja(L, b) {
        const { ctx } = L;
        const x0 = L.x(b.left);
        const x1 = b.extendRight ? L.ancho : L.x(b.right);
        if (x1 < 0 || x0 > L.ancho) return;
        const y0 = L.y(b.top), y1 = L.y(b.bottom);
        const top = Math.min(y0, y1), h = Math.max(1, Math.abs(y1 - y0));
        ctx.fillStyle = css(b.bg);
        ctx.fillRect(x0, top, x1 - x0, h);
        if (b.border) {
            ctx.strokeStyle = css(b.border);
            estiloLinea(ctx, b.borderStyle, 1);
            ctx.strokeRect(Math.round(x0) + 0.5, Math.round(top) + 0.5, Math.round(x1 - x0) - 1, Math.round(h) - 1);
            ctx.setLineDash([]);
        }
        if (b.text && h >= 8) {
            ctx.font = `500 ${TAM[b.textSize || 'tiny']}px ${FUENTE}`;
            ctx.fillStyle = css(b.textColor);
            ctx.textBaseline = 'middle';
            const visibleX0 = Math.max(x0, 0), visibleX1 = Math.min(x1, L.ancho);
            if (b.halign === 'right') { ctx.textAlign = 'right'; ctx.fillText(b.text, visibleX1 - 4, top + h / 2); }
            else { ctx.textAlign = 'center'; ctx.fillText(b.text, (visibleX0 + visibleX1) / 2, top + h / 2); }
            ctx.textAlign = 'left';
        }
    }

    // line: { x1, y1, x2, y2, color, style, width }
    function linea(L, l) {
        const { ctx } = L;
        ctx.strokeStyle = css(l.color);
        estiloLinea(ctx, l.style, l.width);
        ctx.beginPath();
        ctx.moveTo(L.x(l.x1), L.y(l.y1));
        ctx.lineTo(L.x(l.x2), L.y(l.y2));
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // label: { x, y, text, style: 'down'|'up'|'left'|'right', color, textColor, size, yloc: 'price'|'abovebar'|'belowbar', bar }
    function etiqueta(L, lb, velas) {
        const { ctx } = L;
        const tam = TAM[lb.size || 'normal'];
        ctx.font = `600 ${tam}px ${FUENTE}`;
        const lineas = String(lb.text).split('\n');
        const w = Math.max(...lineas.map((t) => ctx.measureText(t).width)) + 10;
        const h = lineas.length * (tam + 3) + 6;
        let px = L.x(lb.x);
        let py = lb.yloc === 'abovebar' && velas[lb.x] ? L.y(velas[lb.x].high) - 4
            : lb.yloc === 'belowbar' && velas[lb.x] ? L.y(velas[lb.x].low) + 4 : L.y(lb.y);
        let bx, by;
        const pico = 5;
        if (lb.style === 'down') { bx = px - w / 2; by = py - h - pico; }
        else if (lb.style === 'up') { bx = px - w / 2; by = py + pico; }
        else if (lb.style === 'left') { bx = px + pico; by = py - h / 2; }
        else { bx = px - w - pico; by = py - h / 2; }
        if (bx > L.ancho || bx + w < 0) return;
        const fondo = css(lb.color);
        if (fondo !== 'transparent' && !/,0\.000\)$/.test(fondo)) {
            ctx.fillStyle = fondo;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(bx, by, w, h, 3); else ctx.rect(bx, by, w, h);
            ctx.fill();
            // puntita
            ctx.beginPath();
            if (lb.style === 'down') { ctx.moveTo(px - 4, by + h); ctx.lineTo(px + 4, by + h); ctx.lineTo(px, py); }
            else if (lb.style === 'up') { ctx.moveTo(px - 4, by); ctx.lineTo(px + 4, by); ctx.lineTo(px, py); }
            else if (lb.style === 'left') { ctx.moveTo(bx, py - 4); ctx.lineTo(bx, py + 4); ctx.lineTo(px, py); }
            else { ctx.moveTo(bx + w, py - 4); ctx.lineTo(bx + w, py + 4); ctx.lineTo(px, py); }
            ctx.fill();
        }
        ctx.fillStyle = css(lb.textColor);
        ctx.textBaseline = 'top';
        ctx.textAlign = 'center';
        lineas.forEach((t, k) => ctx.fillText(t, bx + w / 2, by + 3 + k * (tam + 3)));
        ctx.textAlign = 'left';
    }

    // barcolor: repinta la vela i (mecha + cuerpo) encima de la original
    function pintarVela(L, v, i, color) {
        const { ctx } = L;
        const x = Math.round(L.x(i)) + 0.5;
        const c = css(color);
        ctx.strokeStyle = c;
        ctx.fillStyle = c;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x, L.y(v.high));
        ctx.lineTo(x, L.y(v.low));
        ctx.stroke();
        const y0 = L.y(v.open), y1 = L.y(v.close);
        const w = Math.max(1, L.media * 2 - 1);
        ctx.fillRect(x - w / 2, Math.min(y0, y1), w, Math.max(1, Math.abs(y1 - y0)));
    }

    // bgcolor: franja de fondo de toda la altura en las velas [i, j]
    function fondo(L, i, j, color) {
        L.ctx.fillStyle = css(color);
        const x0 = Math.round(L.x(i) - L.mitadBarra), x1 = Math.round(L.x(j) + L.mitadBarra);
        L.ctx.fillRect(x0, 0, x1 - x0, L.bounding.height);
    }

    function formatoPrecio(v, decimales) {
        if (v === null || v === undefined || Number.isNaN(v)) return 'N/A';
        // str.tostring(x, "#.#####"): hasta 5 decimales, sin ceros de más
        return String(Number(v.toFixed(decimales)));
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.pine = { col, css, conT, rma, atr, pivots, minutosDelDia, enSesion, lienzo, caja, linea, etiqueta, pintarVela, fondo, formatoPrecio, FUENTE, TAM };
})();
