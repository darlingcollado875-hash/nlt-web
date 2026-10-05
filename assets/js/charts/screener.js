/* NLT Charts -- Screener (escáner de mercado).
 *
 * Recorre todos los instrumentos de NLT Charts y los compara en una tabla: precio, variación del día, RSI, ADX,
 * posición frente a la EMA 50/200 y el análisis técnico (compra/venta) en varios intervalos a la vez. Se puede filtrar
 * y ordenar; un clic en la fila abre ese símbolo en el gráfico.
 *
 * Datos: 1 pedido de cotizaciones + 1 pedido de velas por símbolo e intervalo (300 velas), de a 3 en paralelo y con
 * caché de 60 s, así recorrer todo queda lejos del límite del servidor (120 pedidos/min por usuario).
 * Es informativo: no es una recomendación de inversión. */
(function () {
    const INTERVALOS = ['5m', '15m', '1H', '4H', '1D'];
    const CACHE_MS = 60000;
    const PARALELO = 3;
    const cache = new Map();   // "SIM|tf" -> { t, analisis, rsi, adx, ema50, ema200, ultimo }

    const aKline = (c) => ({ timestamp: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v });
    const ult = (a) => (a && a.length ? a[a.length - 1] : null);

    async function calcular(sym, tf) {
        const clave = `${sym}|${tf}`;
        const hit = cache.get(clave);
        if (hit && Date.now() - hit.t < CACHE_MS) return hit;
        const r = await NLT_API.chartsVelas(sym, tf, { limit: 300 });
        const d = r.candles.map(aKline);
        const K = NLTCharts.indicatorsExtra.calc;
        const c = d.map((x) => x.close);
        const fila = {
            t: Date.now(), n: d.length, analisis: NLTCharts.ratings.analizar(d), rsi: ult(K.rsi(c, 14)), adx: ult(K.adx(d, 14).adx),
            ema50: ult(K.ema(c, 50)), ema200: ult(K.ema(c, 200)), ultimo: ult(c), precision: r.price_precision,
        };
        cache.set(clave, fila);
        return fila;
    }

    function montar({ simbolos, getSymbol, getTimeframe, onAbrir }) {
        const esc = NLTCharts.ui.esc;
        const btn = document.createElement('button');
        btn.type = 'button'; btn.id = 'chBtnScreener'; btn.className = 'ch-btn'; btn.title = 'Screener: compará todos los instrumentos'; btn.setAttribute('aria-label', 'Screener');
        btn.innerHTML = '<i class="ph ph-table"></i><span class="ch-btn-label">Screener</span>';
        const panel = document.createElement('section');
        panel.className = 'sc'; panel.id = 'chScreener'; panel.hidden = true; panel.setAttribute('aria-label', 'Screener');
        document.body.appendChild(panel);

        let orden = { col: 'sym', dir: 1 };
        let filtro = { rating: '', rsi: '', texto: '' };
        let tfBase = '15m';
        let datos = {};        // sym -> { quote, tf: fila }
        let cargando = false, progreso = [0, 0], token = 0;

        const puntaje = (f) => (f && f.analisis ? f.analisis.todo.puntaje : null);
        const etiqueta = (p) => NLTCharts.ratings.etiqueta(p);
        const color = (p) => (p == null ? '#6B7280' : p >= 0.1 ? '#22C55E' : p <= -0.1 ? '#EF4444' : '#9CA3AF');
        const fmt = (x, d = 2) => (x == null || !Number.isFinite(x) ? '—' : Number(x).toFixed(d));

        function valorOrden(s, col) {
            const d = datos[s.symbol] || {};
            if (col === 'sym') return s.symbol;
            if (col === 'chg') return d.quote ? d.quote.change_pct : null;
            if (col === 'last') return d.quote ? d.quote.last : null;
            if (col === 'rsi') return d[tfBase] ? d[tfBase].rsi : null;
            if (col === 'adx') return d[tfBase] ? d[tfBase].adx : null;
            if (col === 'rating') return puntaje(d[tfBase]);
            if (col.startsWith('tf:')) return puntaje(d[col.slice(3)]);
            return null;
        }
        function filas() {
            const lista = simbolos.filter((s) => {
                const d = datos[s.symbol] || {}, f = d[tfBase];
                if (filtro.texto && !s.symbol.toLowerCase().includes(filtro.texto.toLowerCase())) return false;
                if (filtro.rating) {
                    const p = puntaje(f);
                    if (p == null) return false;
                    if (filtro.rating === 'buy' && !(p >= 0.1)) return false;
                    if (filtro.rating === 'sell' && !(p <= -0.1)) return false;
                    if (filtro.rating === 'neutral' && !(p > -0.1 && p < 0.1)) return false;
                }
                if (filtro.rsi) {
                    if (!f || f.rsi == null) return false;
                    if (filtro.rsi === 'sobrecompra' && !(f.rsi >= 70)) return false;
                    if (filtro.rsi === 'sobreventa' && !(f.rsi <= 30)) return false;
                }
                return true;
            });
            return lista.sort((a, b) => {
                const x = valorOrden(a, orden.col), y = valorOrden(b, orden.col);
                if (x == null && y == null) return 0;
                if (x == null) return 1;
                if (y == null) return -1;
                return (x > y ? 1 : x < y ? -1 : 0) * orden.dir;
            });
        }
        const th = (col, txt, extra = '') => `<th data-col="${esc(col)}" class="${orden.col === col ? 'on' : ''} ${extra}" role="columnheader" tabindex="0">${esc(txt)}${orden.col === col ? (orden.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
        function pintar() {
            const lista = filas();
            const opcionesTf = INTERVALOS.map((t) => `<option value="${t}"${t === tfBase ? ' selected' : ''}>${t}</option>`).join('');
            const cuerpo = lista.map((s) => {
                const d = datos[s.symbol] || {}, q = d.quote, f = d[tfBase];
                const pr = s.price_precision;
                const tend = f && f.ema50 != null && f.ultimo != null ? `${f.ultimo > f.ema50 ? '▲' : '▼'} EMA50${f.ema200 != null ? ` · ${f.ultimo > f.ema200 ? '▲' : '▼'} EMA200` : ''}` : '—';
                return `<tr data-sym="${esc(s.symbol)}" tabindex="0"><td class="sc-sym"><b>${esc(s.symbol)}</b><small>${esc(s.display_name || '')}</small></td>
                    <td>${q && q.last != null ? esc(Number(q.last).toFixed(pr)) : '—'}</td>
                    <td style="color:${q && q.change_pct != null ? (q.change_pct >= 0 ? '#22C55E' : '#EF4444') : '#6B7280'}">${q && q.change_pct != null ? `${q.change_pct >= 0 ? '+' : ''}${q.change_pct.toFixed(2)}%` : '—'}</td>
                    <td style="color:${f && f.rsi != null ? (f.rsi >= 70 ? '#EF4444' : f.rsi <= 30 ? '#22C55E' : '#D1D5DB') : '#6B7280'}">${fmt(f && f.rsi, 1)}</td>
                    <td>${fmt(f && f.adx, 1)}</td><td class="sc-tend">${esc(tend)}</td>
                    ${INTERVALOS.map((t) => { const p = puntaje(d[t]); return `<td class="sc-rat" style="color:${color(p)}">${p == null ? (cargando ? '…' : '—') : esc(etiqueta(p))}</td>`; }).join('')}</tr>`;
            }).join('');
            panel.innerHTML = `<div class="sc-cab"><b>Screener</b>
                <label>Intervalo <select data-f="tf" class="mc-sel">${opcionesTf}</select></label>
                <label>Análisis <select data-f="rating" class="mc-sel"><option value="">Todos</option><option value="buy"${filtro.rating === 'buy' ? ' selected' : ''}>Compra</option><option value="sell"${filtro.rating === 'sell' ? ' selected' : ''}>Venta</option><option value="neutral"${filtro.rating === 'neutral' ? ' selected' : ''}>Neutral</option></select></label>
                <label>RSI <select data-f="rsi" class="mc-sel"><option value="">Todos</option><option value="sobrecompra"${filtro.rsi === 'sobrecompra' ? ' selected' : ''}>Sobrecompra (≥70)</option><option value="sobreventa"${filtro.rsi === 'sobreventa' ? ' selected' : ''}>Sobreventa (≤30)</option></select></label>
                <input data-f="texto" class="mc-sel" placeholder="Buscar símbolo" value="${esc(filtro.texto)}" aria-label="Buscar símbolo">
                <button type="button" data-sc="refrescar" class="mc-d" ${cargando ? 'disabled' : ''}>${cargando ? `Cargando ${progreso[0]}/${progreso[1]}…` : 'Actualizar'}</button>
                <button type="button" data-sc="cerrar" class="ch-tool" aria-label="Cerrar"><i class="ph ph-x"></i></button></div>
                <div class="sc-tabla"><table><thead><tr>${th('sym', 'Símbolo')}${th('last', 'Precio')}${th('chg', 'Var. día')}${th('rsi', `RSI ${tfBase}`)}${th('adx', `ADX ${tfBase}`)}<th>Tendencia ${esc(tfBase)}</th>${INTERVALOS.map((t) => th(`tf:${t}`, `Análisis ${t}`, 'sc-rat')).join('')}</tr></thead>
                <tbody>${cuerpo || '<tr><td colspan="11" class="sc-vacio">Ningún instrumento cumple los filtros.</td></tr>'}</tbody></table></div>
                <p class="mc-nota">Informativo, calculado con 300 velas por intervalo. No es una recomendación de inversión. Tocá una fila para abrirla en el gráfico.</p>`;
        }

        async function cargarTodo(forzar) {
            if (cargando) return;
            if (forzar) cache.clear();
            cargando = true; const mio = ++token;
            const trabajos = [];
            const orden0 = [tfBase, ...INTERVALOS.filter((t) => t !== tfBase)];
            orden0.forEach((tf) => simbolos.forEach((s) => trabajos.push([s.symbol, tf])));
            progreso = [0, trabajos.length]; pintar();
            try {
                const r = await NLT_API.chartsQuotes(simbolos.map((s) => s.symbol));
                (r.quotes || []).forEach((q) => { (datos[q.symbol] = datos[q.symbol] || {}).quote = q; });
            } catch (_) { /* sin cotizaciones: la tabla igual muestra el análisis */ }
            let i = 0;
            async function obrero() {
                while (i < trabajos.length && mio === token) {
                    const [sym, tf] = trabajos[i++];
                    try { (datos[sym] = datos[sym] || {})[tf] = await calcular(sym, tf); } catch (_) { /* ese símbolo/intervalo queda en — */ }
                    progreso[0]++;
                    if (mio === token && !panel.hidden && progreso[0] % 2 === 0) pintar();
                }
            }
            await Promise.all(Array.from({ length: PARALELO }, obrero));
            if (mio === token) { cargando = false; if (!panel.hidden) pintar(); }
        }

        function abrir() { tfBase = INTERVALOS.includes(getTimeframe()) ? getTimeframe() : '15m'; panel.hidden = false; pintar(); cargarTodo(false); }
        function cerrar() { panel.hidden = true; token++; cargando = false; }
        btn.addEventListener('click', () => (panel.hidden ? abrir() : cerrar()));
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) cerrar(); });
        panel.addEventListener('click', (e) => {
            const a = e.target.closest('[data-sc]');
            if (a) { if (a.dataset.sc === 'cerrar') cerrar(); else cargarTodo(true); return; }
            const h = e.target.closest('th[data-col]');
            if (h) { const col = h.dataset.col; orden = { col, dir: orden.col === col ? -orden.dir : (col === 'sym' ? 1 : -1) }; pintar(); return; }
            const fila = e.target.closest('tr[data-sym]');
            if (fila) { cerrar(); onAbrir(fila.dataset.sym, tfBase); }
        });
        panel.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const f = e.target.closest('tr[data-sym]'); if (f) { cerrar(); onAbrir(f.dataset.sym, tfBase); } } });
        panel.addEventListener('change', (e) => {
            const k = e.target.dataset && e.target.dataset.f;
            if (!k) return;
            if (k === 'tf') { tfBase = e.target.value; pintar(); cargarTodo(false); return; }
            filtro[k] = e.target.value; pintar();
        });
        panel.addEventListener('input', (e) => {
            if (e.target.dataset && e.target.dataset.f === 'texto') {
                filtro.texto = e.target.value; const pos = e.target.selectionStart; pintar();
                const inp = panel.querySelector('[data-f="texto"]'); if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
            }
        });

        const ancla = document.getElementById('chBtnConfig');
        if (ancla) ancla.before(btn);
        return { abrir, cerrar };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.screener = { montar, calcular, INTERVALOS };
})();
