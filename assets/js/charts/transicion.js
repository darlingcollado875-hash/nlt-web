/* NLT Charts -- transición premium al cambiar de temporalidad / símbolo / modo.
 *
 * KLineChart vacía el gráfico en cuanto se cambia el período, y hasta que llegan las velas nuevas se veía una
 * pantalla en blanco (en el replay, 15-20 s). Aquí se toma una FOTO del gráfico justo antes del cambio y se deja
 * encima, atenuada, con una etiqueta de "Cambiando a 1m" y una barra de progreso; cuando llegan las velas nuevas la
 * foto se desvanece (crossfade) y las velas nuevas entran con un pequeño acercamiento. Solo es visual: los datos no se tocan.
 * Sin blur en Safari / equipos de nivel bajo, y con "reducir movimiento" solo hay un cambio de opacidad. */
(function () {
    function montar({ chart, stageEl }) {
        if (!chart || !stageEl) return { iniciar() {}, terminar() {} };
        let capa = null, vigilante = null, reloj = null, retenida = false, pendiente = false;
        const reducido = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };

        function quitar(c) { if (c && c.parentNode) c.parentNode.removeChild(c); }
        function terminar(forzar) {
            if (retenida && !forzar) { pendiente = true; return; }       // otra operación sigue en curso (p. ej. el replay creando su sesión)
            clearTimeout(vigilante);
            if (!capa) return;
            clearInterval(reloj);
            const c = capa; capa = null;
            c.classList.remove('on'); c.classList.add('sale');
            stageEl.classList.add('ch-entra');
            setTimeout(() => stageEl.classList.remove('ch-entra'), 520);
            setTimeout(() => quitar(c), 380);
        }
        /** iniciar('Cambiando a 1m'): foto del gráfico actual + etiqueta. Si ya hay una transición en curso solo cambia el texto. */
        function iniciar(texto) {
            if (capa) { const t = capa.querySelector('[data-t]'); if (t) t.textContent = texto; return; }
            let foto = null;
            try { if (chart.getDataList().length) foto = chart.getConvertPictureUrl(true, 'jpeg', '#0B0E14'); } catch (_) { foto = null; }
            const c = document.createElement('div');
            c.className = 'ch-tran'; c.setAttribute('role', 'status'); c.setAttribute('aria-live', 'polite');
            c.innerHTML = `${foto ? `<img class="ch-tran-foto" alt="" src="${foto}">` : '<div class="ch-tran-foto vacio"></div>'}
                <div class="ch-tran-chip"><i class="ph ph-circle-notch"></i><span data-t>${texto}</span><em data-s></em></div>
                <div class="ch-tran-barra"><i></i></div>`;
            stageEl.appendChild(c);
            capa = c;
            // si tarda (fechas lejanas: el proveedor de precios entrega la historia antigua de a poco) se ve que sigue vivo y cuánto lleva
            const t0 = Date.now();
            clearInterval(reloj);
            reloj = setInterval(() => {
                const seg = Math.round((Date.now() - t0) / 1000), e = c.querySelector('[data-s]');
                if (!e) return;
                e.textContent = seg >= 6 ? ` · ${seg} s${seg >= 15 ? ' · una fecha lejana tarda más' : ''}` : '';
            }, 1000);
            requestAnimationFrame(() => requestAnimationFrame(() => c.classList.add('on')));
            // seguro: si por algún motivo nunca llegan datos, la capa no se queda para siempre
            clearTimeout(vigilante);
            vigilante = setTimeout(() => { retenida = false; terminar(true); }, 90000);
        }
        /** retener(true): ignora los "ya llegaron datos" de cargas anteriores (la carga en vivo que sigue a salir del backtest) hasta retener(false). */
        function retener(si) { retenida = !!si; if (!si && pendiente) { pendiente = false; /* los datos de la nueva operación llegan después: la quitan ellos */ } }
        return { iniciar, terminar, retener, activa: () => !!capa };
    }
    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.transicion = { montar };
})();
