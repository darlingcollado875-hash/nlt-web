/* Verificador de anclaje de NLT Charts (solo desarrollo; tests/ no se publica).
 *
 * Se inyecta en charts.html (?diag=1) y devuelve, en el estado ACTUAL del gráfico:
 *  - Unified Suite: si su salida corresponde al dataset en pantalla (firma) y, si se dibujaría, que cada
 *    caja FVG esté exactamente sobre sus velas A..C (left = A; bull: [high A, low C], bear: [high C, low A]).
 *  - NLT Zone Engine: cada FVG/OB anclado por timestamp a una vela del gráfico con SU precio
 *    (FVG alcista T = low C, B = high A; OB alcista = (open, close) de la vela de origen) y ningún
 *    objeto que empiece después de la última vela (futuro).
 *  - contadores del guardián: dibujos omitidos por firma inválida y respuestas del ZE descartadas.
 * window.__monitor(ms) muestrea continuamente y guarda violaciones en window.__log. */
(function () {
    window.__verificar = () => {
        const ch = NLTCharts.app.motor.chart, dl = ch.getDataList(), F = NLTCharts.fluidez;
        const u = ch.getIndicators().find((i) => i.name === 'NLT_UNIFIED');
        const s0 = u && NLTCharts.unified.salidaActual(u.id);
        const out = {
            velas: dl.length, ultima: dl.length ? new Date(dl[dl.length - 1].timestamp).toISOString().slice(0, 16) : null,
            omitidasSuite: NLTCharts.unified.omitidas(), omitidosInd: F.dibujosOmitidos(), zeDescartados: NLTCharts.app.pro.descartados(),
        };
        if (s0) {
            const valida = F.firmaValida(s0.firma, dl);
            let fvg = 0, malas = 0;
            if (valida) for (const b of s0.salida.boxes) {
                if (b.text !== 'FVG') continue;
                fvg++;
                const lo = Math.min(b.top, b.bottom), hi = Math.max(b.top, b.bottom);
                const a = dl[b.left], c = dl[b.left + 2];
                const ok = a && c && ((lo === a.high && hi === c.low) || (lo === c.high && hi === a.low));
                if (!ok) malas++;
            }
            out.suite = { valida, fvg, malas };
        }
        const d = NLTCharts.app.pro.dibujoActual();
        if (d) {
            const idx = new Map(dl.map((v, i) => [v.timestamp, i])), last = dl.length ? dl[dl.length - 1].timestamp : 0;
            let cajas = 0, malas = 0, futuras = 0, fvgOb = 0;
            for (const b of d.boxes || []) {
                cajas++;
                if (b.x1 > last) futuras++;
                const k = b.k || '';
                if (!/^(fvg|ob)(Bull|Bear)_/.test(k)) continue;
                fvgOb++;
                const i = idx.get(b.x1), v = dl[i];
                if (v == null) { malas++; continue; }
                if (k.startsWith('obBull_') && !(b.top === v.open && b.bot === v.close)) malas++;
                if (k.startsWith('obBear_') && !(b.top === v.close && b.bot === v.open)) malas++;
                if (k.startsWith('fvgBull_') && !(i >= 2 && b.top === v.low && b.bot === dl[i - 2].high)) malas++;
                if (k.startsWith('fvgBear_') && !(i >= 2 && b.top === dl[i - 2].low && b.bot === v.high)) malas++;
            }
            out.ze = { cajas, fvgOb, malas, futuras };
        }
        return out;
    };
    window.__monitor = (ms = 50) => {
        clearInterval(window.__mon);
        window.__log = []; window.__muestras = 0;
        window.__mon = setInterval(() => {
            try {
                const v = window.__verificar(); window.__muestras++;
                if ((v.suite && v.suite.malas) || (v.ze && (v.ze.malas || v.ze.futuras))) window.__log.push({ paso: window.__paso, v });
            } catch (e) { window.__log.push({ paso: window.__paso, err: String(e) }); }
        }, ms);
    };
})();
