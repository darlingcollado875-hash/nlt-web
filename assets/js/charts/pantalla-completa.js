/* NLT Charts -- botón de pantalla completa del gráfico (esquina inferior izquierda).
 * Oculta la barra lateral de NLT para dar todo el ancho al gráfico; el mismo botón vuelve a la vista normal.
 * Además pide al navegador su pantalla completa real (si no la permite, p. ej. iPhone, queda solo el modo sin barra lateral).
 * El gráfico se reajusta solo: engine.js ya observa el tamaño de su contenedor. */
(function () {
    function montar({ stageEl }) {
        if (!stageEl) return null;
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'ch-pc';
        stageEl.appendChild(btn);
        let activo = false;
        const pintar = () => {
            btn.setAttribute('aria-pressed', String(activo));
            btn.title = activo ? 'Salir de pantalla completa' : 'Pantalla completa';
            btn.setAttribute('aria-label', btn.title);
            btn.innerHTML = `<i class="ph ${activo ? 'ph-corners-in' : 'ph-corners-out'}"></i>`;
        };
        const pedirNavegador = () => {
            const el = document.documentElement;
            try { const p = el.requestFullscreen && el.requestFullscreen({ navigationUI: 'hide' }); if (p && p.catch) p.catch(() => { /* sin pantalla completa del navegador: basta con ocultar la barra */ }); } catch (_) { /* no soportado */ }
        };
        const salirNavegador = () => {
            try { if (document.fullscreenElement && document.exitFullscreen) { const p = document.exitFullscreen(); if (p && p.catch) p.catch(() => {}); } } catch (_) { /* ya salió */ }
        };
        function poner(v) {
            activo = !!v;
            document.body.classList.toggle('ch-full', activo);
            if (activo) pedirNavegador(); else salirNavegador();
            pintar();
            window.dispatchEvent(new Event('resize'));       // por si algún módulo mide el ancho por su cuenta
        }
        btn.addEventListener('click', (e) => { e.stopPropagation(); poner(!activo); });
        // el usuario salió con Esc del navegador: se vuelve también a la vista normal
        document.addEventListener('fullscreenchange', () => { if (activo && !document.fullscreenElement) { activo = false; document.body.classList.remove('ch-full'); pintar(); window.dispatchEvent(new Event('resize')); } });
        pintar();
        return { poner, activo: () => activo };
    }
    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.pantallaCompleta = { montar };
})();
