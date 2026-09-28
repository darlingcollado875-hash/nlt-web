/* NLT Charts -- barra superior (símbolo, timeframe, indicadores, DEMO).
 * Solo arma la interfaz y avisa por callbacks; no conoce el motor. */
(function () {
    function esc(t) {
        return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /**
     * montarToolbar(el, { simbolos, timeframes, symbol, timeframe, onSymbol, onTimeframe, onIndicadores })
     * -> { setDemo(bool), setSymbol(s), setTimeframe(tf) }
     */
    function montarToolbar(el, o) {
        const porCategoria = {};
        o.simbolos.forEach((s) => { (porCategoria[s.category] ||= []).push(s); });
        const NOMBRE_CATEGORIA = { forex: 'Forex', metals: 'Metales', crypto: 'Cripto', indices: 'Índices' };

        el.innerHTML = `
            <label class="sr-only" for="chSymbol">Símbolo</label>
            <select id="chSymbol" class="ch-select">
                ${Object.entries(porCategoria).map(([cat, lista]) => `<optgroup label="${esc(NOMBRE_CATEGORIA[cat] || cat)}">${lista.map((s) =>
                    `<option value="${esc(s.symbol)}">${esc(s.symbol)}</option>`).join('')}</optgroup>`).join('')}
            </select>
            <button type="button" id="chFav" class="ch-btn ch-fav" title="Agregar a favoritos" aria-label="Agregar a favoritos"><i class="ph ph-star"></i></button>
            <span id="chDemo" class="ch-demo hidden" title="Precios simulados para probar el gráfico. No son precios reales de mercado.">DEMO<span class="ch-btn-label"> · precios simulados</span></span>
            <span id="chConexion" class="ch-conn" data-estado="conectando" role="status" aria-live="polite" title="Conectando con los precios…"><i></i><span class="ch-btn-label">Conectando…</span></span>
            <div class="ch-tfs" role="group" aria-label="Timeframe">
                ${o.timeframes.map((tf) => `<button type="button" class="ch-tf" data-tf="${esc(tf)}">${esc(tf)}</button>`).join('')}
            </div>
            <button type="button" id="chBtnInd" class="ch-btn"><i class="ph ph-function"></i><span class="ch-btn-label">Indicadores</span></button>
            <button type="button" id="chBtnWatch" class="ch-btn" title="Watchlist" aria-label="Watchlist"><i class="ph ph-list-star"></i><span class="ch-btn-label">Watchlist</span></button>
            <button type="button" id="chBtnHistoria" class="ch-btn" title="Ir a fecha / año (Alt+G)" aria-label="Ir a fecha"><i class="ph ph-calendar-blank"></i><span class="ch-btn-label">Ir a fecha</span></button>
            <button type="button" id="chBtnReplay" class="ch-btn ch-lab-btn" title="NLT Bar Replay" aria-label="NLT Bar Replay"><i class="ph ph-clock-counter-clockwise"></i><span class="ch-btn-label">Replay</span></button>
            <button type="button" id="chBtnLab" class="ch-btn ch-lab-btn" title="NLT Backtest Lab" aria-label="NLT Backtest Lab"><i class="ph ph-flask"></i><span class="ch-btn-label">Backtest Lab</span></button>
            <button type="button" id="chBtnConfig" class="ch-btn" title="Configuración del gráfico" aria-label="Configuración del gráfico"><i class="ph ph-gear-six"></i></button>`;

        const sel = el.querySelector('#chSymbol');
        sel.addEventListener('change', () => o.onSymbol(sel.value));
        el.querySelectorAll('.ch-tf').forEach((b) => b.addEventListener('click', () => o.onTimeframe(b.dataset.tf)));
        el.querySelector('#chBtnInd').addEventListener('click', () => o.onIndicadores());
        el.querySelector('#chBtnConfig').addEventListener('click', () => o.onConfig && o.onConfig());
        el.querySelector('#chBtnWatch').addEventListener('click', () => o.onWatchlist && o.onWatchlist());
        el.querySelector('#chFav').addEventListener('click', () => o.onFavorito && o.onFavorito());

        const api = {
            setSymbol(s) { sel.value = s; },
            setTimeframe(tf) {
                el.querySelectorAll('.ch-tf').forEach((b) => b.classList.toggle('on', b.dataset.tf === tf));
            },
            setDemo(demo) { el.querySelector('#chDemo').classList.toggle('hidden', !demo); },
            // Estado de los precios: conectado / retrasado / desconectado / cerrado / conectando.
            // `desde`: hora del último dato recibido; se muestra siempre (salvo mercado cerrado) para
            // que nadie confunda las velas en pantalla con precios actuales.
            setConexion(estado, detalle, desde) {
                const TXT = { conectado: 'Conectado', retrasado: 'Retrasado', desconectado: 'Desconectado', cerrado: 'Mercado cerrado', conectando: 'Conectando…', backtest: 'Histórico · Backtest', replay: 'Bar Replay', historico: 'Histórico' };
                const AYUDA = {
                    conectado: 'Precios en vivo desde NLT.', retrasado: 'Los precios llegan con demora; se reintenta solo.',
                    desconectado: 'Sin conexión con los precios. Se reconecta solo y completa las velas que falten.',
                    cerrado: 'El mercado de este instrumento está cerrado (fin de semana).', conectando: 'Conectando con los precios…',
                    backtest: 'El gráfico muestra las velas históricas de un backtest, no precios en vivo.',
                    replay: 'Bar Replay: el gráfico muestra el mercado histórico hasta la vela actual del replay; lo posterior no existe en el navegador.',
                    historico: 'Histórico: el gráfico muestra un tramo del pasado (Ir a fecha). No son precios en vivo; "Volver al presente" retoma el vivo.',
                };
                const b = el.querySelector('#chConexion');
                b.dataset.estado = estado;
                const viejo = (estado === 'desconectado' || estado === 'retrasado') && desde;
                const conHora = desde && (viejo || estado === 'conectado');
                b.querySelector('.ch-btn-label').textContent = (TXT[estado] || estado) + (conHora ? ` · datos ${desde}` : '');
                b.title = AYUDA[estado] + (estado === 'conectado' && desde ? ` Último dato: ${desde}.` : '')
                    + (viejo ? ` Lo que ves en el gráfico llega hasta ${desde}: no es precio actual.` : '')
                    + (detalle && estado !== 'conectado' ? ` (${detalle})` : '');
            },
            setFavorito(fav) {
                const b = el.querySelector('#chFav');
                b.classList.toggle('on', fav);
                b.innerHTML = `<i class="${fav ? 'ph-fill' : 'ph'} ph-star"></i>`;
                b.title = fav ? 'Quitar de favoritos' : 'Agregar a favoritos';
            },
            setWatchlist(abierta) { el.querySelector('#chBtnWatch').classList.toggle('on', abierta); },
        };
        api.setSymbol(o.symbol);
        api.setTimeframe(o.timeframe);
        return api;
    }

    // Tableros (las tablas que los indicadores de TradingView dibujan con table.new) sobre el
    // panel de velas, en cuatro esquinas. Cada indicador escribe SOLO en su espacio (slot):
    // dos tablas en la misma esquina se apilan en vez de taparse.
    const POSICIONES = ['Top Left', 'Top Right', 'Bottom Left', 'Bottom Right'];
    let host = null, cajaActual = '';
    function hostTableros() {
        if (host && document.body.contains(host)) return host;
        const stage = document.querySelector('.ch-stage');
        if (!stage) return null;
        host = document.createElement('div');
        host.className = 'ud-host';
        host.innerHTML = POSICIONES.map((p) => `<div class="ud-esq" data-pos="${p}"></div>`).join('');
        stage.appendChild(host);
        cajaActual = '';
        return host;
    }
    const tablero = {
        /** slot(pos, id) -> elemento de ese indicador en esa esquina (lo mueve si cambió de esquina). */
        slot(pos, id) {
            const h = hostTableros();
            if (!h) return null;
            const esq = h.querySelector(`.ud-esq[data-pos="${POSICIONES.includes(pos) ? pos : 'Top Right'}"]`);
            let el = h.querySelector(`[data-slot="${id}"]`);
            if (!el) { el = document.createElement('div'); el.className = 'ud-slot'; el.dataset.slot = id; }
            if (el.parentElement !== esq) esq.appendChild(el);
            return el;
        },
        quitar(id) { if (host) { const el = host.querySelector(`[data-slot="${id}"]`); if (el) el.remove(); } },
        // Dentro del área de velas (sin tapar ejes ni sub-paneles); solo toca el DOM si cambió.
        ajustar(chart) {
            const h = hostTableros();
            const main = h && chart.getSize('candle_pane', 'main');
            if (!main) return;
            const k = `${main.left}|${main.top}|${main.width}|${main.height}`;
            if (k === cajaActual) return;
            cajaActual = k;
            Object.assign(h.style, { left: `${main.left}px`, top: `${main.top}px`, width: `${main.width}px`, height: `${main.height}px` });
        },
    };

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.ui = { montarToolbar, esc, tablero };
})();
