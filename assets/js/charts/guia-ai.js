/* Guía de bienvenida de los indicadores PRO en NLT Charts.
 * Se abre sola tras una compra (?bienvenida=ai|zone, enlace de la notificación) o a mano con el botón
 * «Ver guía» de la tarjeta NLT AI / la paleta (Ctrl+K). Usa el tour del ecosistema (NLT.startTour):
 * fase 1 con el panel de Indicadores abierto, fase 2 sobre el gráfico. Solo explica; no toca datos. */
(function () {
    'use strict';
    const esperar = (fn, ms) => new Promise((ok) => {
        const t0 = Date.now();
        (function p() { const r = fn(); if (r || Date.now() - t0 > ms) ok(r); else setTimeout(p, 150); })();
    });
    const tourAbierto = () => !!document.getElementById('nlt-tour');
    async function finTour() { await esperar(() => !tourAbierto(), 120000); }

    async function iniciar(modo, forzar) {
        if (!window.NLT || !NLT.startTour || tourAbierto()) return false;
        const KEY = 'charts-guia-pro-v1';
        try { if (!forzar && localStorage.getItem('nlt_tour_' + KEY)) return false; } catch (_) { /* sin storage */ }
        const btn = document.getElementById('chBtnInd');
        const panel = document.getElementById('chPanel');
        if (!btn || !panel) return false;
        if (panel.hidden) btn.click();
        await esperar(() => panel.querySelector('[data-pro-card]'), 8000);

        const ai = { sel: '[data-pro-card="NLT_INDICATOR_AI"] .ch-pro-head', title: 'NLT Indicator AI, activo', text: 'Tu compra ya está activada. Aquí enciendes el panel de IA y abres sus ajustes. Puedes fijarlo con la estrella para tenerlo siempre a mano.' };
        const ze = { sel: '[data-pro-card="NLT_ZONE_ENGINE"] .ch-pro-head', title: 'NLT Zone Engine PRO', text: 'Order Blocks y FVG del motor NLT con su estado en vivo. El engranaje abre sus ajustes.' };
        const fase1 = (modo === 'zone' ? [ze, ai] : [ai, ze]);
        // El tour centra con scroll suave y coloca su tarjeta a los 380 ms: dejamos el panel ya en su sitio.
        const primero = document.querySelector(fase1[0].sel);
        if (primero) primero.scrollIntoView({ block: 'center', behavior: 'instant' });
        const lanzo = NLT.startTour(fase1, { key: KEY, force: true });
        if (lanzo) await finTour();
        panel.hidden = true;
        const bg = document.getElementById('chPanelBg'); if (bg) bg.hidden = true;

        NLT.startTour([
            { sel: document.querySelector('#chTools [data-tool="rect"]') ? '#chTools [data-tool="rect"]' : '#chTools', title: '1 · Dibuja tu zona', text: 'Con el rectángulo marca la zona que quieres evaluar: toca una esquina y después la opuesta.' },
            { sel: '#chBtnInd', title: '2 · Activa el panel', text: 'En Indicadores enciende «Mostrar panel NLT AI». Ahí ves el estado de tu zona.' },
            { sel: '#chart', title: '3 · NLT Engine → Analizar zona', text: 'Toca tu rectángulo y pulsa «NLT Engine» para conectarlo. Luego «Analizar zona» en el panel NLT AI: sale un aviso con el resumen (entrada óptima o no válida) y el reporte completo queda en «Reportes».' },
        ], { key: KEY + '-2', force: true });
        try { localStorage.setItem('nlt_tour_' + KEY, '1'); } catch (_) { /* noop */ }
        return true;
    }

    function limpiarUrl() {
        try { const u = new URL(location.href); u.searchParams.delete('bienvenida'); history.replaceState(null, '', u); } catch (_) { /* noop */ }
    }

    window.NLTGuiaPro = { iniciar: (m) => iniciar(m || 'ai', true) };
    if (window.NLT && NLT.registerPaletteAction) {
        NLT.registerPaletteAction({ label: 'Guía de indicadores PRO', icon: 'ph-sparkle', rgb: '67,120,255', kw: 'guia tour ayuda nlt ai zone engine', run: () => iniciar('ai', true) });
    }
    const modo = new URLSearchParams(location.search).get('bienvenida');
    if (modo) {
        limpiarUrl();
        // El gráfico y el catálogo cargan async: iniciar() espera a que el panel pinte las tarjetas.
        setTimeout(() => iniciar(modo === 'zone' ? 'zone' : 'ai', true), 1200);
    }
})();
