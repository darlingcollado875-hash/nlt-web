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
        const NOMBRE_CATEGORIA = { forex: 'Forex', metals: 'Metales', crypto: 'Cripto' };

        el.innerHTML = `
            <label class="sr-only" for="chSymbol">Símbolo</label>
            <select id="chSymbol" class="ch-select">
                ${Object.entries(porCategoria).map(([cat, lista]) => `<optgroup label="${esc(NOMBRE_CATEGORIA[cat] || cat)}">${lista.map((s) =>
                    `<option value="${esc(s.symbol)}">${esc(s.symbol)}</option>`).join('')}</optgroup>`).join('')}
            </select>
            <button type="button" id="chFav" class="ch-btn ch-fav" title="Agregar a favoritos" aria-label="Agregar a favoritos"><i class="ph ph-star"></i></button>
            <span id="chDemo" class="ch-demo hidden" title="Precios simulados para probar el gráfico. No son precios reales de mercado.">DEMO<span class="ch-btn-label"> · precios simulados</span></span>
            <div class="ch-tfs" role="group" aria-label="Timeframe">
                ${o.timeframes.map((tf) => `<button type="button" class="ch-tf" data-tf="${esc(tf)}">${esc(tf)}</button>`).join('')}
            </div>
            <button type="button" id="chBtnInd" class="ch-btn"><i class="ph ph-function"></i><span class="ch-btn-label">Indicadores</span></button>
            <button type="button" id="chBtnWatch" class="ch-btn" title="Watchlist" aria-label="Watchlist"><i class="ph ph-list-star"></i><span class="ch-btn-label">Watchlist</span></button>
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

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.ui = { montarToolbar, esc };
})();
