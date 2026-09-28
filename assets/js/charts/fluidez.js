/* NLT Charts -- movimiento fluido de las velas (SOLO visual; los datos no se tocan).
 *
 * 1) Tween de la vela en curso: cuando llega un dato REAL nuevo de la misma vela, el cierre se anima
 *    del valor mostrado al real en TWEEN_MS con requestAnimationFrame (ease-out). Los frames
 *    intermedios nunca salen del rango real (High/Low intermedios quedan dentro de los reales) y el
 *    último frame es EXACTAMENTE el dato recibido. Sin ticks inventados: solo se anima entre dos
 *    estados reales que ya llegaron.
 * 2) Integridad: mientras hay frames intermedios, los indicadores NO recalculan: devuelven su último
 *    resultado calculado con datos reales (se envuelve el `calc` de todos los indicadores, incluidos los
 *    incorporados de KLineChart). Zone Engine, NLT AI, backtest y estadísticas corren en el servidor con
 *    velas reales: el tween no existe para ellos.
 * 3) Vela nueva: si el gráfico está pegado al borde derecho, la vela nueva entra con un desplazamiento
 *    suave (en vez del salto de una barra). Si el usuario está mirando historia, el viewport NO se mueve.
 * Con "reducir movimiento" del sistema o la pestaña oculta, todo se aplica directo (sin animación). */
