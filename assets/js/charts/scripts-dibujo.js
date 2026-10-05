/* NLT Script -- dibuja en el gráfico lo que el script crea además de las líneas: rellenos entre plots, velas propias, líneas,
 * cajas, etiquetas y tablas (label.new, line.new, box.new, table.new, fill, plotcandle). Solo canvas: no toca la página. */
(function () {
    const TAM = { tiny: 9, small: 10.5, normal: 12, large: 15, huge: 20, auto: 12 };
    const num = (x) => typeof x === 'number' && Number.isFinite(x);
    const fuente = (px, bold) => `${bold ? '600 ' : ''}${px}px Inter, system-ui, sans-serif`;

    function indiceDeTiempo(datos, t, tfMs) {
        const n = datos.length;
        if (!n) return 0;
        if (t >= datos[n - 1].timestamp) return n - 1 + (tfMs ? (t - datos[n - 1].timestamp) / tfMs : 0);
        if (t <= datos[0].timestamp) return tfMs ? (t - datos[0].timestamp) / tfMs : 0;
        let a = 0, b = n - 1;
        while (b - a > 1) { const m = (a + b) >> 1; if (datos[m].timestamp <= t) a = m; else b = m; }
        return a;
    }

    function pintar(ctx, res, { xAxis, yAxis, bounding, datos, desde, hasta, ancho, tfMs }) {
        const X = (v, xloc) => xAxis.convertToPixel(xloc === 'bar_time' ? indiceDeTiempo(datos, v, tfMs) : v);
        const Y = (v) => yAxis.convertToPixel(v);
        const dash = (est) => (est === 'dashed' || est === 'style_dashed' ? [6, 4] : est === 'dotted' || est === 'style_dotted' ? [2, 3] : []);
        const valorSerie = (s, i) => (s.k === 'plot' ? (res.plots[s.i] ? res.plots[s.i].valores[i] : null) : (res.hlines[s.i] ? res.hlines[s.i].precio : null));

        // 1) relleno entre dos plots / líneas horizontales (nubes)
        (res.fills || []).forEach((f) => {
            for (let i = Math.max(0, desde); i < Math.min(datos.length - 1, hasta); i++) {
                const c = f.colores[i];
                if (typeof c !== 'string') continue;
                const a0 = valorSerie(f.a, i), a1 = valorSerie(f.a, i + 1), b0 = valorSerie(f.b, i), b1 = valorSerie(f.b, i + 1);
                if (![a0, a1, b0, b1].every(num)) continue;
                const x1 = xAxis.convertToPixel(i), x2 = xAxis.convertToPixel(i + 1);
                ctx.fillStyle = c;
                ctx.beginPath(); ctx.moveTo(x1, Y(a0)); ctx.lineTo(x2, Y(a1)); ctx.lineTo(x2, Y(b1)); ctx.lineTo(x1, Y(b0)); ctx.closePath(); ctx.fill();
            }
        });

        // 2) velas propias (plotcandle / plotbar)
        (res.velasPropias || []).forEach((v) => {
            const w = Math.max(1, Math.floor(ancho * 0.7));
            for (let i = Math.max(0, desde); i < Math.min(v.c.length, hasta); i++) {
                if (![v.o[i], v.h[i], v.l[i], v.c[i]].every(num)) continue;
                const x = xAxis.convertToPixel(i), yo = Y(v.o[i]), yc = Y(v.c[i]);
                const col = typeof v.color[i] === 'string' ? v.color[i] : '#787B86';
                ctx.strokeStyle = typeof v.mecha[i] === 'string' ? v.mecha[i] : col; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(x, Y(v.h[i])); ctx.lineTo(x, Y(v.l[i])); ctx.stroke();
                ctx.fillStyle = col; ctx.fillRect(x - w / 2, Math.min(yo, yc), w, Math.max(1, Math.abs(yc - yo)));
                if (typeof v.borde[i] === 'string') { ctx.strokeStyle = v.borde[i]; ctx.strokeRect(x - w / 2, Math.min(yo, yc), w, Math.max(1, Math.abs(yc - yo))); }
            }
        });

        // 3) cajas
        (res.cajas || []).forEach((b) => {
            let x1 = X(b.izq, b.xloc), x2 = X(b.der, b.xloc);
            if (b.extend === 'right' || b.extend === 'both') x2 = bounding.width;
            if (b.extend === 'left' || b.extend === 'both') x1 = 0;
            const y1 = Y(b.arriba), y2 = Y(b.abajo);
            if (![x1, x2, y1, y2].every(num)) return;
            const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
            if (x > bounding.width || x + w < 0) return;
            if (typeof b.fondo === 'string') { ctx.fillStyle = b.fondo; ctx.fillRect(x, y, w, h); }
            if (b.grosor > 0) { ctx.strokeStyle = b.borde; ctx.lineWidth = b.grosor; ctx.setLineDash(dash(b.estiloBorde)); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]); }
            if (b.texto) { ctx.fillStyle = b.colorTexto; ctx.font = fuente(11); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.texto, x + w / 2, y + h / 2); }
        });

        // 4) líneas
        (res.lineas || []).forEach((l) => {
            let x1 = X(l.x1, l.xloc), y1 = Y(l.y1), x2 = X(l.x2, l.xloc), y2 = Y(l.y2);
            if (![x1, y1, x2, y2].every(num)) return;
            if (l.extend && l.extend !== 'none' && x2 !== x1) {
                const m = (y2 - y1) / (x2 - x1);
                if (l.extend === 'right' || l.extend === 'both') { const xe = bounding.width; y2 = y1 + m * (xe - x1); x2 = xe; }
                if (l.extend === 'left' || l.extend === 'both') { const xs = 0; y1 = y1 + m * (xs - x1); x1 = xs; }
            }
            ctx.strokeStyle = l.color; ctx.lineWidth = Math.max(1, Math.min(8, l.grosor || 1)); ctx.setLineDash(dash(l.estilo));
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
        });

        // 5) etiquetas
        (res.etiquetas || []).forEach((e) => {
            if (!num(e.y) && e.yloc === 'price') return;
            const x = X(e.x, e.xloc);
            let y = num(e.y) ? Y(e.y) : bounding.height / 2;
            if (e.yloc === 'abovebar' || e.yloc === 'belowbar') { const i = Math.round(e.xloc === 'bar_time' ? indiceDeTiempo(datos, e.x, tfMs) : e.x); const k = datos[i]; if (k) y = e.yloc === 'abovebar' ? Y(k.high) : Y(k.low); }
            if (!num(x) || !num(y) || x < -300 || x > bounding.width + 300) return;
            const px = TAM[e.tam] || 12;
            ctx.font = fuente(px);
            const est = String(e.estilo).replace(/^style_/, '').replace(/^label_?/, '');
            if (est === 'none') { ctx.fillStyle = e.colorTexto; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(e.texto, x, y); return; }
            const lineas = String(e.texto).split('\n'), tw = Math.max(...lineas.map((t) => ctx.measureText(t).width)), pad = 5, w = tw + pad * 2, h = lineas.length * (px + 3) + pad * 2 - 3, flecha = 6;
            let bx = x - w / 2, by;
            if (est === 'up') by = y + flecha; else if (est === 'down' || est === '') by = y - flecha - h; else if (est === 'left') { bx = x + flecha; by = y - h / 2; } else if (est === 'right') { bx = x - flecha - w; by = y - h / 2; } else by = y - h / 2;
            ctx.fillStyle = e.color;
            ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, w, h, 5) : ctx.rect(bx, by, w, h); ctx.fill();
            if (est === 'up' || est === 'down' || est === '' || est === 'left' || est === 'right') {
                ctx.beginPath();
                if (est === 'up') { ctx.moveTo(x, y); ctx.lineTo(x - flecha, y + flecha); ctx.lineTo(x + flecha, y + flecha); }
                else if (est === 'left') { ctx.moveTo(x, y); ctx.lineTo(x + flecha, y - flecha); ctx.lineTo(x + flecha, y + flecha); }
                else if (est === 'right') { ctx.moveTo(x, y); ctx.lineTo(x - flecha, y - flecha); ctx.lineTo(x - flecha, y + flecha); }
                else { ctx.moveTo(x, y); ctx.lineTo(x - flecha, y - flecha); ctx.lineTo(x + flecha, y - flecha); }
                ctx.closePath(); ctx.fill();
            }
            ctx.fillStyle = e.colorTexto; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            lineas.forEach((t, i) => ctx.fillText(t, bx + w / 2, by + pad + i * (px + 3)));
        });

        // 6) tablas (esquinas fijas del panel)
        (res.tablas || []).forEach((t) => {
            const celdas = Object.values(t.celdas);
            if (!celdas.length) return;
            const anchoCol = new Array(t.cols).fill(0), altoFila = new Array(t.filas).fill(0);
            celdas.forEach((c) => {
                const px = TAM[c.tam] || 12; ctx.font = fuente(px);
                const lin = String(c.texto || '').split('\n');
                const w = Math.max(0, ...lin.map((s) => ctx.measureText(s).width)) + 12, h = lin.length * (px + 2) + 8;
                const wf = num(c.ancho) && c.ancho > 0 ? (c.ancho / 100) * bounding.width : 0, hf = num(c.alto) && c.alto > 0 ? (c.alto / 100) * bounding.height : 0;
                anchoCol[c.c] = Math.max(anchoCol[c.c], wf || w); altoFila[c.r] = Math.max(altoFila[c.r], hf || h);
            });
            const W = anchoCol.reduce((s, x) => s + x, 0), H = altoFila.reduce((s, x) => s + x, 0), m = 8;
            const pos = String(t.pos);
            const px0 = pos.includes('left') ? m : pos.includes('center') ? (bounding.width - W) / 2 : bounding.width - W - m;
            const py0 = pos.startsWith('top') ? m : pos.startsWith('middle') ? (bounding.height - H) / 2 : bounding.height - H - m;
            if (typeof t.fondo === 'string') { ctx.fillStyle = t.fondo; ctx.fillRect(px0, py0, W, H); }
            let y = py0;
            for (let r = 0; r < t.filas; r++) {
                let x = px0;
                for (let c = 0; c < t.cols; c++) {
                    const ce = t.celdas[`${c},${r}`];
                    if (ce && typeof ce.fondo === 'string') { ctx.fillStyle = ce.fondo; ctx.fillRect(x, y, anchoCol[c], altoFila[r]); }
                    if (ce && ce.texto) {
                        const px = TAM[ce.tam] || 12; ctx.font = fuente(px, true);
                        ctx.fillStyle = typeof ce.colorTexto === 'string' ? ce.colorTexto : '#FFFFFF'; ctx.textBaseline = 'middle';
                        const alin = String(ce.alin || '').replace(/^align_/, ''), al = alin === 'left' ? 'left' : alin === 'right' ? 'right' : 'center';
                        ctx.textAlign = al;
                        const tx = al === 'left' ? x + 6 : al === 'right' ? x + anchoCol[c] - 6 : x + anchoCol[c] / 2;
                        const lin = String(ce.texto).split('\n'), alto = lin.length * (px + 2);
                        lin.forEach((s, i) => ctx.fillText(s, tx, y + (altoFila[r] - alto) / 2 + (i + 0.5) * (px + 2)));
                    }
                    x += anchoCol[c];
                }
                y += altoFila[r];
            }
            if (t.bordeW > 0 && typeof t.bordeC === 'string') {
                ctx.strokeStyle = t.bordeC; ctx.lineWidth = t.bordeW;
                let x = px0; for (let c = 0; c <= t.cols; c++) { ctx.beginPath(); ctx.moveTo(x, py0); ctx.lineTo(x, py0 + H); ctx.stroke(); x += anchoCol[c] || 0; }
                let yy = py0; for (let r = 0; r <= t.filas; r++) { ctx.beginPath(); ctx.moveTo(px0, yy); ctx.lineTo(px0 + W, yy); ctx.stroke(); yy += altoFila[r] || 0; }
            }
            if (t.marcoW > 0 && typeof t.marco === 'string') { ctx.strokeStyle = t.marco; ctx.lineWidth = t.marcoW; ctx.strokeRect(px0, py0, W, H); }
        });
        ctx.textBaseline = 'alphabetic';
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.scriptsDibujo = { pintar, indiceDeTiempo };
})();
