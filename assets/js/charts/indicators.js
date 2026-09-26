/* NLT Charts -- indicadores (F4: los FREE).
 *
 * Los FREE se calculan en el navegador: son fórmulas públicas (medias,
 * RSI, MACD...), no hay nada que proteger. Los PRO (Zone Engine y los que
 * vengan) NO van a vivir acá: su lógica se calcula en el backend y el
 * navegador solo recibe el resultado si el backend confirma el acceso
 * (entitlements/trial). Por eso la sección PRO de este panel es solo
 * informativa hasta que exista ese endpoint. */
(function () {
    const CANDLE_PANE = 'candle_pane';

    // Sesiones en hora de Nueva York -- las mismas ventanas que usa el
    // NLT Zone Engine (indicator/NLT_ZONE_ENGINE_V13.4.pine).
    const SESIONES = [
        { id: 'asia', nombre: 'Asia', rgb: '168,85,247', dentro: (h) => h >= 20 || h < 2 },
        { id: 'london', nombre: 'Londres', rgb: '67,120,255', dentro: (h) => h >= 2 && h < 5 },
        { id: 'ny', nombre: 'Nueva York', rgb: '245,158,11', dentro: (h) => h >= 8 && h < 11 },
    ];

    const FREE = [
        { id: 'VOL', nombre: 'Volumen', desc: 'Volumen por vela', pane: 'sub' },
        { id: 'MA', nombre: 'Medias móviles (20, 50)', desc: 'SMA sobre el cierre', pane: 'candle', calcParams: [20, 50] },
        { id: 'EMA', nombre: 'EMA (9, 21)', desc: 'Medias exponenciales', pane: 'candle', calcParams: [9, 21] },
        { id: 'BOLL', nombre: 'Bandas de Bollinger', desc: '20 períodos, 2 desvíos', pane: 'candle' },
        { id: 'RSI', nombre: 'RSI', desc: 'Fuerza relativa (14)', pane: 'sub', calcParams: [14], precision: 2 },
        { id: 'MACD', nombre: 'MACD', desc: '12, 26, 9', pane: 'sub' },
        { id: 'NLT_SESSIONS', nombre: 'Sesiones NLT', desc: 'Asia, Londres y Nueva York (hora NY) en gráficos intradía', pane: 'candle' },
    ];
    const PRO = [
        { id: 'NLT_ZONE_ENGINE', nombre: 'NLT Zone Engine PRO', desc: 'Order blocks, FVG, liquidez y zonas confirmadas' },
    ];

    // Hora de NY por hora UTC: todas las velas de una misma hora UTC
    // comparten la hora de NY, así que se calcula una vez por hora y no por vela.
    const fmtNY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });
    const cacheHoraNY = new Map();
    function horaNY(ts) {
        const clave = Math.floor(ts / 3600000);
        let h = cacheHoraNY.get(clave);
        if (h === undefined) {
            h = Number(fmtNY.format(new Date(clave * 3600000))) % 24;
            if (cacheHoraNY.size > 50000) cacheHoraNY.clear();
            cacheHoraNY.set(clave, h);
        }
        return h;
    }

    let registrados = false;
    function registrar() {
        if (registrados) return;
        registrados = true;
        klinecharts.registerIndicator({
            name: 'NLT_SESSIONS',
            shortName: 'Sesiones',
            figures: [],
            calc: (dataList) => dataList.map((d) => {
                const h = horaNY(d.timestamp);
                const s = SESIONES.find((x) => x.dentro(h));
                return { s: s ? s.id : null };
            }),
            createTooltipDataSource: () => ({ name: 'Sesiones', calcParamsText: '', features: [], legends: [] }),
            draw: ({ ctx, chart, indicator, bounding, xAxis }) => {
                // En 4H y diario una vela abarca varias sesiones: no se marcan.
                const p = chart.getPeriod();
                if (!p || p.type === 'day' || (p.type === 'hour' && p.span > 1)) return false;
                const { from, to } = chart.getVisibleRange();
                const media = chart.getBarSpace().halfGapBar;
                const res = indicator.result;
                const porId = Object.fromEntries(SESIONES.map((s) => [s.id, s]));
                ctx.save();
                ctx.font = '600 10px Inter, system-ui, sans-serif';
                // Etiqueta abajo: arriba está la leyenda OHLC del gráfico.
                ctx.textBaseline = 'bottom';
                let i = from;
                while (i < to) {
                    const s = res[i] && res[i].s;
                    if (!s) { i++; continue; }
                    let j = i;
                    while (j + 1 < to && res[j + 1] && res[j + 1].s === s) j++;
                    const x0 = xAxis.convertToPixel(i) - media;
                    const x1 = xAxis.convertToPixel(j) + media;
                    const ses = porId[s];
                    ctx.fillStyle = `rgba(${ses.rgb},0.07)`;
                    ctx.fillRect(x0, 0, x1 - x0, bounding.height);
                    if (x1 - x0 > 44) {
                        ctx.fillStyle = `rgba(${ses.rgb},0.8)`;
                        ctx.fillText(ses.nombre, x0 + 4, bounding.height - 4);
                    }
                    i = j + 1;
                }
                ctx.restore();
                return false;
            },
        });
    }

    /**
     * montar({ chart, panelEl, panelBgEl, activos, onCambio }) -> { abrir(), aplicar(ids) }
     */
    function montar({ chart, panelEl, panelBgEl, activos, onCambio }) {
        registrar();
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
                <p class="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1 px-2">Gratis</p>
                ${FREE.map((f) => `
                    <label class="ch-ind">
                        <input type="checkbox" data-ind="${esc(f.id)}"${on.has(f.id) ? ' checked' : ''}>
                        <span><span class="ch-ind-name block">${esc(f.nombre)}</span><span class="ch-ind-desc">${esc(f.desc)}</span></span>
                    </label>`).join('')}
                <p class="text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-4 mb-1 px-2">PRO</p>
                ${PRO.map((p) => `
                    <div class="ch-ind" style="cursor:default">
                        <i class="ph-fill ph-lock-simple" style="color:rgb(168,85,247)"></i>
                        <span style="flex:1"><span class="ch-ind-name block">${esc(p.nombre)}</span><span class="ch-ind-desc">${esc(p.desc)}</span></span>
                        <span class="ch-lock">PRÓXIMAMENTE</span>
                    </div>`).join('')}`;
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
        };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.indicators = { montar, FREE, PRO, SESIONES, horaNY };
})();
