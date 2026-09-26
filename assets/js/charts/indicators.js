/* NLT Charts -- panel de indicadores.
 *
 * FREE: se calculan en el navegador (fórmulas públicas). Los propios de NLT
 * están en indicators-free.js; los clásicos ("NLT Basics") vienen con el motor.
 *
 * PRO: NO se calculan acá. El navegador solo pide al backend el catálogo y,
 * si el backend confirma el acceso (plan o trial), los RESULTADOS para
 * dibujar. Ver pro.js. */
(function () {
    const CANDLE_PANE = 'candle_pane';

    const GRUPOS = [
        {
            titulo: 'NLT · gratis',
            items: [
                { id: 'NLT_SESSIONS', nombre: 'NLT Sessions', desc: 'Asia, Londres y Nueva York (hora NY) en gráficos intradía', pane: 'candle' },
                { id: 'NLT_KEY_LEVELS', nombre: 'NLT Key Levels', desc: 'PDH, PDL, PWH y PWL: máximos y mínimos del día y la semana anteriores', pane: 'candle' },
                { id: 'NLT_FVG', nombre: 'FVG básico', desc: 'Huecos de 3 velas todavía sin rellenar', pane: 'candle' },
                { id: 'NLT_FREE_ZONES', nombre: 'NLT Free Zones', desc: 'Oferta y demanda simple: pivotes no testeados', pane: 'candle' },
            ],
        },
        {
            titulo: 'NLT Basics',
            items: [
                { id: 'VOL', nombre: 'Volumen', desc: 'Volumen por vela', pane: 'sub' },
                { id: 'MA', nombre: 'Medias móviles (20, 50)', desc: 'SMA sobre el cierre', pane: 'candle', calcParams: [20, 50] },
                { id: 'EMA', nombre: 'EMA (9, 21)', desc: 'Medias exponenciales', pane: 'candle', calcParams: [9, 21] },
                { id: 'BOLL', nombre: 'Bandas de Bollinger', desc: '20 períodos, 2 desvíos', pane: 'candle' },
                { id: 'RSI', nombre: 'RSI', desc: 'Fuerza relativa (14)', pane: 'sub', calcParams: [14], precision: 2 },
                { id: 'MACD', nombre: 'MACD', desc: '12, 26, 9', pane: 'sub' },
            ],
        },
    ];
    const FREE = GRUPOS.flatMap((g) => g.items);

    /**
     * montar({ chart, panelEl, panelBgEl, activos, onCambio, pro }) -> { abrir() }
     *   pro: objeto de pro.js (opcional) que dibuja su propia sección en el panel.
     */
    function montar({ chart, panelEl, panelBgEl, activos, onCambio, pro }) {
        NLTCharts.freeIndicators.registrar();
        const esc = NLTCharts.ui.esc;
        const on = new Set();

        function activar(id) {
            const def = FREE.find((f) => f.id === id);
            if (!def || on.has(id)) return;
            const crear = { name: id };
            if (def.calcParams) crear.calcParams = def.calcParams;
            if (def.precision != null) crear.precision = def.precision;
            if (def.pane === 'candle') crear.paneId = CANDLE_PANE;
            chart.createIndicator(crear, def.pane === 'candle');
            on.add(id);
        }

        function desactivar(id) {
            if (!on.has(id)) return;
            chart.removeIndicator({ name: id });
            on.delete(id);
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
                        <label class="ch-ind">
                            <input type="checkbox" data-ind="${esc(f.id)}"${on.has(f.id) ? ' checked' : ''}>
                            <span><span class="ch-ind-name block">${esc(f.nombre)}</span><span class="ch-ind-desc">${esc(f.desc)}</span></span>
                        </label>`).join('')}`).join('')}
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
        panelEl.addEventListener('click', (ev) => { if (ev.target.closest('[data-cerrar]')) cerrar(); });
        panelBgEl.addEventListener('click', cerrar);
        document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !panelEl.hidden) cerrar(); });

        (activos || []).forEach(activar);

        return {
            abrir() { render(); panelEl.hidden = false; panelBgEl.hidden = false; },
            refrescarPanel() { if (!panelEl.hidden) render(); },
        };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.indicators = { montar, FREE, GRUPOS };
})();
