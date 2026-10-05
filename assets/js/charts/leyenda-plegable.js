/* NLT Charts -- botón para plegar/desplegar la lista de indicadores del gráfico.
 * Con muchos indicadores sus nombres tapan las velas: plegada solo queda el botón con la cantidad. Se recuerda entre visitas.
 * Es solo visual: plegar no quita ni recalcula nada. */
(function () {
    function montar({ chart, stageEl, state }) {
        if (!chart || !stageEl) return null;
        let plegada = false;
        try { plegada = !!(state && state.prefs().leyendaPlegada); } catch (_) { /* sin preferencias */ }
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'ch-leyenda-btn'; btn.hidden = true;
        stageEl.appendChild(btn);

        const cuantos = () => { try { return chart.getIndicators().length; } catch (_) { return 0; } };
        let ultimo = -1;
        function pintar() {
            const n = cuantos();
            btn.hidden = n === 0;
            btn.classList.toggle('plegada', plegada);
            btn.setAttribute('aria-expanded', String(!plegada));
            btn.title = plegada ? 'Mostrar la lista de indicadores' : 'Ocultar la lista de indicadores';
            btn.innerHTML = `<i class="ph ph-caret-down"></i><span>Indicadores</span><b>${n}</b>`;
        }
        function aplicar() {
            // 'none' esconde nombres, valores y botones de todos los indicadores; el espacio de arriba queda para este botón
            chart.setStyles({ indicator: { tooltip: { showRule: plegada ? 'none' : 'always' } }, candle: { tooltip: { offsetTop: 28 } } });
            pintar();
        }
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            plegada = !plegada;
            try { state && state.savePrefs({ leyendaPlegada: plegada }); } catch (_) { /* no guardar no es grave */ }
            aplicar();
        });
        aplicar();
        // la cantidad cambia al agregar/quitar indicadores (de cualquier módulo): se revisa barato y solo se toca el DOM si cambió
        setInterval(() => { const n = cuantos(); if (n !== ultimo) { ultimo = n; pintar(); } }, 600);
        return { alternar: () => btn.click(), plegada: () => plegada };
    }
    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.leyendaPlegable = { montar };
})();
