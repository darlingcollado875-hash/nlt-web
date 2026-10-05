/* NLT Charts -- líneas y controles de posiciones sobre el gráfico (compartido por el Simulador y por Operar con cuenta real).
 *
 * Las líneas (entrada, SL, TP, órdenes) las dibuja KLineChart; los controles son fichas HTML pegadas a cada línea para que
 * respondan bien al tacto: ✕ para cerrar (en dos pasos, sin ventanas emergentes), arrastrar el SL/TP/orden para moverlo
 * (con la ganancia/pérdida en vivo mientras se arrastra), "+ SL" / "+ TP" para agregarlos y ✕ para quitarlos. Si un nivel queda
 * fuera de pantalla, su ficha se pega al borde con una flecha.
 *
 * Este módulo NO sabe de dinero ni de brokers: recibe una `fuente` que describe qué mostrar y hace lo que se le pide.
 *   fuente.descripciones() -> [{ clave, tipo: 'entrada'|'sl'|'tp'|'orden', id, valor, color, texto, fantasmas?: ['sl','tp'] }]
 *   fuente.textoArrastre(d, valor) -> texto de la ficha mientras se arrastra
 *   fuente.mover(d, valor) -> Promise|valor: { error? } al soltar un SL/TP/orden en un nuevo precio
 *   fuente.accion(d, 'cerrar'|'cancelar'|'quitar'|'addsl'|'addtp') -> Promise|valor: { error?, aviso? }
 *   fuente.alCambiar() (opcional) -> después de cualquier cambio (para repintar paneles) */
