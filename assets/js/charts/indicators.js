/* NLT Charts -- panel de indicadores.
 *
 * FREE: se calculan en el navegador. El indicador por defecto es la NLT
 * Unified Suite (unified-suite.js, port del .pine); los demás propios de NLT
 * están en indicators-free.js; los clásicos ("NLT Basics") vienen con el motor.
 * Todos se configuran con el engranaje, como en TradingView (settings.js).
 *
 * PRO: NO se calculan acá. El navegador solo pide al backend el catálogo y,
 * si el backend confirma el acceso (plan o trial), los RESULTADOS para
 * dibujar. Ver pro.js. */
(function () {
    const CANDLE_PANE = 'candle_pane';

    // `params`: entradas de los indicadores clásicos = calcParams del motor.
    const GRUPOS = [
        {
            titulo: 'NLT · gratis',
            items: [
                { id: 'NLT_UNIFIED', nombre: 'NLT Unified Suite', desc: 'Soporte y resistencia, BOS/CHoCH, Order Blocks, FVG, sesiones, liquidez y SMC Market Bias', pane: 'candle', propio: true },
                { id: 'NLT_SESSIONS', nombre: 'NLT Sessions', desc: 'Asia, Londres y Nueva York (hora NY) en gráficos intradía', pane: 'candle', propio: true },
                { id: 'NLT_KEY_LEVELS', nombre: 'NLT Key Levels', desc: 'PDH, PDL, PWH y PWL: máximos y mínimos del día y la semana anteriores', pane: 'candle', propio: true },
                { id: 'NLT_FVG', nombre: 'FVG básico', desc: 'Huecos de 3 velas todavía sin rellenar', pane: 'candle', propio: true },
                { id: 'NLT_FREE_ZONES', nombre: 'NLT Free Zones', desc: 'Oferta y demanda simple: pivotes no testeados', pane: 'candle', propio: true },
            ],
        },
        {
            titulo: 'NLT Basics',
            items: [
                { id: 'VOL', nombre: 'Volumen', pane: 'sub', params: [['Media 1', 5], ['Media 2', 10], ['Media 3', 20]] },
                { id: 'MA', nombre: 'Medias móviles', pane: 'candle', params: [['Período 1', 20], ['Período 2', 50]] },
                { id: 'EMA', nombre: 'EMA', pane: 'candle', params: [['Período 1', 9], ['Período 2', 21]] },
                { id: 'BOLL', nombre: 'Bandas de Bollinger', pane: 'candle', params: [['Período', 20], ['Desvíos', 2]] },
                { id: 'RSI', nombre: 'RSI', pane: 'sub', params: [['Período', 14]], precision: 2 },
                { id: 'MACD', nombre: 'MACD', pane: 'sub', params: [['Rápida', 12], ['Lenta', 26], ['Señal', 9]] },
            ],
        },
    ];
    const FREE = GRUPOS.flatMap((g) => g.items);

    // Los clásicos: sus períodos son entradas configurables (como en TradingView).
    function registrarAjustesBasics() {
        FREE.filter((f) => f.params).forEach((f) => {
            NLTCharts.settings.registrar(f.id, {
                titulo: f.nombre,
                inputs: f.params.map(([titulo, def], k) => ({ id: `p${k}`, tipo: 'int', def, titulo, grupo: 'Entradas', min: 1, max: 500 })),
            });
        });
    }
    const paramsDe = (f) => f.params.map((_, k) => NLTCharts.settings.valores(f.id)[`p${k}`]);

    /**
     * montar({ chart, panelEl, panelBgEl, activos, onCambio, pro }) -> { abrir(), refrescarPanel() }
     *   pro: objeto de pro.js (opcional) que dibuja su propia sección en el panel.
     */
    function montar({ chart, panelEl, panelBgEl, activos, onCambio, pro }) {
        NLTCharts.freeIndicators.registrar();
        NLTCharts.unified.registrar();
        registrarAjustesBasics();
        const esc = NLTCharts.ui.esc;
        const on = new Set();
        let version = 0;

        function activar(id) {
            const def = FREE.find((f) => f.id === id);
            if (!def || on.has(id)) return;
            const crear = { name: id };
            if (def.params) crear.calcParams = paramsDe(def);
            if (def.propio) crear.calcParams = [version];
            if (def.precision != null) crear.precision = def.precision;
            if (def.pane === 'candle') crear.paneId = CANDLE_PANE;
            chart.createIndicator(crear, def.pane === 'candle');
            on.add(id);
        }

        function desactivar(id) {
            if (!on.has(id)) return;
            chart.removeIndicator({ name: id });
            on.delete(id);
            if (id === NLTCharts.unified.ID) NLTCharts.unified.limpiar();
        }

        // Cambiar calcParams es lo que hace que el motor vuelva a calcular.
        function aplicarAjustes(id) {
            const def = FREE.find((f) => f.id === id);
            if (!def || !on.has(id)) return;
            version += 1;
            chart.overrideIndicator({ name: id, calcParams: def.params ? paramsDe(def) : [version] });
        }

        function descripcion(f) {
            if (!f.params) return f.desc;
            return paramsDe(f).join(', ');
        }

        function render() {
            panelEl.innerHTML = `
                <div class="flex items-center justify-between mb-3">
                    <p class="text-sm font-bold">Indicadores</p>
                    <button type="button" data-cerrar class="ch-tool" aria-label="Cerrar"><i class="ph ph-x"></i></button>
                </div>
                ${GRUPOS.map((g) => `
                    <p class="ch-grupo">${esc(g.titulo)}</p>
                    ${g.items.map((f) => `
                        <div class="ch-ind-fila">
                            <label class="ch-ind">
                                <input type="checkbox" data-ind="${esc(f.id)}"${on.has(f.id) ? ' checked' : ''}>
                                <span><span class="ch-ind-name block">${esc(f.nombre)}</span><span class="ch-ind-desc">${esc(descripcion(f))}</span></span>
                            </label>
                            ${NLTCharts.settings.tiene(f.id) ? `<button type="button" class="ch-gear" data-gear="${esc(f.id)}" title="Configuración" aria-label="Configuración de ${esc(f.nombre)}"><i class="ph ph-gear-six"></i></button>` : ''}
                        </div>`).join('')}`).join('')}
                <div id="chProSeccion"></div>`;
            if (pro) pro.renderSeccion(panelEl.querySelector('#chProSeccion'));
        }

        function cerrar() { panelEl.hidden = true; panelBgEl.hidden = true; }

        panelEl.addEventListener('change', (ev) => {
            const id = ev.target.dataset && ev.target.dataset.ind;
            if (!id) return;
            ev.target.checked ? activar(id) : desactivar(id);
            onCambio([...on]);
        });
        panelEl.addEventListener('click', (ev) => {
            if (ev.target.closest('[data-cerrar]')) { cerrar(); return; }
            const g = ev.target.closest('[data-gear]');
            if (!g) return;
            const id = g.dataset.gear;
            if (!on.has(id)) { activar(id); onCambio([...on]); }
            cerrar();
            NLTCharts.settings.abrir(id, () => aplicarAjustes(id));
        });
        panelBgEl.addEventListener('click', cerrar);
        document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !panelEl.hidden) cerrar(); });

        (activos || []).forEach(activar);

        return {
            activar(id) { activar(id); onCambio([...on]); },
            abrir() { render(); panelEl.hidden = false; panelBgEl.hidden = false; },
            refrescarPanel() { if (!panelEl.hidden) render(); },
            // Recalcula los indicadores propios (ej. al cambiar de símbolo el
            // contexto HTF de la Suite).
            recalcular() { FREE.filter((f) => f.propio && on.has(f.id)).forEach((f) => aplicarAjustes(f.id)); },
            abrirAjustes(id) { if (NLTCharts.settings.tiene(id)) NLTCharts.settings.abrir(id, () => aplicarAjustes(id)); },
        };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.indicators = { montar, FREE, GRUPOS };
})();
