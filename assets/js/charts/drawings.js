/* NLT Charts -- herramientas de dibujo (F3).
 *
 * Línea horizontal, tendencia, rayo y Fibonacci son overlays nativos de
 * KLineChart; rectángulo y texto se registran acá. Los dibujos se guardan
 * por usuario y símbolo (state.js) cada vez que se termina, mueve o borra
 * uno, y se restauran al cargar el símbolo. Funciona igual con mouse y con
 * el dedo: el motor traduce los toques a los mismos eventos. */
(function () {
    const GRUPO = 'nlt-drawings';
    const ACCENT = '#22D3EE';

    const HERRAMIENTAS = [
        { id: 'hline', overlay: 'horizontalStraightLine', icono: 'ph-minus', label: 'Línea horizontal', ayuda: 'Tocá el precio donde va la línea' },
        { id: 'trend', overlay: 'segment', icono: 'ph-line-segment', label: 'Línea de tendencia', ayuda: 'Tocá el punto inicial y después el final' },
        { id: 'ray', overlay: 'rayLine', icono: 'ph-arrow-up-right', label: 'Rayo', ayuda: 'Tocá el origen y después la dirección' },
        { id: 'rect', overlay: 'nltRect', icono: 'ph-rectangle', label: 'Rectángulo', ayuda: 'Tocá una esquina y después la opuesta' },
        { id: 'fib', overlay: 'fibonacciLine', icono: 'ph-chart-bar-horizontal', label: 'Fibonacci', ayuda: 'Tocá el inicio del impulso y después el final' },
        { id: 'text', overlay: 'nltText', icono: 'ph-text-t', label: 'Texto', ayuda: 'Tocá donde va el texto' },
    ];
    const OVERLAYS_PROPIOS = new Set(HERRAMIENTAS.map((h) => h.overlay));
    const MAX_TEXTO = 80;

    let registrados = false;
    function registrar() {
        if (registrados) return;
        registrados = true;
        klinecharts.registerOverlay({
            name: 'nltRect',
            totalStep: 3,
            needDefaultPointFigure: true,
            needDefaultXAxisFigure: true,
            needDefaultYAxisFigure: true,
            createPointFigures: ({ coordinates }) => {
                if (coordinates.length < 2) return [];
                const [a, b] = coordinates;
                return [{
                    type: 'polygon',
                    attrs: { coordinates: [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }] },
                    styles: { style: 'stroke_fill', color: 'rgba(34,211,238,0.10)', borderColor: ACCENT, borderSize: 1 },
                }];
            },
        });
        klinecharts.registerOverlay({
            name: 'nltText',
            totalStep: 2,
            needDefaultPointFigure: true,
            createPointFigures: ({ overlay, coordinates }) => {
                if (!coordinates.length) return [];
                const texto = (overlay.extendData && overlay.extendData.texto) || 'Texto';
                return [{
                    type: 'text',
                    attrs: { x: coordinates[0].x, y: coordinates[0].y, text: texto, align: 'left', baseline: 'bottom' },
                    styles: { color: '#E5E7EB', backgroundColor: 'rgba(13,16,22,0.85)', borderColor: 'rgba(34,211,238,0.5)', borderSize: 1, borderRadius: 6, size: 12, family: 'Inter, system-ui, sans-serif', paddingLeft: 6, paddingRight: 6, paddingTop: 4, paddingBottom: 4 },
                }];
            },
        });
    }

    /**
     * montar({ chart, toolsEl, hintEl, getSymbol }) -> { restaurar() }
     */
    function montar({ chart, toolsEl, hintEl, getSymbol }) {
        registrar();
        const state = NLTCharts.state;
        const esc = NLTCharts.ui.esc;
        let activa = null;       // id de la herramienta en curso
        let modoBorrar = false;
        let seleccionado = null; // id del overlay seleccionado (para la tecla Suprimir)
        let restaurando = false;

        chart.setStyles({
            overlay: {
                line: { color: ACCENT, size: 1 },
                point: { color: ACCENT, borderColor: 'rgba(34,211,238,0.35)', activeColor: ACCENT, activeBorderColor: 'rgba(34,211,238,0.35)' },
                text: { color: '#E5E7EB', backgroundColor: 'rgba(13,16,22,0.85)', borderColor: 'rgba(34,211,238,0.5)', family: NLTCharts.engine.FUENTE, size: 11 },
            },
        });

        toolsEl.innerHTML = HERRAMIENTAS.map((h) =>
            `<button type="button" class="ch-tool" data-tool="${esc(h.id)}" title="${esc(h.label)}" aria-label="${esc(h.label)}"><i class="ph ${esc(h.icono)}"></i></button>`).join('') +
            `<span class="ch-tool-sep" aria-hidden="true"></span>
             <button type="button" class="ch-tool" data-accion="borrar" title="Borrar un dibujo" aria-label="Borrar un dibujo"><i class="ph ph-eraser"></i></button>
             <button type="button" class="ch-tool peligro" data-accion="limpiar" title="Borrar todos los dibujos" aria-label="Borrar todos los dibujos"><i class="ph ph-trash"></i></button>`;

        function ayuda(texto) {
            hintEl.hidden = !texto;
            hintEl.textContent = texto || '';
        }

        function marcarBotones() {
            toolsEl.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === activa));
            toolsEl.querySelector('[data-accion="borrar"]').classList.toggle('on', modoBorrar);
        }

        function dibujosActuales() {
            // currentStep -1 = dibujo terminado; uno a medio hacer no se guarda.
            return chart.getOverlays({ groupId: GRUPO })
                .filter((o) => OVERLAYS_PROPIOS.has(o.name) && o.currentStep === -1)
                .map((o) => ({
                    name: o.name,
                    points: o.points.map((p) => ({ timestamp: p.timestamp, value: p.value })),
                    extendData: o.extendData || null,
                }));
        }

        function guardar() {
            if (restaurando) return;
            state.saveDrawings(getSymbol(), dibujosActuales());
        }

        function eventos() {
            return {
                onDrawEnd: (e) => {
                    const o = e.overlay;
                    if (o.name === 'nltText') {
                        const texto = (window.prompt('Texto:', '') || '').trim().slice(0, MAX_TEXTO);
                        if (!texto) { chart.removeOverlay({ id: o.id }); salirDeHerramienta(); return; }
                        chart.overrideOverlay({ id: o.id, extendData: { texto } });
                    }
                    salirDeHerramienta();
                    // overrideOverlay aplica en el próximo ciclo: guardar después.
                    setTimeout(guardar, 0);
                },
                onPressedMoveEnd: guardar,
                // onRemoved llega cuando el dibujo todavía figura en la lista del motor.
                onRemoved: () => { if (!restaurando) setTimeout(guardar, 0); },
                onClick: (e) => {
                    if (modoBorrar) chart.removeOverlay({ id: e.overlay.id });
                },
                // En modo borrar también se borra al seleccionar: el motor a
                // veces convierte el primer toque en "seleccionar" sin onClick.
                onSelected: (e) => {
                    if (modoBorrar) { chart.removeOverlay({ id: e.overlay.id }); return; }
                    seleccionado = e.overlay.id;
                },
                onDeselected: (e) => { if (seleccionado === e.overlay.id) seleccionado = null; },
            };
        }

        function crear(name, extra = {}) {
            return chart.createOverlay({ name, groupId: GRUPO, ...extra, ...eventos() });
        }

        function salirDeHerramienta() {
            activa = null;
            ayuda('');
            marcarBotones();
        }

        function cancelarEnCurso() {
            // Un dibujo empezado y no terminado (se cambió de herramienta a mitad).
            chart.getOverlays({ groupId: GRUPO }).filter((o) => o.currentStep !== -1).forEach((o) => {
                restaurando = true;
                chart.removeOverlay({ id: o.id });
                restaurando = false;
            });
        }

        toolsEl.addEventListener('click', (ev) => {
            const b = ev.target.closest('button');
            if (!b) return;
            if (b.dataset.tool) {
                cancelarEnCurso();
                modoBorrar = false;
                if (activa === b.dataset.tool) { salirDeHerramienta(); return; }
                const h = HERRAMIENTAS.find((x) => x.id === b.dataset.tool);
                activa = h.id;
                crear(h.overlay);
                ayuda(h.ayuda);
                marcarBotones();
            } else if (b.dataset.accion === 'borrar') {
                cancelarEnCurso();
                activa = null;
                // Con un dibujo seleccionado (el recién hecho queda
                // seleccionado) el borrador lo borra directo; si no, entra en
                // modo "tocá un dibujo para borrarlo".
                const sel = seleccionado && chart.getOverlays({ id: seleccionado })[0];
                if (sel && !modoBorrar) {
                    chart.removeOverlay({ id: seleccionado });
                    seleccionado = null;
                    salirDeHerramienta();
                    return;
                }
                modoBorrar = !modoBorrar;
                ayuda(modoBorrar ? 'Tocá un dibujo para borrarlo' : '');
                marcarBotones();
            } else if (b.dataset.accion === 'limpiar') {
                if (!dibujosActuales().length) return;
                if (!window.confirm('¿Borrar todos los dibujos de ' + getSymbol() + '?')) return;
                restaurando = true;
                chart.removeOverlay({ groupId: GRUPO });
                restaurando = false;
                guardar();
                salirDeHerramienta();
                modoBorrar = false;
                marcarBotones();
            }
        });

        document.addEventListener('keydown', (ev) => {
            const enCampo = /INPUT|TEXTAREA|SELECT/.test((ev.target && ev.target.tagName) || '');
            if (enCampo) return;
            if (ev.key === 'Escape') { cancelarEnCurso(); modoBorrar = false; salirDeHerramienta(); }
            if ((ev.key === 'Delete' || ev.key === 'Backspace') && seleccionado) {
                chart.removeOverlay({ id: seleccionado });
                seleccionado = null;
            }
        });

        return {
            // El rectángulo seleccionado (o el último dibujado) como zona:
            // precios y desde cuándo. Lo usa el análisis de zona manual PRO.
            rectanguloComoZona() {
                const rects = chart.getOverlays({ groupId: GRUPO }).filter((o) => o.name === 'nltRect' && o.currentStep === -1);
                const r = rects.find((o) => o.id === seleccionado) || rects[rects.length - 1];
                if (!r || r.points.length < 2) return null;
                const [a, b] = r.points;
                return { top: Math.max(a.value, b.value), bottom: Math.min(a.value, b.value), desde: Math.min(a.timestamp, b.timestamp) };
            },
            // Después de cargar un símbolo: saca los dibujos que haya en
            // pantalla y pone los guardados de ese símbolo.
            restaurar() {
                restaurando = true;
                chart.removeOverlay({ groupId: GRUPO });
                seleccionado = null;
                state.drawings(getSymbol()).forEach((d) => {
                    if (!OVERLAYS_PROPIOS.has(d.name) || !Array.isArray(d.points)) return;
                    crear(d.name, { points: d.points, extendData: d.extendData || undefined });
                });
                restaurando = false;
                salirDeHerramienta();
                modoBorrar = false;
                marcarBotones();
            },
        };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.drawings = { montar, HERRAMIENTAS };
})();