(function () {
    let registrado = false;
    function registrarOverlay() {
        if (registrado) return;
        registrado = true;
        klinecharts.registerOverlay({
            name: 'nltPosLine', totalStep: 2, lock: true, needDefaultPointFigure: false, needDefaultXAxisFigure: false, needDefaultYAxisFigure: true,
            createPointFigures: ({ overlay, coordinates, bounding }) => {
                if (!coordinates.length) return [];
                const y = coordinates[0].y, e = overlay.extendData || {};
                return [{ type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x: 0, y }, { x: bounding.width, y }] }, styles: { style: 'dashed', dashedValue: [3, 3], size: 1, color: e.color } }];
            },
        });
    }
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function crear({ chart, grupo, precision, fuente }) {
        registrarOverlay();
        const dom = chart.getDom();
        const stage = (dom && (dom.closest('.ch-stage') || dom.parentElement)) || document.body;
        const capa = document.createElement('div');
        capa.className = 'pp-capa';
        stage.appendChild(capa);
        const aviso = document.createElement('div');
        aviso.className = 'pp-aviso'; aviso.hidden = true; capa.appendChild(aviso);
        let tAviso = null;
        function avisar(txt) { aviso.textContent = txt; aviso.hidden = false; clearTimeout(tAviso); tAviso = setTimeout(() => { aviso.hidden = true; }, 3500); }
        const fichas = new Map();     // clave -> { el, desc }
        let arrastre = null;          // ficha que se está arrastrando: no se repinta ni se mueve sola
        let armadoCierre = null;      // { clave, t }: primer toque en ✕ de cerrar (el segundo confirma)
        const yDe = (valor) => {
            try { const c = chart.convertToPixel({ value: valor }, { paneId: 'candle_pane' }); return c && Number.isFinite(c.y) ? c.y : null; } catch (_) { return null; }
        };
        const valorDe = (y) => {
            try { const r = chart.convertFromPixel([{ y }], { paneId: 'candle_pane' }); const v = Array.isArray(r) ? r[0] : r; return v && Number.isFinite(v.value) ? v.value : null; } catch (_) { return null; }
        };
        const desplazamientoY = () => (dom ? dom.getBoundingClientRect().top - stage.getBoundingClientRect().top : 0);

        function htmlFicha(d) {
            const grip = d.tipo === 'entrada' ? '' : '<i class="pp-grip" title="Arrastra para mover" aria-hidden="true"></i>';
            const fant = (d.fantasmas || []).map((k) => `<button type="button" class="pp-fant" data-a="add${k}" title="Agregar ${k === 'sl' ? 'stop loss' : 'take profit'}">+ ${k.toUpperCase()}</button>`).join('');
            const armado = armadoCierre && armadoCierre.clave === d.clave && Date.now() - armadoCierre.t < 3000;
            const x = d.tipo === 'entrada' ? `<button type="button" class="pp-x${armado ? ' listo' : ''}" data-a="cerrar" title="Cerrar la posición" aria-label="Cerrar la posición">${armado ? 'Cerrar' : '✕'}</button>`
                : d.tipo === 'orden' ? '<button type="button" class="pp-x" data-a="cancelar" title="Cancelar la orden" aria-label="Cancelar la orden">✕</button>'
                    : `<button type="button" class="pp-x" data-a="quitar" title="Quitar ${d.tipo === 'sl' ? 'el stop loss' : 'el take profit'}" aria-label="Quitar">✕</button>`;
            return `${fant}<span class="pp-ficha" style="--c:${d.color}">${grip}<span class="pp-t">${esc(d.texto)}</span>${x}</span>`;
        }
        function colocar(f) {
            const alto = dom ? dom.clientHeight : 0;
            let y = f.yFija != null ? f.yFija : yDe(f.desc.valor);
            if (y == null) { f.el.style.display = 'none'; return; }
            f.el.style.display = '';
            const fuera = alto ? (y < 14 ? 'arriba' : y > alto - 14 ? 'abajo' : '') : '';
            if (fuera && alto) y = fuera === 'arriba' ? 14 : alto - 14;
            if (f.fuera !== fuera) { f.el.classList.toggle('fuera', !!fuera); f.el.dataset.fuera = fuera; f.fuera = fuera; }
            const ty = Math.round(y + desplazamientoY());
            if (f.ty !== ty) { f.el.style.transform = `translateY(${ty}px) translateY(-50%)`; f.ty = ty; }
        }
        let rafY = null;
        function bucleY() {
            if (rafY) return;
            const paso = () => {
                rafY = null;
                if (!fichas.size) return;
                if (!document.hidden) fichas.forEach(colocar);
                rafY = requestAnimationFrame(paso);
            };
            rafY = requestAnimationFrame(paso);
        }
        function sincronizarFichas(lista) {
            const vistas = new Set();
            lista.forEach((d) => {
                vistas.add(d.clave);
                let f = fichas.get(d.clave);
                if (!f) {
                    const el = document.createElement('div');
                    el.className = `pp-chip pp-${d.tipo}`; el.dataset.clave = d.clave;
                    capa.appendChild(el);
                    f = { el, desc: d, ty: null, html: '' };
                    fichas.set(d.clave, f);
                }
                if (arrastre && arrastre.clave === d.clave) return;
                f.desc = d;
                const h = htmlFicha(d);
                if (h !== f.html) { f.el.innerHTML = h; f.html = h; }
                f.yFija = null;
            });
            [...fichas.keys()].forEach((k) => { if (!vistas.has(k)) { fichas.get(k).el.remove(); fichas.delete(k); } });
            fichas.forEach(colocar);
            if (fichas.size) bucleY();
        }
        function actualizar() {
            const lista = fuente.descripciones();
            if (!arrastre) {
                try { chart.removeOverlay({ groupId: grupo }); } catch (_) { /* nada que quitar */ }
                const ult = chart.getDataList().slice(-1)[0];
                if (ult) lista.forEach((d) => chart.createOverlay({ id: `${grupo}-${d.clave}`, name: 'nltPosLine', groupId: grupo, lock: true, points: [{ timestamp: ult.timestamp, value: d.valor }], extendData: { color: d.tipo === 'entrada' ? '#9CA3AF' : d.color } }));
            }
            sincronizarFichas(lista);
        }
        const alCambiar = () => { actualizar(); if (fuente.alCambiar) fuente.alCambiar(); };

        async function ejecutar(promesaOValor) {
            let r;
            try { r = await promesaOValor; } catch (e) { r = { error: (e && e.message) || 'No se pudo completar.' }; }
            if (r && r.error) avisar(r.error); else if (r && r.aviso) avisar(r.aviso);
            alCambiar();
        }
        capa.addEventListener('click', (e) => {
            const b = e.target.closest('button[data-a]'); if (!b) return;
            const ficha = b.closest('.pp-chip'); const f = ficha && fichas.get(ficha.dataset.clave); if (!f) return;
            const a = b.dataset.a, d = f.desc;
            if (a === 'cerrar') {
                if (!armadoCierre || armadoCierre.clave !== d.clave || Date.now() - armadoCierre.t > 3000) {
                    const clave = d.clave;
                    armadoCierre = { clave, t: Date.now() };
                    const x = f.el.querySelector('.pp-x'); if (x) { x.textContent = 'Cerrar'; x.classList.add('listo'); }
                    setTimeout(() => { if (armadoCierre && armadoCierre.clave === clave) { armadoCierre = null; const x2 = f.el.querySelector('.pp-x'); if (x2) { x2.textContent = '✕'; x2.classList.remove('listo'); } } }, 3000);
                    return;
                }
                armadoCierre = null;
            }
            ejecutar(fuente.accion(d, a));
        });

        // ── arrastrar SL / TP / órdenes pendientes ──
        capa.addEventListener('pointerdown', (e) => {
            const grip = e.target.closest('.pp-grip, .pp-t'); const ficha = e.target.closest('.pp-chip');
            if (!grip || !ficha || e.target.closest('button')) return;
            const f = fichas.get(ficha.dataset.clave);
            if (!f || f.desc.tipo === 'entrada') return;
            e.preventDefault();
            try { e.target.closest('.pp-ficha').setPointerCapture(e.pointerId); } catch (_) { /* sin captura: el arrastre igual funciona con el ratón */ }
            arrastre = { clave: f.desc.clave, f, id: e.pointerId, valor: f.desc.valor };
            ficha.classList.add('arrastrando');
        });
        capa.addEventListener('pointermove', (e) => {
            if (!arrastre || e.pointerId !== arrastre.id) return;
            const r = stage.getBoundingClientRect();
            const y = e.clientY - r.top - desplazamientoY();
            const v = valorDe(y); if (v == null) return;
            const f = arrastre.f, d = f.desc;
            arrastre.valor = v; f.yFija = Math.max(0, Math.min(dom.clientHeight, y));
            const tt = f.el.querySelector('.pp-t'); if (tt) tt.textContent = fuente.textoArrastre(d, v);
            try { chart.overrideOverlay({ id: `${grupo}-${d.clave}`, points: [{ timestamp: chart.getDataList().slice(-1)[0].timestamp, value: v }] }); } catch (_) { /* sin línea */ }
            colocar(f);
        });
        function terminarArrastre(e, confirmar) {
            if (!arrastre || (e && e.pointerId !== arrastre.id)) return;
            const { f, valor } = arrastre, d = f.desc;
            f.el.classList.remove('arrastrando');
            arrastre = null;
            f.html = '';
            if (confirmar) ejecutar(fuente.mover(d, Number(valor.toFixed(precision())))); else alCambiar();
        }
        capa.addEventListener('pointerup', (e) => terminarArrastre(e, true));
        capa.addEventListener('pointercancel', (e) => terminarArrastre(e, false));

        return { actualizar, avisar, sugerirDistancia() {
            const ult = chart.getDataList().slice(-14);
            return ult.length ? ult.reduce((a, k) => a + (k.high - k.low), 0) / ult.length * 1.5 : 0;
        } };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.poschips = { crear };
})();
