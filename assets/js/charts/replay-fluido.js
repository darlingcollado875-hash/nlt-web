/* NLT Charts -- BAR REPLAY "en vivo": la vela se va formando poco a poco, como en el gráfico en vivo, en vez de aparecer entera.
 *
 * REAL:      apertura, máximo, mínimo, cierre y volumen de cada vela (vienen del servidor, igual que en el replay normal).
 * SIMULADO:  el camino que hace el precio DENTRO de la vela (el servidor entrega velas, no ticks). Se genera con la ruta típica
 *            (alcista: abre > mínimo > máximo > cierre; bajista: abre > máximo > mínimo > cierre), con un temblor pequeño y
 *            DETERMINISTA (la misma vela siempre hace el mismo camino) que nunca sale de [mínimo, máximo].
 * La vela con la que termina la animación es EXACTAMENTE la real: el replay no cambia ningún resultado, solo cómo se ve.
 *
 * Módulo puro (sin DOM ni gráfico): se prueba con `node tests/replay-fluido.test.js`. */
(function (raiz, fabrica) {
    if (typeof module === 'object' && module.exports) module.exports = fabrica();
    else { raiz.NLTCharts = raiz.NLTCharts || {}; raiz.NLTCharts.replayFluido = fabrica(); }
})(typeof self !== 'undefined' ? self : this, function () {
    // mulberry32: generador pseudoaleatorio con semilla (misma vela = mismo camino)
    function semilla(n) {
        let a = (n >>> 0) ^ 0x9e3779b9;
        return () => {
            a = (a + 0x6d2b79f5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /* Precios por los que pasa la vela, del de apertura (índice 0) al de cierre (último). `n` ≈ cantidad de pasos. */
    function rutaVela(c, n = 20) {
        const o = c.open, cl = c.close;
        const hi = Math.max(c.high, o, cl), lo = Math.min(c.low, o, cl);   // datos raros: la ruta siempre contiene apertura y cierre
        const clave = cl >= o ? [o, lo, hi, cl] : [o, hi, lo, cl];
        const largos = [Math.abs(clave[1] - clave[0]), Math.abs(clave[2] - clave[1]), Math.abs(clave[3] - clave[2])];
        const total = largos[0] + largos[1] + largos[2];
        const pasos = largos.map((x) => Math.max(1, Math.round((total > 0 ? x / total : 1 / 3) * Math.max(3, n))));
        const rnd = semilla(c.timestamp);
        const amp = (hi - lo) * 0.14;
        const precios = [o];
        for (let s = 0; s < 3; s++) {
            for (let j = 1; j <= pasos[s]; j++) {
                const t = j / pasos[s];
                if (j === pasos[s]) { precios.push(clave[s + 1]); continue; }       // los extremos son exactos
                const v = clave[s] + (clave[s + 1] - clave[s]) * t + (rnd() - 0.5) * 2 * amp * Math.sin(Math.PI * t);
                precios.push(Math.min(hi, Math.max(lo, v)));
            }
        }
        return precios;
    }

    /* Plan de una vela: precios de la ruta y, para cada paso, la vela PARCIAL (máximo/mínimo = lo recorrido hasta ahí). */
    function planVela(c, n) {
        const precios = rutaVela(c, n);
        const hi = [], lo = [];
        let H = precios[0], L = precios[0];
        for (const p of precios) { H = Math.max(H, p); L = Math.min(L, p); hi.push(H); lo.push(L); }
        return {
            precios, largo: precios.length,
            vela: (i, frac) => ({ timestamp: c.timestamp, open: c.open, high: hi[i], low: lo[i], close: precios[i], volume: (c.volume || 0) * frac }),
        };
    }

    /* Anima UNA vela durante `durMs`: empuja velas parciales y termina empujando la vela real exacta.
     *   empujar(vela)  recibe cada paso (el mismo timestamp = actualiza la vela en curso, como un tick en vivo)
     *   ahora()/raf(f) relojes inyectables (por defecto performance.now / requestAnimationFrame)
     * Devuelve { promesa, terminar }: `terminar()` acaba al instante con la vela real (pausa, salir, cambio de sesión). */
    function animar({ vela, durMs, empujar, ahora, raf, pasos }) {
        const reloj = ahora || (() => performance.now());
        const cuadro = raf || ((f) => requestAnimationFrame(f));
        const dur = Math.max(1, durMs || 1);
        const plan = planVela(vela, pasos || Math.max(6, Math.min(40, Math.round(dur / 70))));
        let t0 = null, hecho = false, ultimo = 0, resolver;
        const promesa = new Promise((r) => { resolver = r; });
        const terminar = () => { if (hecho) return; hecho = true; empujar(vela); resolver(); };
        const paso = () => {
            if (hecho) return;
            const t = reloj();
            if (t0 == null) t0 = t;
            const f = Math.min(1, (t - t0) / dur);
            if (f >= 1) { terminar(); return; }
            const i = Math.min(plan.largo - 2, Math.floor(f * (plan.largo - 1)));   // la última posición es la vela real: la pone terminar()
            if (i !== ultimo) { ultimo = i; empujar(plan.vela(i, f)); }
            cuadro(paso);
        };
        empujar(plan.vela(0, 0));          // nace como en vivo: un punto en el precio de apertura
        cuadro(paso);
        return { promesa, terminar };
    }

    return { rutaVela, planVela, animar, semilla };
});
