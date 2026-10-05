/* NLT Charts -- Análisis técnico (como el "Technical Rating" de TradingView).
 *
 * Con las velas ya cargadas del gráfico calcula, para el símbolo y el intervalo que se están viendo, el voto de
 * cada oscilador y cada media móvil (Comprar / Vender / Neutral) y los resume en un medidor. Es solo informativo:
 * no es una recomendación de inversión. Todo se calcula en el navegador con indicators-extra.js (sin pedidos). */
(function () {
    const C = () => NLTCharts.indicatorsExtra.calc;
    const ult = (a, k = 0) => (a && a.length > k ? a[a.length - 1 - k] : null);
    const ok = (x) => x != null && Number.isFinite(x);

    // Voto: 1 comprar, -1 vender, 0 neutral. null = faltan velas para calcularlo.
    function osciladores(d) {
        const c = d.map((x) => x.close), K = C(), out = [];
        const add = (nombre, valor, voto, dec = 2) => { if (ok(valor) && voto != null) out.push({ nombre, valor: Number(valor).toFixed(dec), voto }); };
        const r = K.rsi(c, 14);
        if (ok(ult(r)) && ok(ult(r, 1))) add('RSI (14)', ult(r), ult(r) < 30 && ult(r) > ult(r, 1) ? 1 : ult(r) > 70 && ult(r) < ult(r, 1) ? -1 : 0);
        const st = K.stoch(d, 14, 3, 3);
        if (ok(ult(st.k)) && ok(ult(st.d))) add('Estocástico %K (14, 3, 3)', ult(st.k), ult(st.k) < 20 && ult(st.k) > ult(st.d) ? 1 : ult(st.k) > 80 && ult(st.k) < ult(st.d) ? -1 : 0);
        const cc = K.cci(d, 20);
        if (ok(ult(cc)) && ok(ult(cc, 1))) add('CCI (20)', ult(cc), ult(cc) < -100 && ult(cc) > ult(cc, 1) ? 1 : ult(cc) > 100 && ult(cc) < ult(cc, 1) ? -1 : 0);
        const ax = K.adx(d, 14);
        if (ok(ult(ax.adx)) && ok(ult(ax.pdi, 1))) {
            const cruceArriba = ult(ax.pdi, 1) <= ult(ax.mdi, 1) && ult(ax.pdi) > ult(ax.mdi), cruceAbajo = ult(ax.pdi, 1) >= ult(ax.mdi, 1) && ult(ax.pdi) < ult(ax.mdi);
            add('ADX (14)', ult(ax.adx), ult(ax.adx) > 20 && cruceArriba ? 1 : ult(ax.adx) > 20 && cruceAbajo ? -1 : 0);
        }
        const a = K.ao(d);
        if (ok(ult(a)) && ok(ult(a, 2))) {
            const cruce = (ult(a, 1) <= 0 && ult(a) > 0) ? 1 : (ult(a, 1) >= 0 && ult(a) < 0) ? -1 : 0;
            const platillo = ult(a) > 0 && ult(a, 1) > 0 && ult(a, 2) > 0 && ult(a, 1) < ult(a, 2) && ult(a) > ult(a, 1) ? 1 : ult(a) < 0 && ult(a, 1) < 0 && ult(a, 2) < 0 && ult(a, 1) > ult(a, 2) && ult(a) < ult(a, 1) ? -1 : 0;
            add('Awesome Oscillator', ult(a), cruce || platillo, 5);
        }
        const m = K.mom(c, 10);
        if (ok(ult(m)) && ok(ult(m, 1))) add('Momentum (10)', ult(m), ult(m) > ult(m, 1) ? 1 : ult(m) < ult(m, 1) ? -1 : 0, 5);
        const mc = K.macd(c, 12, 26, 9);
        if (ok(ult(mc.line)) && ok(ult(mc.sig))) add('MACD (12, 26)', ult(mc.line), ult(mc.line) > ult(mc.sig) ? 1 : ult(mc.line) < ult(mc.sig) ? -1 : 0, 5);
        const sr = K.stochRsi(c, 14, 3, 3, 14);
        if (ok(ult(sr.k)) && ok(ult(sr.d))) add('Stoch RSI (14)', ult(sr.k), ult(sr.k) < 20 && ult(sr.d) < 20 && ult(sr.k) > ult(sr.d) ? 1 : ult(sr.k) > 80 && ult(sr.d) > 80 && ult(sr.k) < ult(sr.d) ? -1 : 0);
        const w = K.williams(d, 14);
        if (ok(ult(w)) && ok(ult(w, 1))) add('Williams %R (14)', ult(w), ult(w) < -80 && ult(w) > ult(w, 1) ? 1 : ult(w) > -20 && ult(w) < ult(w, 1) ? -1 : 0);
        const u = K.uo(d);
        if (ok(ult(u))) add('Ultimate Oscillator', ult(u), ult(u) > 70 ? 1 : ult(u) < 30 ? -1 : 0);
        return out;
    }
    function medias(d) {
        const c = d.map((x) => x.close), K = C(), precio = ult(c), out = [];
        const add = (nombre, v) => { if (ok(v)) out.push({ nombre, valor: v.toFixed(5), voto: precio > v ? 1 : precio < v ? -1 : 0 }); };
        [10, 20, 30, 50, 100, 200].forEach((n) => { add(`EMA (${n})`, ult(K.ema(c, n))); add(`SMA (${n})`, ult(K.sma(c, n))); });
        const ich = K.ichimoku(d); add('Ichimoku (línea base)', ult(ich.k));
        add('VWAP', ult(K.vwap(d)));
        add('Hull MA (9)', ult(K.hma(c, 9)));
        return out;
    }
    const resumenDe = (lista) => {
        const compras = lista.filter((x) => x.voto > 0).length, ventas = lista.filter((x) => x.voto < 0).length, neutrales = lista.length - compras - ventas;
        return { compras, ventas, neutrales, puntaje: lista.length ? (compras - ventas) / lista.length : 0, n: lista.length };
    };
    const etiqueta = (p) => (p >= 0.5 ? 'Compra fuerte' : p >= 0.1 ? 'Compra' : p > -0.1 ? 'Neutral' : p > -0.5 ? 'Venta' : 'Venta fuerte');
    const colorDe = (p) => (p >= 0.1 ? '#22C55E' : p <= -0.1 ? '#EF4444' : '#9CA3AF');

    function analizar(datos) {
        if (!datos || datos.length < 30) return null;
        const o = osciladores(datos), m = medias(datos);
        const ro = resumenDe(o), rm = resumenDe(m), todo = resumenDe([...o, ...m]);
        return { osciladores: o, medias: m, ro, rm, todo };
    }

    function montar({ chart, getSymbol, getTimeframe }) {
        const esc = NLTCharts.ui.esc;
        const btn = document.createElement('button');
        btn.type = 'button'; btn.id = 'chBtnAnalisis'; btn.className = 'ch-btn'; btn.title = 'Análisis técnico'; btn.setAttribute('aria-label', 'Análisis técnico');
        btn.innerHTML = '<i class="ph ph-gauge"></i><span class="ch-btn-label">Análisis</span>';
        const pop = document.createElement('div');
        pop.className = 'mc-menu an-pop'; pop.id = 'chAnalisis'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Análisis técnico');
        document.body.appendChild(pop);

        const medidor = (titulo, r, grande) => {
            const pos = Math.round(((r.puntaje + 1) / 2) * 100);
            return `<div class="an-med${grande ? ' grande' : ''}"><div class="an-med-t">${esc(titulo)}</div><div class="an-med-v" style="color:${colorDe(r.puntaje)}">${esc(etiqueta(r.puntaje))}</div>
                <div class="an-barra"><i style="left:${pos}%"></i></div>
                <div class="an-cuentas"><span style="color:#EF4444">Vender ${r.ventas}</span><span>Neutral ${r.neutrales}</span><span style="color:#22C55E">Comprar ${r.compras}</span></div></div>`;
        };
        const tabla = (lista) => `<table class="an-tab">${lista.map((x) => `<tr><td>${esc(x.nombre)}</td><td>${esc(x.valor)}</td><td style="color:${x.voto > 0 ? '#22C55E' : x.voto < 0 ? '#EF4444' : '#9CA3AF'}">${x.voto > 0 ? 'Comprar' : x.voto < 0 ? 'Vender' : 'Neutral'}</td></tr>`).join('')}</table>`;
        function pintar() {
            const a = analizar(chart.getDataList());
            const cab = `<div class="mc-tit">Análisis técnico · ${esc(getSymbol())} · ${esc(getTimeframe())}</div>`;
            if (!a) { pop.innerHTML = `${cab}<p class="mc-nota">Todavía no hay suficientes velas cargadas para analizar.</p>`; return; }
            pop.innerHTML = `${cab}${medidor('Resumen', a.todo, true)}<div class="an-dos">${medidor('Osciladores', a.ro)}${medidor('Medias móviles', a.rm)}</div>
                <details><summary>Osciladores (${a.ro.n})</summary>${tabla(a.osciladores)}</details><details><summary>Medias móviles (${a.rm.n})</summary>${tabla(a.medias)}</details>
                <p class="mc-nota">Informativo, calculado con las velas del gráfico. No es una recomendación de inversión.</p>`;
        }
        let timer = null;
        function cerrar() { pop.hidden = true; clearInterval(timer); timer = null; }
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!pop.hidden) { cerrar(); return; }
            document.querySelectorAll('.mc-menu').forEach((m) => { m.hidden = true; });
            pintar(); pop.hidden = false;
            const r = btn.getBoundingClientRect();
            pop.style.top = `${r.bottom + 6}px`; pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
            timer = setInterval(() => { if (!pop.hidden && !document.hidden) { const abiertos = [...pop.querySelectorAll('details')].map((x) => x.open); pintar(); pop.querySelectorAll('details').forEach((x, i) => { x.open = abiertos[i]; }); } }, 5000);
        });
        document.addEventListener('click', (e) => { if (!pop.hidden && !e.target.closest('#chAnalisis') && !e.target.closest('#chBtnAnalisis')) cerrar(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(); });
        const ancla = document.getElementById('chBtnConfig');
        if (ancla) ancla.before(btn);
        return { analizar: () => analizar(chart.getDataList()) };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.ratings = { montar, analizar, osciladores, medias, etiqueta };
})();
