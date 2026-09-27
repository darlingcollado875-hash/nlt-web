/* NLT Charts -- diagnóstico de rendimiento (SOLO desarrollo).
 *
 * Se activa con ?diag=1 en localhost / 127.0.0.1 (o localStorage
 * nlt_charts_diag=1 en esos mismos hosts). En producción no hace nada.
 *
 * Mide: FPS y tiempo de frame (p50/p95/máx), tareas largas del hilo
 * principal (>50 ms), tiempo de cálculo y de dibujo por indicador,
 * cantidad de cálculos/dibujos, requests (cantidad, latencia, abortados),
 * tiempo de carga del gráfico y memoria (Chrome).
 *
 * Prueba de carga: NLTCharts.diag.pruebaCarga({ velas: 1500 | 5000, ... })
 * reemplaza los datos por velas sintéticas, agrega dibujos e indicadores,
 * hace pan, zoom y actualizaciones de vela, y mide cada fase. */
(function () {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    let flag = false;
    try { flag = new URLSearchParams(location.search).get('diag') === '1' || localStorage.getItem('nlt_charts_diag') === '1'; } catch (_) { /* nada */ }
    const activo = local && flag;

    const M = {
        inicio: performance.now(),
        cargaGrafico: null,          // ms hasta la primera historia dibujada
        calc: {},                    // nombre -> { n, total, max }
        draw: {},                    // nombre -> { n, total, max }
        requests: { n: 0, abortados: 0, errores: 0, lat: [], porRuta: {} },
        longTasks: { n: 0, total: 0, max: 0 },
        frames: [],                  // duraciones de frame recientes
    };

    function acumular(tabla, nombre, ms) {
        const t = tabla[nombre] || (tabla[nombre] = { n: 0, total: 0, max: 0 });
        t.n += 1; t.total += ms; t.max = Math.max(t.max, ms);
    }

    const api = {
        activo,
        M,
        marcarCarga() { if (activo && M.cargaGrafico === null) M.cargaGrafico = performance.now() - M.inicio; },
        // Envuelve calc/draw de un indicador personalizado para medirlos.
        envolver(def) {
            if (!activo) return def;
            const nombre = def.name;
            const d = { ...def };
            if (def.calc) {
                d.calc = function (...args) {
                    const t0 = performance.now();
                    const r = def.calc.apply(this, args);
                    if (r && typeof r.then === 'function') return r.then((x) => { acumular(M.calc, nombre, performance.now() - t0); return x; });
                    acumular(M.calc, nombre, performance.now() - t0);
                    return r;
                };
            }
            if (def.draw) {
                d.draw = function (...args) {
                    const t0 = performance.now();
                    const r = def.draw.apply(this, args);
                    acumular(M.draw, nombre, performance.now() - t0);
                    return r;
                };
            }
            return d;
        },
    };

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.diag = api;
    if (!activo) return;

    // ── registerIndicator envuelto: todo indicador propio queda medido ──
    const reg = klinecharts.registerIndicator;
    klinecharts.registerIndicator = (def) => reg(api.envolver(def));

    // ── requests ──
    const f0 = window.fetch;
    window.fetch = async function (input, init) {
        const url = typeof input === 'string' ? input : input.url;
        const ruta = (() => { try { return new URL(url, location.href).pathname; } catch (_) { return url; } })();
        const t0 = performance.now();
        M.requests.n += 1;
        const r0 = M.requests.porRuta[ruta] || (M.requests.porRuta[ruta] = { n: 0, total: 0 });
        r0.n += 1;
        try {
            const res = await f0.call(this, input, init);
            const ms = performance.now() - t0;
            M.requests.lat.push(ms); r0.total += ms;
            if (!res.ok) M.requests.errores += 1;
            return res;
        } catch (e) {
            if (e && e.name === 'AbortError') M.requests.abortados += 1; else M.requests.errores += 1;
            throw e;
        }
    };

    // ── tareas largas ──
    try {
        new PerformanceObserver((lista) => {
            lista.getEntries().forEach((e) => { M.longTasks.n += 1; M.longTasks.total += e.duration; M.longTasks.max = Math.max(M.longTasks.max, e.duration); });
        }).observe({ type: 'longtask', buffered: true });
    } catch (_) { /* el navegador no soporta longtask */ }

    // ── FPS / frame time ──
    let ultimo = performance.now();
    function frame(t) {
        M.frames.push(t - ultimo);
        if (M.frames.length > 600) M.frames.shift();
        ultimo = t;
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
    function resumenFrames(frames) {
        const avg = frames.reduce((a, b) => a + b, 0) / (frames.length || 1);
        return { fps: +(1000 / avg).toFixed(1), p50: +pct(frames, 0.5).toFixed(1), p95: +pct(frames, 0.95).toFixed(1), max: +Math.max(0, ...frames).toFixed(1), jank: frames.filter((f) => f > 33.4).length };
    }

    // ── panel ──
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;background:rgba(0,0,0,.82);color:#9EF;font:11px/1.35 ui-monospace,Consolas,monospace;padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre;max-width:46vw';
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(panel));
    setInterval(() => {
        const f = resumenFrames(M.frames.slice(-120));
        const mem = performance.memory ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB` : 'n/d';
        const calc = Object.entries(M.calc).map(([k, v]) => `${k.replace('NLT_', '')} ${v.n}× ${(v.total / v.n).toFixed(1)}ms`).join(' · ');
        panel.textContent = `FPS ${f.fps}  frame p95 ${f.p95}ms  máx ${f.max}ms\n` +
            `long tasks ${M.longTasks.n} (${M.longTasks.total.toFixed(0)}ms, máx ${M.longTasks.max.toFixed(0)})  mem ${mem}\n` +
            `carga ${M.cargaGrafico === null ? '…' : M.cargaGrafico.toFixed(0) + 'ms'}  requests ${M.requests.n} (abort ${M.requests.abortados}, err ${M.requests.errores})\n` +
            (calc ? `calc: ${calc}` : '');
    }, 500);

    // ── prueba de carga ──
    const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
    const frames = () => new Promise((r) => requestAnimationFrame(() => r()));

    async function medirFase(nombre, ms, accion) {
        const lt0 = { ...M.longTasks };
        const calc0 = JSON.parse(JSON.stringify(M.calc));
        const draw0 = JSON.parse(JSON.stringify(M.draw));
        const t0 = performance.now();
        const fr = [];
        let prev = t0;
        while (performance.now() - t0 < ms) {
            if (accion) accion(performance.now() - t0);
            await frames();
            const ahora = performance.now();
            fr.push(ahora - prev);
            prev = ahora;
        }
        const delta = (a, b) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { n: v.n - ((b[k] || {}).n || 0), ms: +(v.total - ((b[k] || {}).total || 0)).toFixed(1) }]).filter(([, v]) => v.n > 0));
        return {
            fase: nombre, ...resumenFrames(fr),
            longTasks: M.longTasks.n - lt0.n, longTaskMs: +(M.longTasks.total - lt0.total).toFixed(0),
            calc: delta(M.calc, calc0), draw: Object.values(delta(M.draw, draw0)).reduce((a, v) => a + v.n, 0),
        };
    }

    function sinteticas(n) {
        const out = [];
        let p = 2600;
        const t0 = Math.floor(Date.now() / 900000) * 900000 - n * 900000;
        let s = 12345;
        const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
        for (let i = 0; i < n; i++) {
            const o = p;
            const c = o + (rnd() - 0.5) * 6 + Math.sin(i / 40) * 0.8;
            const h = Math.max(o, c) + rnd() * 2.5, l = Math.min(o, c) - rnd() * 2.5;
            out.push({ timestamp: t0 + i * 900000, open: +o.toFixed(2), high: +h.toFixed(2), low: +l.toFixed(2), close: +c.toFixed(2), volume: Math.round(100 + rnd() * 900) });
            p = c;
        }
        return out;
    }

    /**
     * pruebaCarga({ velas: 1500, dibujos: 10, indicadores: [...], fasesMs: 3000 })
     * Devuelve una tabla por fase. No toca el backend (datos sintéticos).
     */
    api.pruebaCarga = async function ({ velas = 1500, dibujos = 10, indicadores = ['NLT_UNIFIED', 'NLT_SESSIONS', 'NLT_KEY_LEVELS', 'NLT_FREE_ZONES', 'NLT_FVG', 'EMA', 'RSI', 'MACD'], fasesMs = 3000 } = {}) {
        const motor = NLTCharts.motor;
        const chart = motor.chart;
        const datos = sinteticas(velas);
        let empujar = null;
        chart.setDataLoader({
            getBars: ({ type, callback }) => { callback(type === 'init' ? datos : [], { forward: false, backward: false }); },
            subscribeBar: ({ callback }) => { empujar = callback; },
            unsubscribeBar: () => { empujar = null; },
        });
        chart.resetData();
        await esperar(800);
        // Los indicadores que la prueba prende se apagan al final: no cambia la configuración del usuario.
        const antes = new Set(NLTCharts.app ? NLTCharts.app.indicadoresActivos() : []);
        indicadores.forEach((id) => NLTCharts.app && NLTCharts.app.activarIndicador(id));
        const n = datos.length;
        for (let k = 0; k < dibujos; k++) {
            const a = datos[n - 20 - k * 7], b = datos[n - 5 - k * 3];
            const pts = [{ timestamp: a.timestamp, value: a.low }, { timestamp: b.timestamp, value: b.high }];
            const tipos = [['nltRect', 'rect'], ['nltTrend', 'trend'], ['nltFib', 'fib'], ['nltHLine', 'hline'], ['nltTrend', 'ray']];
            const [name, herramienta] = tipos[k % tipos.length];
            chart.createOverlay({ name, groupId: 'diag', points: name === 'nltHLine' ? [pts[0]] : pts, extendData: { estilo: { herramienta } } });
        }
        await esperar(1500);
        const res = [];
        res.push(await medirFase('reposo', 1500));
        let dir = 1;
        res.push(await medirFase('pan', fasesMs, (t) => { chart.scrollByDistance(dir * 14); if (t % 1000 < 17) dir = -dir; }));
        res.push(await medirFase('zoom', fasesMs, (t) => { chart.zoomAtCoordinate(t % 1200 < 600 ? 1.03 : 0.97, { x: 400, y: 200 }); }));
        let ultima = datos[n - 1];
        res.push(await medirFase('ticks de vela', fasesMs, () => {
            if (!empujar) return;
            const c = +(ultima.close + (Math.random() - 0.5)).toFixed(2);
            ultima = { ...ultima, close: c, high: Math.max(ultima.high, c), low: Math.min(ultima.low, c) };
            empujar(ultima);
        }));
        res.push(await medirFase('vela nueva cada 250ms', fasesMs, (t) => {
            if (!empujar || Math.floor(t / 250) === Math.floor((t - 17) / 250)) return;
            ultima = { timestamp: ultima.timestamp + 900000, open: ultima.close, high: ultima.close + 1, low: ultima.close - 1, close: ultima.close + 0.5, volume: 500 };
            empujar(ultima);
        }));
        chart.removeOverlay({ groupId: 'diag' });
        indicadores.filter((id) => !antes.has(id)).forEach((id) => NLTCharts.app && NLTCharts.app.desactivarIndicador(id));
        console.table(res.map((r) => ({ ...r, calc: JSON.stringify(r.calc) })));
        return res;
    };
})();