(function () {
    const TWEEN_MS = 180;
    const SCROLL_MS = 220;
    let interpolando = false;
    const reducido = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
    const stats = { tweens: 0, frames: 0, directas: 0, nuevas: 0, scrollsSuaves: 0, viewportsPreservados: 0 };

    // ── firma del dataset de cada resultado (anclaje) ──
    // Los indicadores del navegador anclan sus objetos por índice de vela (como Pine). Un resultado solo
    // vale para el dataset con el que se calculó: misma generación, misma primera vela, y las velas
    // 0..n-1 intactas (solo se agregan velas o se actualiza la última). Si el cálculo es asíncrono
    // (Unified Suite, Key Levels piden velas HTF), KLineChart seguiría dibujando el resultado VIEJO sobre
    // el dataset NUEVO -> objetos desplazados (bug de NLT Bar Replay, 28/09). Ahora ese dibujo se omite.
    const firmas = new WeakMap();
    const generacion = () => (window.NLTCharts && NLTCharts.market && NLTCharts.market.generacion ? NLTCharts.market.generacion() : 0);
    function firmaDe(dl) {
        const n = dl.length;
        return { gen: generacion(), n, primera: n ? dl[0].timestamp : null, ultima: n ? dl[n - 1].timestamp : null };
    }
    function firmaValida(f, dl) {
        if (!f) return true;                                   // sin firma (resultado sincrónico heredado): se dibuja
        if (f.gen !== generacion() || !dl.length) return false;
        if (dl[0].timestamp !== f.primera || dl.length < f.n) return false;
        return f.n === 0 || dl[f.n - 1].timestamp === f.ultima;
    }
    const firmar = (x, f) => { if (x && typeof x === 'object') firmas.set(x, f); return x; };

    // ── (2) calc protegido: en frames intermedios, el último resultado REAL ──
    function envolverCalc(calc) {
        if (!calc || calc.__nltProtegido) return calc;
        const f = function (dataList, indicator) {
            const c = indicator && indicator.__nltReal;
            if (interpolando && c && c.n === dataList.length && firmaValida(firmas.get(c.r), dataList)) return c.r;
            const firma = firmaDe(dataList);
            const r = calc.call(this, dataList, indicator);
            const guardar = (x) => { firmar(x, firma); if (indicator && !interpolando) indicator.__nltReal = { n: dataList.length, r: x }; return x; };
            return r && typeof r.then === 'function' ? r.then(guardar) : guardar(r);
        };
        f.__nltProtegido = true;
        return f;
    }
    function envolverDraw(draw) {
        if (!draw || draw.__nltProtegido) return draw;
        const f = function (p) {
            const res = p && p.indicator && p.indicator.result;
            if (res && !firmaValida(firmas.get(res), p.chart.getDataList())) { omitidos.n++; return false; }   // de otro dataset
            return draw.call(this, p);
        };
        f.__nltProtegido = true;
        return f;
    }
    const omitidos = { n: 0 };
    // indicadores propios: al registrarse
    const registrar = klinecharts.registerIndicator;
    klinecharts.registerIndicator = function (tpl) {
        if (tpl && typeof tpl.calc === 'function') tpl = { ...tpl, calc: envolverCalc(tpl.calc) };
        if (tpl && typeof tpl.draw === 'function') tpl = { ...tpl, draw: envolverDraw(tpl.draw) };
        return registrar.call(this, tpl);
    };
    // incorporados (EMA, RSI, MACD, BOLL...): se envuelve la instancia ya creada
    function protegerInstancias(chart) {
        (chart.getIndicators() || []).forEach((ind) => {
            if (ind.calc && !ind.calc.__nltProtegido) {
                try { chart.overrideIndicator({ name: ind.name, id: ind.id, paneId: ind.paneId, calc: envolverCalc(ind.calc) }); } catch (_) { /* versión sin override de calc */ }
            }
        });
    }

    function crear(chart) {
        let anim = null;
        let signo = 0;   // cómo mueve scrollByDistance(+d) a las barras (se mide una vez)

        const xDe = (i) => { try { return chart.convertToPixel({ dataIndex: i, value: 0 }, { paneId: 'candle_pane' }).x; } catch (_) { return null; } };
        function calibrar() {
            if (signo) return signo;
            const n = chart.getDataList().length;
            if (!n) return 0;
            const a = xDe(n - 1);
            chart.scrollByDistance(1, 0);
            const b = xDe(n - 1);
            chart.scrollByDistance(-1, 0);
            signo = a != null && b != null && b !== a ? Math.sign(b - a) : 1;
            return signo;
        }
        // mueve el contenido `px` píxeles (positivo = a la derecha)
        const mover = (px) => { if (px) chart.scrollByDistance(px * (calibrar() || 1), 0); };

        function cancelar() { if (anim) { cancelAnimationFrame(anim.raf); anim = null; } interpolando = false; }

        /** aplicar(cb, vela): cb = callback real de KLineChart (subscribeBar / empujar). */
        function aplicar(cb, vela) {
            const dl = chart.getDataList();
            const u = dl[dl.length - 1];
            if (u && vela.timestamp === u.timestamp) return tween(cb, vela, u);
            if (u && vela.timestamp < u.timestamp) { cancelar(); cb(vela); return; }   // corrección de una vela anterior
            return nueva(cb, vela, dl);
        }

        function tween(cb, vela, u) {
            const desde = anim ? anim.actual : u.close;
            cancelar();
            if (reducido() || document.hidden || desde === vela.close) { stats.directas++; cb(vela); return; }
            protegerInstancias(chart);
            stats.tweens++;
            const t0 = performance.now();
            const lo = Math.min(vela.low, vela.high), hi = Math.max(vela.low, vela.high);
            anim = { actual: desde, raf: 0 };
            const paso = (ahora) => {
                // el timestamp de rAF es el INICIO del frame y puede ser anterior a t0: sin acotar, k < 0 y el
                // primer frame quedaba fuera del rango real (visto en tests/charts-fluidez.test.html)
                const k = Math.max(0, Math.min(1, (ahora - t0) / TWEEN_MS));
                if (k >= 1) { anim = null; interpolando = false; cb(vela); return; }     // último frame: el dato real
                const e = 1 - Math.pow(1 - k, 3);
                const c = Math.min(hi, Math.max(lo, desde + (vela.close - desde) * e));
                anim.actual = c;
                interpolando = true;
                stats.frames++;
                cb({ ...vela, close: c, high: Math.min(hi, Math.max(u.high, c)), low: Math.max(lo, Math.min(u.low, c)), volume: u.volume });
                anim.raf = requestAnimationFrame(paso);
            };
            anim.raf = requestAnimationFrame(paso);
        }

        function nueva(cb, vela, dl) {
            cancelar();
            stats.nuevas++;
            const n = dl.length;
            if (!n) { cb(vela); return; }
            // ¿la última vela está a la vista? Por PÍXEL: getVisibleRange().to queda recortado al último
            // índice aunque la vela esté fuera de pantalla (medido en KLineChart 10.0.3)
            const ancho = (chart.getSize('candle_pane', 'main') || {}).width || Infinity;
            const xUlt = xDe(n - 1);
            const alBorde = xUlt != null && xUlt <= ancho;
            // ancla: una vela VISIBLE (la última si está a la vista; si no, la primera visible)
            const ref = alBorde ? n - 1 : Math.max(0, Math.min(n - 1, chart.getVisibleRange().realFrom ?? chart.getVisibleRange().from));
            const x0 = xDe(ref);
            cb(vela);
            const x1 = xDe(ref);
            if (x0 == null || x1 == null || Math.abs(x1 - x0) < 0.01) { if (!alBorde) stats.viewportsPreservados++; return; }
            const delta = x1 - x0;                 // cuánto corrió KLineChart las barras al agregar la vela
            if (!alBorde) { mover(-delta); stats.viewportsPreservados++; return; }       // mirando historia: quieto
            if (reducido() || document.hidden) return;
            // pegado al borde: se vuelve a donde estaba y se desliza hasta el lugar final
            stats.scrollsSuaves++;
            mover(-delta);
            const t0 = performance.now();
            let hecho = 0;
            const paso = (ahora) => {
                const k = Math.max(0, Math.min(1, (ahora - t0) / SCROLL_MS));
                const e = 1 - Math.pow(1 - k, 3);
                const obj = delta * e;
                mover(obj - hecho);
                hecho = obj;
                if (k < 1) requestAnimationFrame(paso);
            };
            requestAnimationFrame(paso);
        }

        return { aplicar, cancelar, interpolando: () => interpolando, stats: () => ({ ...stats }) };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.fluidez = { crear, envolverCalc, envolverDraw, firmaDe, firmaValida, firmaDeResultado: (r) => firmas.get(r),
        dibujosOmitidos: () => omitidos.n, protegerInstancias, interpolando: () => interpolando, TWEEN_MS };
})();
