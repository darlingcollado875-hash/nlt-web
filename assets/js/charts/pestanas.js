/* Pestañas del gráfico (como las de un navegador): cada una guarda su activo, su temporalidad y sus indicadores.
 * Cambiar de pestaña lleva el gráfico a ese estado por el mismo camino que la barra (app.irA); los dibujos ya se guardan por
 * activo, así que cada pestaña conserva los suyos. Se guardan por usuario. Arrastrar reordena; clic central o × cierra;
 * Alt+1…9 salta entre ellas. El "+" abre un buscador de activos (o duplica la pestaña actual). */
(function () {
    'use strict';
    const MAX = 8;
    const ICONO = { Forex: 'ph-currency-circle-dollar', Metales: 'ph-diamond', 'Energía': 'ph-drop', Índices: 'ph-chart-line-up', Cripto: 'ph-currency-btc' };
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let tabs = [], activa = null, cambiando = false, barra, cinta, popover, arrastrando = null;
    const categoriaDe = {};          // símbolo -> nombre de categoría (se lee del selector de la barra)
    const A = () => NLTCharts.app;
    const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

    function guardar() { try { NLTCharts.state.savePrefs({ pestanas: { tabs, activa } }); } catch (_) { /* sin storage */ } }
    const actual = () => ({ s: A().simbolo(), tf: A().timeframe(), ind: (A().indicadoresActivos() || []).slice() });
    const tabActiva = () => tabs.find((t) => t.id === activa);

    function pintar() {
        cinta.innerHTML = tabs.map((t) => `<div class="pt-tab${t.id === activa ? ' on' : ''}" data-id="${t.id}" role="tab" aria-selected="${t.id === activa}" draggable="true" title="${esc(t.s)} · ${esc(t.tf)}">
            <i class="ph ${ICONO[categoriaDe[t.s]] || 'ph-chart-line'}"></i><b>${esc(t.s)}</b><em>${esc(t.tf)}</em>
            ${tabs.length > 1 ? `<button type="button" class="pt-x" data-x="${t.id}" aria-label="Cerrar pestaña ${esc(t.s)}" tabindex="-1"><i class="ph ph-x"></i></button>` : ''}</div>`).join('');
        barra.querySelector('.pt-mas').disabled = tabs.length >= MAX;
        const on = cinta.querySelector('.pt-tab.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function activar(id, forzar) {
        const t = tabs.find((x) => x.id === id);
        if (!t || (id === activa && !forzar)) return;
        activa = id; cambiando = true;
        const a = A();
        a.irA(t.s, t.tf);
        if (Array.isArray(t.ind)) {
            const ahora = new Set(a.indicadoresActivos() || []);
            t.ind.forEach((i) => { if (!ahora.has(i)) { try { a.activarIndicador(i); } catch (_) { /* ya no existe */ } } });
            ahora.forEach((i) => { if (!t.ind.includes(i)) { try { a.desactivarIndicador(i); } catch (_) { /* noop */ } } });
        }
        pintar(); guardar();
        setTimeout(() => { cambiando = false; }, 700);
    }

    function nueva(s, tf, copiarIndicadores) {
        if (tabs.length >= MAX) { aviso(`Máximo ${MAX} pestañas.`); return; }
        const a = actual(), t = { id: uid(), s: s || a.s, tf: tf || a.tf, ind: copiarIndicadores === false ? undefined : a.ind };
        // la nueva va justo después de la actual
        const i = tabs.findIndex((x) => x.id === activa);
        tabs.splice(i + 1, 0, t);
        activar(t.id);
    }

    function cerrar(id) {
        if (tabs.length <= 1) return;
        const i = tabs.findIndex((x) => x.id === id);
        if (i < 0) return;
        const eraActiva = id === activa;
        tabs.splice(i, 1);
        if (eraActiva) { activa = null; activar(tabs[Math.max(0, i - 1)].id, true); } else { pintar(); guardar(); }
    }

    function aviso(t) { if (NLTCharts.ui && NLTCharts.ui.toast) NLTCharts.ui.toast(t); }

    // La pestaña activa sigue lo que el usuario haga con la barra, la watchlist o el Backtest Lab.
    function sincronizar() {
        if (cambiando) return;
        const t = tabActiva(); if (!t) return;
        const a = actual();
        if (a.s !== t.s || a.tf !== t.tf || a.ind.join() !== (t.ind || []).join()) { t.s = a.s; t.tf = a.tf; t.ind = a.ind; pintar(); guardar(); }
    }

    // ── buscador de activos del "+" ──
    function abrirBuscador() {
        if (popover && !popover.hidden) { cerrarBuscador(); return; }
        const simbolos = [...document.querySelectorAll('#chSymbol option')].map((o) => ({ s: o.value, c: (o.parentElement.label || '') }));
        popover.innerHTML = `<button type="button" class="pt-dup" data-dup><i class="ph ph-copy"></i> Duplicar esta pestaña</button>
            <input type="search" placeholder="Buscar activo (EURUSD, US100, oro…)" aria-label="Buscar activo" autocomplete="off" spellcheck="false">
            <div class="pt-lista"></div>`;
        popover.hidden = false;
        const q = popover.querySelector('input'), lista = popover.querySelector('.pt-lista');
        const ALIAS = { oro: 'XAUUSD', gold: 'XAUUSD', plata: 'XAGUSD', nasdaq: 'US100', dow: 'US30', sp500: 'US500', petroleo: 'USOIL', petróleo: 'USOIL', bitcoin: 'BTCUSD', btc: 'BTCUSD', eth: 'ETHUSD', dax: 'GER40' };
        const pintarLista = () => {
            const txt = q.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''), via = ALIAS[q.value.trim().toLowerCase()];
            const f = simbolos.filter((x) => !txt || x.s.includes(txt) || x.s === via);
            lista.innerHTML = f.length ? f.map((x, i) => `<button type="button" data-s="${esc(x.s)}" class="${i === 0 ? 'sel' : ''}"><i class="ph ${ICONO[x.c] || 'ph-chart-line'}"></i><b>${esc(x.s)}</b><em>${esc(x.c)}</em></button>`).join('') : '<p>Sin resultados</p>';
        };
        pintarLista();
        q.addEventListener('input', pintarLista);
        q.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { const b = lista.querySelector('button.sel') || lista.querySelector('button'); if (b) { cerrarBuscador(); nueva(b.dataset.s); } }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault(); const bs = [...lista.querySelectorAll('button')]; const i = bs.findIndex((b) => b.classList.contains('sel'));
                const n = bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]; if (n) { bs.forEach((b) => b.classList.remove('sel')); n.classList.add('sel'); n.scrollIntoView({ block: 'nearest' }); }
            }
        });
        popover.onclick = (e) => {
            if (e.target.closest('[data-dup]')) { cerrarBuscador(); nueva(); return; }
            const b = e.target.closest('[data-s]'); if (b) { cerrarBuscador(); nueva(b.dataset.s); }
        };
        requestAnimationFrame(() => { popover.classList.add('on'); q.focus({ preventScroll: true }); });
    }
    function cerrarBuscador() { if (popover) { popover.classList.remove('on'); popover.hidden = true; } }

    function montar() {
        const cuerpo = document.querySelector('.ch-body');
        if (!cuerpo || document.getElementById('chPestanas')) return;
        document.querySelectorAll('#chSymbol optgroup').forEach((g) => g.querySelectorAll('option').forEach((o) => { categoriaDe[o.value] = g.label; }));
        barra = document.createElement('div'); barra.id = 'chPestanas'; barra.className = 'pt-bar';
        barra.innerHTML = '<div class="pt-cinta" role="tablist" aria-label="Pestañas del gráfico"></div><button type="button" class="pt-mas" title="Nueva pestaña" aria-label="Nueva pestaña"><i class="ph ph-plus"></i></button><div class="pt-pop" hidden></div>';
        // Arriba de todo, encima de la barra de símbolo / temporalidad / opciones (como las pestañas de un navegador).
        const ref = document.querySelector('.ch-tbwrap') || document.getElementById('chToolbar') || cuerpo;
        ref.parentNode.insertBefore(barra, ref);
        cinta = barra.querySelector('.pt-cinta'); popover = barra.querySelector('.pt-pop');

        let guardadas = null;
        try { guardadas = NLTCharts.state.prefs().pestanas; } catch (_) { /* noop */ }
        const hoy = actual();
        if (guardadas && Array.isArray(guardadas.tabs) && guardadas.tabs.length) {
            tabs = guardadas.tabs.filter((t) => t && t.s && t.tf).slice(0, MAX);
            activa = tabs.some((t) => t.id === guardadas.activa) ? guardadas.activa : tabs[0].id;
            const t = tabActiva(); t.s = hoy.s; t.tf = hoy.tf; t.ind = hoy.ind;       // lo que se ve ahora ES la pestaña activa
        }
        if (!tabs.length) { activa = uid(); tabs = [{ id: activa, ...hoy }]; }
        pintar(); guardar();

        cinta.addEventListener('click', (e) => {
            const x = e.target.closest('[data-x]'); if (x) { e.stopPropagation(); cerrar(x.dataset.x); return; }
            const t = e.target.closest('.pt-tab'); if (t) activar(t.dataset.id);
        });
        cinta.addEventListener('auxclick', (e) => { if (e.button === 1) { const t = e.target.closest('.pt-tab'); if (t) { e.preventDefault(); cerrar(t.dataset.id); } } });
        cinta.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
        cinta.addEventListener('wheel', (e) => { if (cinta.scrollWidth > cinta.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); cinta.scrollLeft += e.deltaY; } }, { passive: false });
        // reordenar arrastrando
        cinta.addEventListener('dragstart', (e) => { const t = e.target.closest('.pt-tab'); if (!t) return; arrastrando = t.dataset.id; t.classList.add('arr'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', arrastrando); } catch (_) { /* noop */ } });
        cinta.addEventListener('dragover', (e) => { if (!arrastrando) return; e.preventDefault(); const t = e.target.closest('.pt-tab'); if (!t || t.dataset.id === arrastrando) return;
            const de = tabs.findIndex((x) => x.id === arrastrando), a = tabs.findIndex((x) => x.id === t.dataset.id); const [m] = tabs.splice(de, 1); tabs.splice(a, 0, m); pintar(); cinta.querySelector(`[data-id="${arrastrando}"]`)?.classList.add('arr'); });
        cinta.addEventListener('dragend', () => { arrastrando = null; pintar(); guardar(); });
        barra.querySelector('.pt-mas').addEventListener('click', (e) => { e.stopPropagation(); abrirBuscador(); });
        document.addEventListener('mousedown', (e) => { if (popover && !popover.hidden && !popover.contains(e.target) && !e.target.closest('.pt-mas')) cerrarBuscador(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && popover && !popover.hidden) { cerrarBuscador(); return; }
            if (!e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) return;
            const m = /^Digit([1-9])$/.exec(e.code || ''); if (m && tabs[+m[1] - 1]) { e.preventDefault(); activar(tabs[+m[1] - 1].id); }
        });
        setInterval(sincronizar, 500);
        // El selector de símbolos puede traer categorías tarde (símbolos "no disponibles" quitados): se repinta cuando cambian.
        window.NLTPestanas = { nueva, cerrar, activar, lista: () => tabs.map((t) => ({ ...t })), activa: () => activa };
    }

    const t0 = setInterval(() => {
        if (window.NLTCharts && NLTCharts.app && NLTCharts.app.simbolo && document.querySelector('#chSymbol') && document.querySelector('.ch-body')) { clearInterval(t0); montar(); }
    }, 200);
})();
