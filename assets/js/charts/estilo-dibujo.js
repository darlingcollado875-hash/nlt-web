/* Estilo rápido de los dibujos (como TradingView, pero a un toque): paleta de colores, opacidad, grosor, tipo de línea,
 * plantillas con nombre por herramienta, "usar siempre este estilo" y "aplicar a todos". Se abre con el botón de la paleta
 * en la barra del dibujo seleccionado. Cambia en vivo (solo redibuja) y se guarda por usuario.
 * drawings.js le pasa un contexto: { leer(), aplicar(parcial), aplicarATodos(estilo), predeterminado(estilo), restablecer() }. */
(function () {
    'use strict';
    const PALETA = ['#FFFFFF', '#9CA3AF', '#EF4444', '#F97316', '#F59E0B', '#EAB308', '#22C55E', '#14B8A6', '#06B6D4', '#4378FF', '#8B5CF6', '#EC4899'];
    const LINEAS = [['solid', 'Sólida'], ['dashed', 'Guiones'], ['dotted', 'Puntos']];
    const MAX_PLANTILLAS = 12;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let pop = null, ctx = null;

    const prefs = () => NLTCharts.state.prefs();
    const plantillasDe = (hid) => ((prefs().dibujoPlantillas || {})[hid] || []);
    function guardarPlantillas(hid, lista) { NLTCharts.state.savePrefs({ dibujoPlantillas: { ...(prefs().dibujoPlantillas || {}), [hid]: lista.slice(0, MAX_PLANTILLAS) } }); }

    // Solo lo "visual": colores, grosor y tipo de línea (no textos ni opciones de cuenta/riesgo).
    function clavesVisuales(h) { return h.inputs.filter((i) => i.tipo === 'color' || i.id === 'grosor' || i.id === 'estiloLinea').map((i) => i.id); }
    function foto(h, v) { const e = {}; clavesVisuales(h).forEach((k) => { e[k] = JSON.parse(JSON.stringify(v[k])); }); return e; }

    function html() {
        const { h, v } = ctx.leer();
        const colores = h.inputs.filter((i) => i.tipo === 'color');
        const bloqueColor = (i) => {
            const c = v[i.id] || { hex: '#FFFFFF', t: 0 }, op = 100 - (c.t || 0);
            const rotulo = i.grupo && i.grupo !== i.titulo ? `${i.grupo} · ${i.titulo}` : i.titulo;
            return `<div class="ed-sec" data-col="${esc(i.id)}"><div class="ed-t"><span>${esc(rotulo)}</span><b data-op-val>${op}%</b></div>
                <div class="ed-paleta">${PALETA.map((x) => `<button type="button" class="ed-sw${x.toUpperCase() === String(c.hex).toUpperCase() ? ' on' : ''}" style="background:${x}" data-hex="${x}" aria-label="${x}"></button>`).join('')}
                    <label class="ed-sw ed-otro" title="Otro color"><input type="color" value="${esc(String(c.hex).slice(0, 7))}" data-custom><i class="ph ph-plus"></i></label></div>
                <label class="ed-op"><span>Opacidad</span><input type="range" min="0" max="100" step="5" value="${op}" data-op></label></div>`;
        };
        const g = h.inputs.find((i) => i.id === 'grosor');
        const bloqueGrosor = g ? (() => {
            const max = Math.min(g.max || 8, 12), act = v.grosor;
            const pasos = [...new Set([1, 2, 3, 4, 5, 6, 8, 10, 12].filter((n) => n <= max).concat([act]))].sort((a, b) => a - b);
            return `<div class="ed-sec"><div class="ed-t"><span>Grosor</span></div><div class="ed-seg">${pasos.map((n) => `<button type="button" data-gr="${n}" class="${n === act ? 'on' : ''}"><i style="height:${Math.min(n, 8)}px"></i><em>${n}</em></button>`).join('')}</div></div>`;
        })() : '';
        const bloqueLinea = h.inputs.some((i) => i.id === 'estiloLinea')
            ? `<div class="ed-sec"><div class="ed-t"><span>Tipo de línea</span></div><div class="ed-seg">${LINEAS.map(([k, t]) => `<button type="button" data-ln="${k}" class="${v.estiloLinea === k ? 'on' : ''}">${t}</button>`).join('')}</div></div>` : '';
        const pl = plantillasDe(h.id);
        return `<header><b>${esc(h.label)}</b><button type="button" class="ed-x" data-cerrar aria-label="Cerrar"><i class="ph ph-x"></i></button></header>
            <div class="ed-cuerpo">${colores.map(bloqueColor).join('')}${bloqueGrosor}${bloqueLinea}
            <div class="ed-sec"><div class="ed-t"><span>Mis plantillas</span></div>
                <div class="ed-plantillas">${pl.length ? pl.map((p, k) => `<span class="ed-chip"><button type="button" data-pl="${k}" title="Aplicar">${esc(p.n)}</button><button type="button" data-pl-x="${k}" aria-label="Borrar plantilla"><i class="ph ph-x"></i></button></span>`).join('') : '<em>Aún no tienes. Guarda este estilo para reutilizarlo.</em>'}</div>
                <form class="ed-nueva" data-nueva><input type="text" maxlength="24" placeholder="Nombre de la plantilla" aria-label="Nombre de la plantilla"><button type="submit">Guardar estilo</button></form></div>
            </div>
            <footer><button type="button" data-def title="Las próximas herramientas de este tipo nacen con este estilo">Usar siempre este estilo</button><button type="button" data-todos>Aplicar a todos</button><button type="button" data-reset>Restablecer</button></footer>`;
    }
    function pintar() { if (pop) pop.innerHTML = html(); }

    function colocar() {
        const barra = document.getElementById('chBarraDibujo');
        const stage = pop.parentElement;
        if (window.matchMedia('(max-width: 700px)').matches) { pop.style.top = ''; return; }
        const b = barra && !barra.hidden ? barra.getBoundingClientRect() : null, s = stage.getBoundingClientRect();
        pop.style.top = `${(b ? b.bottom - s.top : 8) + 8}px`;
    }
    function cerrar() { if (pop) { pop.classList.remove('on'); setTimeout(() => { if (pop && !pop.classList.contains('on')) pop.hidden = true; }, 160); } ctx = null; }

    function abrir(contexto) {
        if (ctx && pop && !pop.hidden) { cerrar(); return; }     // el mismo botón alterna
        ctx = contexto;
        const stage = document.querySelector('.ch-stage');
        if (!stage) return;
        if (!pop) {
            pop = document.createElement('div');
            pop.className = 'ed-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Estilo del dibujo');
            stage.appendChild(pop);
            pop.addEventListener('mousedown', (e) => e.stopPropagation());
            pop.addEventListener('click', onClick);
            pop.addEventListener('input', onInput);
            pop.addEventListener('submit', onSubmit);
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop && !pop.hidden) cerrar(); });
            document.addEventListener('mousedown', (e) => { if (pop && !pop.hidden && !pop.contains(e.target) && !e.target.closest('#chBarraDibujo')) cerrar(); });
        }
        pintar(); pop.hidden = false; colocar();
        requestAnimationFrame(() => pop.classList.add('on'));
    }

    function onClick(e) {
        if (!ctx) return;
        const { h, v } = ctx.leer();
        if (e.target.closest('[data-cerrar]')) { cerrar(); return; }
        const sw = e.target.closest('[data-hex]');
        if (sw) { const id = sw.closest('[data-col]').dataset.col; ctx.aplicar({ [id]: { hex: sw.dataset.hex, t: (v[id] || {}).t || 0 } }); pintar(); return; }
        const gr = e.target.closest('[data-gr]'); if (gr) { ctx.aplicar({ grosor: +gr.dataset.gr }); pintar(); return; }
        const ln = e.target.closest('[data-ln]'); if (ln) { ctx.aplicar({ estiloLinea: ln.dataset.ln }); pintar(); return; }
        const pl = e.target.closest('[data-pl]'); if (pl) { const p = plantillasDe(h.id)[+pl.dataset.pl]; if (p) { ctx.aplicar(p.e); pintar(); } return; }
        const px = e.target.closest('[data-pl-x]'); if (px) { const l = plantillasDe(h.id).slice(); l.splice(+px.dataset.plX, 1); guardarPlantillas(h.id, l); pintar(); return; }
        if (e.target.closest('[data-def]')) { ctx.predeterminado(foto(h, v)); toast('Las próximas herramientas nacerán con este estilo.'); return; }
        if (e.target.closest('[data-todos]')) { const n = ctx.aplicarATodos(foto(h, v)); toast(`Estilo aplicado a ${n} dibujo${n === 1 ? '' : 's'}.`); return; }
        if (e.target.closest('[data-reset]')) { ctx.restablecer(); pintar(); }
    }
    // Colores y opacidad en vivo (mientras se arrastra solo se redibuja; el guardado ya va con retardo).
    function onInput(e) {
        if (!ctx) return;
        const sec = e.target.closest('[data-col]'); if (!sec) return;
        const id = sec.dataset.col, { v } = ctx.leer(), c = v[id] || { hex: '#FFFFFF', t: 0 };
        if (e.target.matches('[data-op]')) {
            const op = +e.target.value; sec.querySelector('[data-op-val]').textContent = op + '%';
            ctx.aplicar({ [id]: { hex: c.hex, t: 100 - op } });
        } else if (e.target.matches('[data-custom]')) {
            ctx.aplicar({ [id]: { hex: e.target.value.toUpperCase(), t: c.t || 0 } });
            sec.querySelectorAll('.ed-sw.on').forEach((b) => b.classList.remove('on'));
        }
    }
    function onSubmit(e) {
        e.preventDefault();
        if (!ctx || !e.target.matches('[data-nueva]')) return;
        const { h, v } = ctx.leer(), nombre = e.target.querySelector('input').value.trim() || `Estilo ${plantillasDe(h.id).length + 1}`;
        const l = plantillasDe(h.id).filter((p) => p.n !== nombre); l.push({ n: nombre, e: foto(h, v) });
        guardarPlantillas(h.id, l); pintar(); toast(`Plantilla «${nombre}» guardada.`);
    }
    const toast = (t) => { if (NLTCharts.ui && NLTCharts.ui.toast) NLTCharts.ui.toast(t); };

    window.NLTEstiloDibujo = { abrir, cerrar, abierto: () => !!(pop && !pop.hidden) };
})();
