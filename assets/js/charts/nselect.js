/* NLT Charts -- listas desplegables con el estilo del ecosistema.
 *
 * El <select> nativo abre la lista del sistema (blanca en Windows/Android), que desentona con todo lo demás. Aquí cada <select> de las
 * ventanas de NLT (Scripts, Simulador, Operar, Alertas…) se queda en la página, oculto y con su valor de siempre, y se le pone encima un
 * botón + una lista propia (vidrio oscuro, selección azul, teclado). Al elegir se actualiza el <select> y se dispara su evento
 * "change", así que ningún código existente se entera del cambio. */
(function () {
    const SEL = '.sc-modal select, .mc-menu select';
    let abierta = null;   // { sel, btn, lista, activo }
    let sinReabrirHasta = 0;   // tras elegir con Enter/Espacio el botón recibiría el mismo toque y volvería a abrir la lista

    function cerrar() {
        if (!abierta) return;
        abierta.lista.remove();
        abierta.btn.setAttribute('aria-expanded', 'false');
        abierta = null;
    }
    const etiquetaDe = (sel) => { const o = sel.options[sel.selectedIndex]; return o ? o.textContent : ''; };

    function abrir(sel, btn) {
        cerrar();
        const lista = document.createElement('div');
        lista.className = 'nsel-list'; lista.setAttribute('role', 'listbox');
        const items = [];
        const pintar = (o) => {
            const it = document.createElement('div');
            it.className = 'nsel-it' + (o.selected ? ' sel' : '') + (o.disabled ? ' off' : '');
            it.setAttribute('role', 'option'); it.setAttribute('aria-selected', o.selected ? 'true' : 'false');
            it.innerHTML = '<span></span><i class="ph ph-check"></i>';
            it.firstChild.textContent = o.textContent;
            if (!o.disabled) { it.addEventListener('mousedown', (e) => { e.preventDefault(); elegir(o.index); }); items.push({ it, o }); }
            lista.appendChild(it);
        };
        [...sel.children].forEach((h) => {
            if (h.tagName === 'OPTGROUP') {
                const g = document.createElement('div'); g.className = 'nsel-grp'; g.textContent = h.label; lista.appendChild(g);
                [...h.children].forEach(pintar);
            } else pintar(h);
        });
        document.body.appendChild(lista);
        const r = btn.getBoundingClientRect();
        lista.style.minWidth = `${Math.max(r.width, 160)}px`;
        const alto = Math.min(lista.scrollHeight, 288), abajo = innerHeight - r.bottom - 12, arriba = r.top - 12;
        const sube = abajo < alto && arriba > abajo;
        lista.style.maxHeight = `${Math.max(120, Math.min(288, sube ? arriba : abajo))}px`;
        lista.style.left = `${Math.max(8, Math.min(r.left, innerWidth - lista.offsetWidth - 8))}px`;
        lista.style[sube ? 'bottom' : 'top'] = sube ? `${innerHeight - r.top + 6}px` : `${r.bottom + 6}px`;
        lista.classList.toggle('sube', sube);
        btn.setAttribute('aria-expanded', 'true');
        abierta = { sel, btn, lista, items, nombre: sel.getAttribute('name'), raiz: sel.closest('.mc-menu, .sc-modal'), activo: Math.max(0, items.findIndex((x) => x.o.selected)) };
        marcar();
    }
    function marcar() {
        if (!abierta) return;
        abierta.items.forEach((x, i) => x.it.classList.toggle('act', i === abierta.activo));
        const a = abierta.items[abierta.activo];
        if (a) a.it.scrollIntoView({ block: 'nearest' });
    }
    function elegir(indice) {
        if (!abierta) return;
        const { sel, btn } = abierta;
        cerrar();
        if (sel.selectedIndex !== indice) {
            sel.selectedIndex = indice;
            btn.querySelector('.nsel-txt').textContent = etiquetaDe(sel);
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        btn.focus();
    }

    function mejorar(sel) {
        if (sel.dataset.nsel || sel.multiple || sel.size > 1) return;
        sel.dataset.nsel = '1';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `${sel.className} nsel-btn`.trim();
        btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
        if (sel.getAttribute('aria-label')) btn.setAttribute('aria-label', sel.getAttribute('aria-label'));
        if (sel.title) btn.title = sel.title;
        btn.innerHTML = '<span class="nsel-txt"></span><i class="ph ph-caret-down"></i>';
        btn.querySelector('.nsel-txt').textContent = etiquetaDe(sel);
        btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (abierta && abierta.btn === btn) cerrar(); else if (Date.now() > sinReabrirHasta) abrir(sel, btn); });
        btn.addEventListener('keydown', (e) => {
            if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key) && !abierta && Date.now() > sinReabrirHasta) { e.preventDefault(); abrir(sel, btn); }
        });
        sel.after(btn);
        sel.style.display = 'none';
    }

    document.addEventListener('keydown', (e) => {
        if (!abierta) return;
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Tab'].includes(e.key)) sinReabrirHasta = Date.now() + 350;
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(e.key)) e.stopImmediatePropagation();
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); const b = abierta.btn; cerrar(); b.focus(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); abierta.activo = Math.min(abierta.items.length - 1, abierta.activo + 1); marcar(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); abierta.activo = Math.max(0, abierta.activo - 1); marcar(); }
        else if (e.key === 'Home') { e.preventDefault(); abierta.activo = 0; marcar(); }
        else if (e.key === 'End') { e.preventDefault(); abierta.activo = abierta.items.length - 1; marcar(); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const a = abierta.items[abierta.activo]; if (a) elegir(a.o.index); }
        else if (e.key === 'Tab') cerrar();
    }, true);
    document.addEventListener('mousedown', (e) => { if (abierta && !abierta.lista.contains(e.target) && !abierta.btn.contains(e.target)) cerrar(); });
    addEventListener('resize', cerrar);
    document.addEventListener('scroll', (e) => { if (abierta && !abierta.lista.contains(e.target)) cerrar(); }, true);

    // Cada vez que una ventana se vuelve a dibujar aparecen <select> nuevos: se mejoran en el siguiente fotograma
    let pendiente = false;
    // Si la ventana se vuelve a dibujar con la lista abierta (precios que se refrescan), el <select> viejo desaparece: se enlaza con el nuevo
    function reenlazar() {
        if (!abierta || abierta.sel.isConnected) return;
        const nuevo = abierta.nombre && abierta.raiz && abierta.raiz.querySelector(`select[name="${abierta.nombre}"]`);
        const btn = nuevo && nuevo.nextElementSibling;
        if (!nuevo || !btn || !btn.classList.contains('nsel-btn')) { cerrar(); return; }
        abierta.sel = nuevo; abierta.btn = btn; btn.setAttribute('aria-expanded', 'true');
    }
    const barrer = () => { pendiente = false; document.querySelectorAll(SEL).forEach(mejorar); reenlazar(); };
    new MutationObserver((muts) => {
        if (pendiente) return;
        if (abierta && !abierta.sel.isConnected) { pendiente = true; requestAnimationFrame(barrer); return; }
        for (const m of muts) {
            if ([...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches(SEL) || n.querySelector(SEL)))) { pendiente = true; requestAnimationFrame(barrer); return; }
        }
    }).observe(document.body, { childList: true, subtree: true });
    barrer();
    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.nselect = { barrer, cerrar };
})();
