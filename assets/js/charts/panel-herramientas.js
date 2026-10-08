/* NLT Charts -- "Mis herramientas": panelito flotante con las herramientas de dibujo que cada quien usa a diario (como el panel rápido de
 * TradingView). Se puede MOVER (arrastrando la manija de arriba), OCULTAR (queda una píldora diminuta) y se eligen las herramientas
 * que se quieren (incluye acciones rápidas: deshacer, borrar, imán, mantener herramienta, ocultar dibujos).
 * Se guarda por usuario en las preferencias del gráfico (`panelHerr`): herramientas, posición y estado. Solo es una interfaz: las
 * herramientas son las mismas de la barra de dibujo (drawings.js). */
(function () {
    const POR_DEFECTO = ['trend', 'hline', 'rect', 'fib', 'long', 'short', 'text'];
    const MAX = 14;
    const ACCIONES = [
        { id: 'accion:deshacer', accion: 'deshacer', icono: 'ph-arrow-u-up-left', label: 'Deshacer' },
        { id: 'accion:borrar', accion: 'borrar', icono: 'ph-eraser', label: 'Borrar un dibujo', estado: 'borrar' },
        { id: 'accion:iman', accion: 'iman', icono: 'ph-magnet', label: 'Imán', estado: 'iman' },
        { id: 'accion:mantener', accion: 'mantener', icono: 'ph-lock-simple', label: 'Mantener la herramienta', estado: 'mantener' },
        { id: 'accion:ocultar', accion: 'ocultar', icono: 'ph-eye-slash', label: 'Ocultar los dibujos', estado: 'ocultar' },
        { id: 'accion:limpiar', accion: 'limpiar', icono: 'ph-trash', label: 'Borrar todos los dibujos', peligro: true },
    ];

    function montar({ stageEl, state, dib }) {
        if (!stageEl || !dib || !NLTCharts.drawings) return null;
        const HERR = NLTCharts.drawings.HERRAMIENTAS;
        const POR_ID = Object.fromEntries(HERR.map((h) => [h.id, h]).concat(ACCIONES.map((a) => [a.id, a])));
        const CATS = (NLTCharts.drawingsExtra && NLTCharts.drawingsExtra.CATEGORIAS) || [];
        const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

        const guardado = (state.prefs().panelHerr && typeof state.prefs().panelHerr === 'object') ? state.prefs().panelHerr : {};
        const est = {
            ids: (Array.isArray(guardado.ids) ? guardado.ids : POR_DEFECTO).filter((id) => POR_ID[id]).slice(0, MAX),
            x: Number.isFinite(guardado.x) ? guardado.x : null, y: Number.isFinite(guardado.y) ? guardado.y : null,
            min: !!guardado.min, visible: guardado.visible !== false,
        };
        const guardar = () => state.savePrefs({ panelHerr: { ids: est.ids, x: est.x, y: est.y, min: est.min, visible: est.visible } });

        const el = document.createElement('div');
        el.className = 'phr'; el.setAttribute('role', 'toolbar'); el.setAttribute('aria-label', 'Mis herramientas');
        stageEl.appendChild(el);

        function botonHTML(id) {
            const h = POR_ID[id];
            const icono = `<i class="ph ${esc(h.icono)}"></i>`;
            if (h.accion) return `<button type="button" class="phr-b${h.peligro ? ' peligro' : ''}" data-accion="${esc(h.accion)}" data-id="${esc(id)}" title="${esc(h.label)}" aria-label="${esc(h.label)}">${icono}</button>`;
            return `<button type="button" class="phr-b" data-tool="${esc(id)}" title="${esc(h.label)}" aria-label="${esc(h.label)}">${icono}</button>`;
        }
        function pintar() {
            el.hidden = !est.visible;
            if (!est.visible) return;
            el.classList.toggle('phr-min', est.min);
            el.innerHTML = `
                <button type="button" class="phr-grip" title="Arrastra para mover · doble toque para volver a su lugar" aria-label="Mover el panel"><i class="ph ph-dots-six"></i></button>
                ${est.min ? `<button type="button" class="phr-b phr-abrir" data-ph="min" title="Mostrar mis herramientas" aria-label="Mostrar mis herramientas"><i class="ph ph-toolbox"></i></button>`
                    : `<div class="phr-lista">${est.ids.map(botonHTML).join('') || '<span class="phr-vacio">Toca + para elegir tus herramientas</span>'}</div>
                <div class="phr-pie">
                    <button type="button" class="phr-b chico" data-ph="editar" title="Elegir mis herramientas" aria-label="Elegir mis herramientas"><i class="ph ph-plus"></i></button>
                    <button type="button" class="phr-b chico" data-ph="min" title="Ocultar el panel (queda un botón pequeño)" aria-label="Ocultar el panel"><i class="ph ph-caret-up"></i></button>
                </div>`}`;
            marcar();
            colocar();
        }
        function marcar() {
            const activa = dib.activa(), a = dib.estadoAcciones();
            el.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === activa));
            el.querySelectorAll('[data-accion]').forEach((b) => {
                const def = POR_ID[b.dataset.id]; if (!def || !def.estado) return;
                b.classList.toggle('on', !!a[def.estado]);
            });
            const deshacer = el.querySelector('[data-accion="deshacer"]'); if (deshacer) deshacer.disabled = !a.puedeDeshacer;
        }
        function colocar() {
            const pr = stageEl.getBoundingClientRect();
            if (est.x == null || est.y == null || !pr.width) { el.style.left = el.style.top = ''; el.style.right = ''; return; }
            const w = el.offsetWidth || 56, h = el.offsetHeight || 200;
            el.style.right = 'auto';
            el.style.left = Math.max(4, Math.min(pr.width - w - 4, est.x)) + 'px';
            el.style.top = Math.max(4, Math.min(pr.height - h - 4, est.y)) + 'px';
        }

        // ── arrastrar ──
        el.addEventListener('pointerdown', (ev) => {
            const g = ev.target.closest('.phr-grip');
            if (!g || ev.button > 0) return;
            const pr = stageEl.getBoundingClientRect(), r = el.getBoundingClientRect();
            const dx = ev.clientX - r.left, dy = ev.clientY - r.top;
            ev.preventDefault();
            try { g.setPointerCapture(ev.pointerId); } catch (_) { /* sin captura */ }
            el.classList.add('moviendo');
            const mover = (e) => { est.x = e.clientX - pr.left - dx; est.y = e.clientY - pr.top - dy; colocar(); };
            const soltar = () => {
                g.removeEventListener('pointermove', mover); g.removeEventListener('pointerup', soltar); g.removeEventListener('pointercancel', soltar);
                el.classList.remove('moviendo');
                // se guarda ya recortado a la pantalla
                est.x = parseFloat(el.style.left) || est.x; est.y = parseFloat(el.style.top) || est.y;
                guardar();
            };
            g.addEventListener('pointermove', mover); g.addEventListener('pointerup', soltar); g.addEventListener('pointercancel', soltar);
        });
        el.addEventListener('dblclick', (ev) => { if (ev.target.closest('.phr-grip')) { est.x = est.y = null; guardar(); colocar(); } });
        window.addEventListener('resize', () => { if (est.visible) colocar(); });

        // ── clics ──
        el.addEventListener('click', (ev) => {
            const b = ev.target.closest('button');
            if (!b) return;
            if (b.dataset.tool) { dib.elegir(b.dataset.tool); return; }
            if (b.dataset.accion) { dib.accion(b.dataset.accion); setTimeout(marcar, 30); return; }
            if (b.dataset.ph === 'min') { est.min = !est.min; guardar(); pintar(); return; }
            if (b.dataset.ph === 'editar') abrirSelector();
        });
        dib.alCambiarActiva(() => { if (est.visible && !est.min) marcar(); });

        // ── elegir herramientas ──
        let sel = null;
        function cerrarSelector() { if (sel) { const s = sel; sel = null; s.classList.remove('on'); setTimeout(() => s.remove(), 220); } }
        function abrirSelector() {
            cerrarSelector();
            const actual = new Set(est.ids);
            const fila = (h) => `<button type="button" class="phs-it${actual.has(h.id) ? ' on' : ''}" data-id="${esc(h.id)}" role="checkbox" aria-checked="${actual.has(h.id)}"><i class="ph ${esc(h.icono)}"></i><span>${esc(h.label)}</span><i class="ph-bold ph-check phs-ok"></i></button>`;
            const grupo = (t, items) => (items.length ? `<h4>${esc(t)}</h4><div class="phs-grid">${items.map(fila).join('')}</div>` : '');
            const html = `
                <div class="phs-card" role="dialog" aria-label="Mis herramientas">
                    <header><b><i class="ph ph-toolbox"></i> Mis herramientas</b><span class="phs-n" data-n></span><button type="button" class="phs-x" data-cerrar aria-label="Cerrar"><i class="ph ph-x"></i></button></header>
                    <p class="phs-ay">Elige las que usas todos los días: quedan en tu panel flotante. Toca otra vez para quitarla.</p>
                    <div class="phs-cuerpo">
                        ${grupo('Acciones rápidas', ACCIONES)}
                        ${grupo('Básicas', HERR.filter((h) => !h.cat))}
                        ${CATS.map((c) => grupo(c.label, HERR.filter((h) => h.cat === c.id))).join('')}
                    </div>
                    <footer><button type="button" class="phs-reset" data-reset>Restablecer</button><button type="button" class="phs-ok-b" data-cerrar>Listo</button></footer>
                </div>`;
            sel = document.createElement('div');
            sel.className = 'phs'; sel.innerHTML = html;
            document.body.appendChild(sel);
            const contar = () => { sel.querySelector('[data-n]').textContent = `${est.ids.length}/${MAX}`; };
            contar();
            requestAnimationFrame(() => sel && sel.classList.add('on'));
            sel.addEventListener('click', (ev) => {
                if (ev.target === sel || ev.target.closest('[data-cerrar]')) { cerrarSelector(); return; }
                if (ev.target.closest('[data-reset]')) { est.ids = POR_DEFECTO.filter((id) => POR_ID[id]); guardar(); pintar(); cerrarSelector(); abrirSelector(); return; }
                const it = ev.target.closest('.phs-it');
                if (!it) return;
                const id = it.dataset.id;
                if (est.ids.includes(id)) est.ids = est.ids.filter((x) => x !== id);
                else if (est.ids.length >= MAX) { const n = sel.querySelector('[data-n]'); n.textContent = `Máximo ${MAX}`; n.classList.add('lleno'); setTimeout(() => { n.classList.remove('lleno'); contar(); }, 1400); return; }
                else est.ids.push(id);
                it.classList.toggle('on', est.ids.includes(id)); it.setAttribute('aria-checked', String(est.ids.includes(id)));
                contar(); guardar(); pintar();
            });
        }
        document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && sel) cerrarSelector(); });

        const api = {
            visible: () => est.visible,
            alternar() {
                est.visible = !est.visible;
                if (est.visible) est.min = false;
                guardar(); pintar();
                return est.visible;
            },
        };
        window.NLTCharts.panelHerr = api;
        pintar();
        const bt = document.querySelector('[data-accion="panelHerr"]'); if (bt) bt.classList.toggle('on', est.visible);
        return api;
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.panelHerr = { visible: () => false, alternar() {} };      // hasta que se monte
    window.NLTCharts.panelHerrModulo = { montar };
})();
