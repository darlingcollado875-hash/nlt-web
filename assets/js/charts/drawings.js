/* NLT Charts -- herramientas de dibujo editables (etapa 2, bloques A y B).
 *
 * Cada dibujo es un overlay propio que se pinta SOLO desde su DrawingStyle
 * (extendData.estilo): color, opacidad, grosor, tipo de línea, relleno,
 * texto, extensión y parámetros propios (niveles de Fibonacci...). Nada de
 * colores fijos: cada herramienta tiene un estilo predeterminado que el
 * usuario cambia ("Guardar como predeterminado") y que se guarda por usuario.
 *
 * Un dibujo existente se selecciona con un toque/clic y queda seleccionado
 * hasta que se selecciona otro o se toca el fondo. Con un dibujo
 * seleccionado aparece la barra flotante: color, grosor, estilo de línea,
 * configuración (Estilo / Texto / Coordenadas), duplicar, bloquear y borrar.
 * Mover y redimensionar = arrastrar el dibujo o sus puntos.
 *
 * Long / Short Position: entrada, objetivo (TP) y stop (SL) editables
 * arrastrando sus puntos o desde Coordenadas; muestra R/R, distancia, % y
 * P/L estimado según cuenta y riesgo. Por ahora es solo visual; la orden que
 * representa sale de posicionComoOrden() -> NLTCharts.trading (BUY/SELL por
 * TickerAll cuando se active la ejecución, hoy desactivada).
 *
 * Rendimiento: cambiar estilo, mover o redimensionar solo REDIBUJA (nunca
 * recalcula indicadores). La única excepción es un rectángulo conectado al
 * NLT Zone Engine: al terminar de moverlo se avisa (onZonaMovida) para que
 * el motor lo vuelva a analizar -- ver pro.js. */
(function () {
    const GRUPO = 'nlt-drawings';
    const P = () => NLTCharts.pine;
    const FUENTE = 'Inter, system-ui, sans-serif';

    // ─────────────────────────── herramientas y su DrawingStyle ───────────────────────────
    const ESTILOS_LINEA = [{ v: 'solid', t: 'Sólida' }, { v: 'dashed', t: 'Guiones' }, { v: 'dotted', t: 'Puntos' }];
    const col = (hex, t) => ({ hex, t });
    const NIVELES_FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];
    const NIVELES_ON = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

    const linea = (def) => [
        { id: 'color', tipo: 'color', def: def.color, titulo: 'Color', grupo: 'Línea', tab: 'Estilo', inline: 'l', recalc: false },
        { id: 'grosor', tipo: 'int', def: def.grosor || 1, titulo: 'Grosor', grupo: 'Línea', tab: 'Estilo', inline: 'l', min: 1, max: 6, recalc: false },
        { id: 'estiloLinea', tipo: 'string', def: 'solid', titulo: 'Tipo', grupo: 'Línea', tab: 'Estilo', opciones: ESTILOS_LINEA, recalc: false },
    ];
    const textoIn = (def = '') => [{ id: 'texto', tipo: 'texto', def, titulo: 'Texto', grupo: '', tab: 'Texto', max: 200, recalc: false }];

    // Long/Short Position: cuenta y riesgo (P/L estimado) + colores de cada parte.
    const posicion = () => [
        { id: 'cuenta', tipo: 'float', def: 10000, titulo: 'Tamaño de cuenta', grupo: 'Cuenta y riesgo', tab: 'Entradas', min: 0, step: 100, recalc: false },
        { id: 'riesgo', tipo: 'float', def: 1, titulo: 'Riesgo (%)', grupo: 'Cuenta y riesgo', tab: 'Entradas', min: 0, max: 100, step: 0.1, recalc: false },
        { id: 'pasoLote', tipo: 'string', def: '0.01', titulo: 'Redondear el lote a', grupo: 'Cuenta y riesgo', tab: 'Entradas', opciones: [{ v: '0.01', t: '0.01 (micro lote)' }, { v: '0.1', t: '0.1' }, { v: '1', t: '1 (lote estándar)' }], recalc: false },
        { id: 'ganancia', tipo: 'color', def: col('#22C55E', 80), titulo: 'Objetivo', grupo: 'Zonas', tab: 'Estilo', inline: 'z', recalc: false },
        { id: 'perdida', tipo: 'color', def: col('#EF4444', 80), titulo: 'Stop', grupo: 'Zonas', tab: 'Estilo', inline: 'z', recalc: false },
        { id: 'color', tipo: 'color', def: col('#9CA3AF', 0), titulo: 'Entrada', grupo: 'Línea de entrada', tab: 'Estilo', inline: 'l', recalc: false },
        { id: 'grosor', tipo: 'int', def: 1, titulo: 'Grosor', grupo: 'Línea de entrada', tab: 'Estilo', inline: 'l', min: 1, max: 6, recalc: false },
        { id: 'estiloLinea', tipo: 'string', def: 'solid', titulo: 'Tipo', grupo: 'Línea de entrada', tab: 'Estilo', opciones: ESTILOS_LINEA, recalc: false },
        { id: 'colorTexto', tipo: 'color', def: col('#FFFFFF', 0), titulo: 'Color', grupo: 'Etiquetas', tab: 'Estilo', inline: 't', recalc: false },
        { id: 'mostrarEtiquetas', tipo: 'bool', def: true, titulo: 'Mostrar', grupo: 'Etiquetas', tab: 'Estilo', inline: 't', recalc: false },
        { id: 'mostrarPL', tipo: 'bool', def: true, titulo: 'P/L estimado', grupo: 'Etiquetas', tab: 'Estilo', inline: 't2', recalc: false },
        { id: 'mostrarPct', tipo: 'bool', def: true, titulo: 'Porcentaje', grupo: 'Etiquetas', tab: 'Estilo', inline: 't2', recalc: false },
    ];

    const BASE = [
        {
            id: 'hline', overlay: 'nltHLine', pasos: 2, icono: 'ph-minus', label: 'Línea horizontal', ayuda: 'Tocá el precio donde va la línea',
            inputs: [...linea({ color: col('#4378ff', 0) }),
                { id: 'mostrarPrecio', tipo: 'bool', def: true, titulo: 'Mostrar precio', grupo: 'Etiqueta', tab: 'Estilo', recalc: false },
                ...textoIn()],
            coords: ['Precio'],
        },
        {
            id: 'trend', overlay: 'nltTrend', pasos: 3, icono: 'ph-line-segment', label: 'Línea de tendencia', ayuda: 'Tocá el punto inicial y después el final',
            inputs: [...linea({ color: col('#4378ff', 0), grosor: 2 }),
                { id: 'extIzq', tipo: 'bool', def: false, titulo: 'Extender a la izquierda', grupo: 'Extensión', tab: 'Estilo', inline: 'e', recalc: false },
                { id: 'extDer', tipo: 'bool', def: false, titulo: 'Extender a la derecha', grupo: 'Extensión', tab: 'Estilo', inline: 'e', recalc: false },
                ...textoIn()],
            coords: ['Precio 1', 'Precio 2'],
        },
        {
            id: 'ray', overlay: 'nltTrend', pasos: 3, icono: 'ph-arrow-up-right', label: 'Rayo', ayuda: 'Tocá el origen y después la dirección',
            inputs: [...linea({ color: col('#4378ff', 0), grosor: 2 }),
                { id: 'extIzq', tipo: 'bool', def: false, titulo: 'Extender a la izquierda', grupo: 'Extensión', tab: 'Estilo', inline: 'e', recalc: false },
                { id: 'extDer', tipo: 'bool', def: true, titulo: 'Extender a la derecha', grupo: 'Extensión', tab: 'Estilo', inline: 'e', recalc: false },
                ...textoIn()],
            coords: ['Precio 1', 'Precio 2'],
        },
        {
            id: 'rect', overlay: 'nltRect', pasos: 3, icono: 'ph-rectangle', label: 'Rectángulo', ayuda: 'Tocá una esquina y después la opuesta',
            inputs: [
                { id: 'color', tipo: 'color', def: col('#4378ff', 0), titulo: 'Borde', grupo: 'Borde', tab: 'Estilo', inline: 'b', recalc: false },
                { id: 'grosor', tipo: 'int', def: 1, titulo: 'Grosor', grupo: 'Borde', tab: 'Estilo', inline: 'b', min: 1, max: 6, recalc: false },
                { id: 'estiloLinea', tipo: 'string', def: 'solid', titulo: 'Tipo', grupo: 'Borde', tab: 'Estilo', opciones: ESTILOS_LINEA, recalc: false },
                { id: 'relleno', tipo: 'color', def: col('#4378ff', 88), titulo: 'Relleno', grupo: 'Fondo', tab: 'Estilo', recalc: false },
                { id: 'extDer', tipo: 'bool', def: false, titulo: 'Extender a la derecha', grupo: 'Extensión', tab: 'Estilo', recalc: false },
                ...textoIn()],
            coords: ['Precio superior', 'Precio inferior'],
        },
        {
            id: 'fib', overlay: 'nltFib', pasos: 3, icono: 'ph-chart-bar-horizontal', label: 'Fibonacci', ayuda: 'Tocá el inicio del impulso y después el final',
            inputs: [...linea({ color: col('#9CA3AF', 0) }),
                ...NIVELES_FIB.map((n, k) => ({ id: `n${k}`, tipo: 'bool', def: NIVELES_ON.includes(n), titulo: String(n), grupo: 'Niveles', tab: 'Estilo', inline: `n${Math.floor(k / 3)}`, recalc: false })),
                { id: 'relleno', tipo: 'color', def: col('#4378ff', 94), titulo: 'Relleno entre niveles', grupo: 'Fondo', tab: 'Estilo', recalc: false },
                { id: 'mostrarPrecios', tipo: 'bool', def: true, titulo: 'Mostrar precios', grupo: 'Etiquetas', tab: 'Estilo', inline: 'et', recalc: false },
                { id: 'extDer', tipo: 'bool', def: false, titulo: 'Extender a la derecha', grupo: 'Etiquetas', tab: 'Estilo', inline: 'et', recalc: false }],
            coords: ['Precio 1 (nivel 1)', 'Precio 2 (nivel 0)'],
        },
        {
            id: 'text', overlay: 'nltText', pasos: 2, icono: 'ph-text-t', label: 'Texto', ayuda: 'Tocá donde va el texto',
            inputs: [
                { id: 'color', tipo: 'color', def: col('#E5E7EB', 0), titulo: 'Color', grupo: 'Texto', tab: 'Estilo', inline: 't', recalc: false },
                { id: 'tamano', tipo: 'int', def: 13, titulo: 'Tamaño', grupo: 'Texto', tab: 'Estilo', inline: 't', min: 8, max: 48, recalc: false },
                { id: 'fondo', tipo: 'bool', def: true, titulo: 'Fondo', grupo: 'Fondo', tab: 'Estilo', inline: 'f', recalc: false },
                { id: 'colorFondo', tipo: 'color', def: col('#0D1016', 15), titulo: '', grupo: 'Fondo', tab: 'Estilo', inline: 'f', recalc: false },
                { id: 'texto', tipo: 'texto', def: 'Texto', titulo: 'Texto', grupo: '', tab: 'Texto', max: 200, multilinea: true, recalc: false }],
            coords: ['Precio'],
        },
        {
            id: 'long', overlay: 'nltPosition', pasos: 2, icono: 'ph-trend-up', label: 'Long Position', ayuda: 'Tocá el precio de entrada', lado: 'long',
            inputs: posicion(), coords: ['Entrada', 'Objetivo (TP)', 'Stop (SL)'],
        },
        {
            id: 'short', overlay: 'nltPosition', pasos: 2, icono: 'ph-trend-down', label: 'Short Position', ayuda: 'Tocá el precio de entrada', lado: 'short',
            inputs: posicion(), coords: ['Entrada', 'Objetivo (TP)', 'Stop (SL)'],
        },
    ];
    // Herramientas adicionales (canales, Fibonacci/Gann, patrones, medición, formas, notas): ver drawings-extra.js
    const EXTRA_MOD = NLTCharts.drawingsExtra || null;
    const HERRAMIENTAS = BASE.concat(EXTRA_MOD ? EXTRA_MOD.definir({ col, linea, textoIn, ESTILOS_LINEA }) : []);
    const POR_ID = Object.fromEntries(HERRAMIENTAS.map((h) => [h.id, h]));
    const NOMBRES = new Set(HERRAMIENTAS.map((h) => h.overlay));
    const claveDef = (hid) => `DIBUJO_${hid}`;

    // Estilo efectivo de un dibujo = predeterminado del usuario para esa herramienta + lo propio del dibujo.
    function estiloDe(overlay) {
        const e = (overlay.extendData && overlay.extendData.estilo) || {};
        const h = POR_ID[e.herramienta] || HERRAMIENTAS.find((x) => x.overlay === overlay.name);
        return { h, v: NLTCharts.settings.mezclar(h.inputs, { ...NLTCharts.settings.valores(claveDef(h.id)), ...e }) };
    }
    const css = (c) => P().css(c);
    const guiones = (s, g) => (s === 'dashed' ? [6 + g, 4 + g] : s === 'dotted' ? [1 + g, 3 + g] : [2, 2]);
    const lineaEstilo = (v) => ({ style: v.estiloLinea === 'solid' ? 'solid' : 'dashed', dashedValue: guiones(v.estiloLinea, v.grosor), size: v.grosor, color: css(v.color) });

    // Extiende el segmento a-b hasta los bordes del panel.
    function extender(a, b, izq, der, ancho) {
        const dx = b.x - a.x, dy = b.y - a.y;
        if (dx === 0) return [a, b];
        const m = dy / dx;
        const p1 = izq ? (dx > 0 ? { x: 0, y: a.y - m * a.x } : { x: ancho, y: a.y + m * (ancho - a.x) }) : a;
        const p2 = der ? (dx > 0 ? { x: ancho, y: b.y + m * (ancho - b.x) } : { x: 0, y: b.y - m * b.x }) : b;
        return [p1, p2];
    }

    function etiqueta(x, y, texto, v, align = 'left', baseline = 'bottom') {
        return { type: 'text', ignoreEvent: true, attrs: { x, y, text: texto, align, baseline }, styles: { color: css(v.color), size: 11, family: FUENTE, backgroundColor: 'transparent', borderSize: 0, paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 } };
    }

    // Zona conectada al NLT Zone Engine: estado que vuelve del servidor (pro.js lo actualiza).
    const ESTADO_ZONA = { 'ARMED': ['#3B82F6', 'ARMED'], 'IN ZONE': ['#EAB308', 'IN ZONE'], 'MITIGATED': ['#22C55E', 'MITIGATED'], 'INVALIDATED': ['#EF4444', 'INVALIDATED'] };

    let simboloFn = () => '';   // lo fija montar(): el símbolo en pantalla (para el tamaño del contrato)
    let registrados = false;
    function registrar() {
        if (registrados) return;
        registrados = true;
        HERRAMIENTAS.forEach((h) => NLTCharts.settings.registrar(claveDef(h.id), { titulo: h.label, inputs: h.inputs }));
        if (EXTRA_MOD) EXTRA_MOD.registrar({ estiloDe, css, lineaEstilo, extender, etiqueta, FUENTE, guiones });

        klinecharts.registerOverlay({
            name: 'nltHLine', totalStep: 2, needDefaultPointFigure: true, needDefaultYAxisFigure: true,
            createPointFigures: ({ overlay, coordinates, bounding }) => {
                if (!coordinates.length) return [];
                const { v } = estiloDe(overlay);
                const y = coordinates[0].y;
                const fig = [{ type: 'line', attrs: { coordinates: [{ x: 0, y }, { x: bounding.width, y }] }, styles: lineaEstilo(v) }];
                if (v.texto) fig.push(etiqueta(coordinates[0].x, y - 3, v.texto, v));
                return fig;
            },
            createYAxisFigures: ({ overlay, coordinates, bounding }) => {
                const { v } = estiloDe(overlay);
                if (!v.mostrarPrecio || !coordinates.length) return [];
                const precio = overlay.points[0].value;
                return [{ type: 'text', attrs: { x: 0, y: coordinates[0].y, text: NLTCharts.drawings.formatear(precio), align: 'left', baseline: 'middle' }, styles: { color: '#0B0E14', backgroundColor: css({ ...v.color, t: 0 }), size: 11, family: FUENTE, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2, borderRadius: 2 } }];
                void bounding;
            },
        });

        klinecharts.registerOverlay({
            name: 'nltTrend', totalStep: 3, needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true,
            createPointFigures: ({ overlay, coordinates, bounding }) => {
                if (coordinates.length < 2) return [];
                const { v } = estiloDe(overlay);
                const [p1, p2] = extender(coordinates[0], coordinates[1], v.extIzq, v.extDer, bounding.width);
                const fig = [{ type: 'line', attrs: { coordinates: [p1, p2] }, styles: lineaEstilo(v) }];
                if (v.texto) fig.push(etiqueta((coordinates[0].x + coordinates[1].x) / 2, (coordinates[0].y + coordinates[1].y) / 2 - 4, v.texto, v, 'center'));
                return fig;
            },
        });

        klinecharts.registerOverlay({
            name: 'nltRect', totalStep: 3, needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true,
            createPointFigures: ({ overlay, coordinates, bounding }) => {
                if (coordinates.length < 2) return [];
                const { v } = estiloDe(overlay);
                const [a, b] = coordinates;
                const x2 = v.extDer ? bounding.width : b.x;
                const zona = overlay.extendData && overlay.extendData.zonaNLT;
                const an = overlay.extendData && overlay.extendData.analisis;
                const est = an && ESTADO_ZONA[an.status];
                const borde = est ? est[0] : css(v.color);
                const fig = [{
                    type: 'polygon',
                    attrs: { coordinates: [a, { x: x2, y: a.y }, { x: x2, y: b.y }, { x: a.x, y: b.y }] },
                    styles: { style: 'stroke_fill', color: css(v.relleno), borderColor: borde, borderSize: est ? Math.max(2, v.grosor) : v.grosor, borderStyle: v.estiloLinea === 'solid' ? 'solid' : 'dashed', borderDashedValue: guiones(v.estiloLinea, v.grosor) },
                }];
                const arriba = Math.min(a.y, b.y), izq = Math.min(a.x, x2);
                if (zona) {
                    const txt = `NLT ${zona.esOB ? 'OB' : 'FVG'} ${zona.alcista ? '▲' : '▼'}${est ? ` · ${est[1]}` : ' · analizando…'}${an ? ` · ${an.touches} toques${an.in_zone ? ' · en zona' : ''}${an.inverse_fvg ? ' · FVG invertido' : ''}` : ''}`;
                    fig.push({ type: 'text', ignoreEvent: true, attrs: { x: izq + 4, y: arriba + 3, text: txt, align: 'left', baseline: 'top' }, styles: { color: '#fff', backgroundColor: est ? est[0] : 'rgba(59,130,246,.85)', size: 10, family: FUENTE, weight: 600, paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2, borderRadius: 3 } });
                } else if (v.texto) {
                    fig.push(etiqueta(izq + 4, arriba + 3, v.texto, v, 'left', 'top'));
                }
                return fig;
            },
        });

        klinecharts.registerOverlay({
            name: 'nltFib', totalStep: 3, needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true,
            createPointFigures: ({ overlay, coordinates, bounding }) => {
                if (coordinates.length < 2 || overlay.points.length < 2) return [];
                const { v } = estiloDe(overlay);
                const [a, b] = coordinates;
                const v1 = overlay.points[0].value, v0 = overlay.points[1].value;   // nivel 1 en el primer punto, 0 en el segundo
                const x1 = Math.min(a.x, b.x), x2 = v.extDer ? bounding.width : Math.max(a.x, b.x);
                const activos = NIVELES_FIB.map((n, k) => ({ n, on: v[`n${k}`] })).filter((x) => x.on);
                const fig = [];
                // Eje de precios lineal: el píxel de cada nivel se interpola entre los dos puntos (nivel 1 = a, nivel 0 = b).
                const ys = activos.map(({ n }) => b.y + (a.y - b.y) * n);
                if (v.relleno && v.relleno.t < 100) {
                    for (let k = 1; k < ys.length; k++) {
                        fig.push({ type: 'polygon', ignoreEvent: true, attrs: { coordinates: [{ x: x1, y: ys[k - 1] }, { x: x2, y: ys[k - 1] }, { x: x2, y: ys[k] }, { x: x1, y: ys[k] }] }, styles: { style: 'fill', color: css(v.relleno) } });
                    }
                }
                activos.forEach(({ n }, k) => {
                    const y = ys[k];
                    fig.push({ type: 'line', attrs: { coordinates: [{ x: x1, y }, { x: x2, y }] }, styles: lineaEstilo(v) });
                    const precio = v0 + (v1 - v0) * n;
                    fig.push(etiqueta(x1 + 2, y - 2, `${n}${v.mostrarPrecios ? ` (${NLTCharts.drawings.formatear(precio)})` : ''}`, v));
                });
                fig.push({ type: 'line', ignoreEvent: true, attrs: { coordinates: [a, b] }, styles: { ...lineaEstilo(v), style: 'dashed', dashedValue: [3, 3], size: 1 } });
                return fig;
            },
        });

        // Long/Short Position. Puntos: [0] entrada (borde izquierdo), [1] objetivo y
        // [2] stop (los dos en el borde derecho: se arrastran juntos en X).
        klinecharts.registerOverlay({
            name: 'nltPosition', totalStep: 2, needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true,
            createPointFigures: ({ chart, overlay, coordinates }) => {
                if (coordinates.length < 3 || overlay.points.length < 3) return [];
                const { h, v } = estiloDe(overlay);
                const [ce, ct, cs] = coordinates;
                const x1 = Math.min(ce.x, ct.x);
                let x2 = Math.max(ce.x, ct.x, x1 + 8);
                const m = calcularPosicion(h.lado, overlay.points.map((pt) => pt.value), v, simboloFn());
                // La operación SE CIERRA cuando el mercado toca el objetivo o el stop: la caja termina en esa vela y marca el resultado.
                const res = resultadoPosicion(chart, overlay.id, h.lado, overlay.points[0].timestamp, m.entrada, m.tp, m.sl);
                let xHit = null;
                if (res) {
                    try { const px = chart.convertToPixel({ timestamp: res.ts }, { paneId: 'candle_pane' }); if (px && Number.isFinite(px.x)) { xHit = px.x; x2 = Math.max(x1 + 8, px.x); } } catch (_) { /* sin conversión: queda el ancho elegido */ }
                }
                const caja = (y1, y2, c) => ({ type: 'polygon', attrs: { coordinates: [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }] }, styles: { style: 'fill', color: css(c) } });
                const fig = [caja(ce.y, ct.y, v.ganancia), caja(ce.y, cs.y, v.perdida),
                    { type: 'line', attrs: { coordinates: [{ x: x1, y: ce.y }, { x: x2, y: ce.y }] }, styles: lineaEstilo(v) }];
                if (!v.mostrarEtiquetas) return fig;
                const f = NLTCharts.drawings.formatear, cx = (x1 + x2) / 2;
                const dinero = (n) => `${n < 0 ? '−' : '+'}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                const txt = (y, texto, fondo, base) => ({ type: 'text', ignoreEvent: true, attrs: { x: cx, y, text: texto, align: 'center', baseline: base }, styles: { color: css(v.colorTexto), backgroundColor: fondo, size: 11, family: FUENTE, weight: 500, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, borderRadius: 3 } });
                const detalle = (dist, pct, pl) => `${f(dist)}${v.mostrarPct ? ` (${pct.toFixed(2)}%)` : ''}${v.mostrarPL && m.lotes ? ` · ${dinero(pl)}` : ''}`;
                const arribaEsTP = ct.y < cs.y;
                fig.push(txt(arribaEsTP ? ct.y - 4 : ct.y + 4, `Objetivo: ${f(m.tp)} · ${detalle(m.distTP, m.pctTP, m.plTP)}`, css({ ...v.ganancia, t: 15 }), arribaEsTP ? 'bottom' : 'top'));
                fig.push(txt(arribaEsTP ? cs.y + 4 : cs.y - 4, `Stop: ${f(m.sl)} · ${detalle(m.distSL, m.pctSL, m.plSL)}`, css({ ...v.perdida, t: 15 }), arribaEsTP ? 'top' : 'bottom'));
                fig.push(txt(ce.y, `${h.lado === 'long' ? 'Long' : 'Short'} · R/R ${m.rr === null ? '—' : m.rr.toFixed(2)}${m.lotes ? ` · ${formatearLotes(m.lotes)} ${m.lotes === 1 ? 'lote' : 'lotes'}${m.excede ? ' ⚠' : ''}` : ''}`, 'rgba(17,24,39,.88)', 'middle'));
                if (res && xHit != null) {
                    const yNivel = res.estado === 'tp' ? ct.y : cs.y, ok = res.estado === 'tp';
                    const pl = ok ? m.plTP : m.plSL;
                    fig.push({ type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x: xHit, y: ce.y }, { x: xHit, y: yNivel }] }, styles: { style: 'solid', size: 2, color: ok ? '#22C55E' : '#EF4444' } });
                    fig.push({ type: 'circle', ignoreEvent: true, attrs: { x: xHit, y: yNivel, r: 5 }, styles: { style: 'fill', color: ok ? '#22C55E' : '#EF4444' } });
                    fig.push({ type: 'text', ignoreEvent: true, attrs: { x: xHit, y: yNivel + (ok === (ct.y < cs.y) ? -10 : 10), text: `${ok ? '✓ Objetivo alcanzado' : '✗ Stop alcanzado'}${m.lotes ? ` · ${dinero(pl)}` : ''}`, align: 'center', baseline: ok === (ct.y < cs.y) ? 'bottom' : 'top' },
                        styles: { color: '#fff', backgroundColor: ok ? 'rgba(21,128,61,.95)' : 'rgba(185,28,28,.95)', size: 11, family: FUENTE, weight: 700, paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 4 } });
                }
                if (m.lotes && v.mostrarEtiquetas) {
                    // Panel de tamaño: lo que hay que poner en la plataforma para arriesgar lo planeado.
                    const dineroPos = (n) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                    fig.push(txt(ce.y + 22, `LOTE ${formatearLotes(m.lotes)} · riesgo ${dineroPos(m.riesgoReal)} (${m.riesgoPct.toFixed(2)}% de ${dineroPos(v.cuenta)})`, m.excede ? 'rgba(180,83,9,.92)' : 'rgba(30,64,175,.9)', 'top'));
                }
                return fig;
            },
            performEventPressedMove: ({ points, performPointIndex, performPoint }) => {
                if (points.length < 3) return;
                if (performPointIndex === 1 || performPointIndex === 2) {
                    const otro = points[performPointIndex === 1 ? 2 : 1];   // borde derecho común
                    otro.timestamp = performPoint.timestamp;
                    otro.dataIndex = performPoint.dataIndex;
                }
            },
        });

        klinecharts.registerOverlay({
            name: 'nltText', totalStep: 2, needDefaultPointFigure: true,
            createPointFigures: ({ overlay, coordinates }) => {
                if (!coordinates.length) return [];
                const { v } = estiloDe(overlay);
                return [{
                    type: 'text',
                    attrs: { x: coordinates[0].x, y: coordinates[0].y, text: v.texto || 'Texto', align: 'left', baseline: 'bottom' },
                    styles: { color: css(v.color), size: v.tamano, family: FUENTE, weight: 500, backgroundColor: v.fondo ? css(v.colorFondo) : 'transparent', borderColor: v.fondo ? css({ ...v.color, t: 70 }) : 'transparent', borderSize: v.fondo ? 1 : 0, borderRadius: 4, paddingLeft: 6, paddingRight: 6, paddingTop: 4, paddingBottom: 4 },
                }];
            },
        });
    }

    // ¿El mercado ya tocó el objetivo o el stop de esta posición? Mira las velas POSTERIORES a la de la entrada; si en una misma vela
    // se tocan los dos no se sabe cuál fue primero y gana el stop (lo conservador). Se calcula una vez por cambio de datos (caché).
    const cachePosicion = new Map();
    function resultadoPosicion(chart, id, lado, t0, entrada, tp, sl) {
        const datos = chart.getDataList(); const n = datos.length;
        if (!n || !(t0 > 0)) return null;
        const ult = datos[n - 1];
        const clave = `${t0}|${entrada}|${tp}|${sl}|${n}|${datos[0].timestamp}|${ult.high}|${ult.low}`;
        const previo = cachePosicion.get(id);
        if (previo && previo.clave === clave) return previo.r;
        let a = 0, b = n;
        while (a < b) { const mid = (a + b) >> 1; if (datos[mid].timestamp > t0) b = mid; else a = mid + 1; }
        let r = null;
        const largo = lado === 'long';
        for (let i = a; i < n; i++) {
            const d = datos[i];
            if (largo ? d.low <= sl : d.high >= sl) { r = { estado: 'sl', ts: d.timestamp }; break; }
            if (largo ? d.high >= tp : d.low <= tp) { r = { estado: 'tp', ts: d.timestamp }; break; }
        }
        if (cachePosicion.size > 60) cachePosicion.clear();
        cachePosicion.set(id, { clave, r });
        return r;
    }

    // ── tamaño de la posición en LOTES ──
    // Contrato por 1 lote: forex 100.000 unidades, oro 100 oz, plata 5.000 oz; cripto e índices, 1 unidad.
    function contratoDe(sym) {
        const s = String(sym || '').toUpperCase();
        if (s === 'XAUUSD') return 100;
        if (s === 'XAGUSD') return 5000;
        if (/^(BTC|ETH|LTC|XRP|SOL|DXY|US30|US100|US500|NAS|SPX|GER|DAX|UK)/.test(s)) return 1;
        return /^[A-Z]{6}$/.test(s) ? 100000 : 1;
    }
    // Factor para pasar la moneda de cotización a USD (en pares USDxxx se divide por el precio; en cruces sin USD es aproximado).
    function convUSD(sym, precio) {
        const s = String(sym || '').toUpperCase();
        if (s.endsWith('USD')) return 1;
        if (s.startsWith('USD') && precio) return 1 / precio;
        return 1;
    }
    const formatearLotes = (n) => (n >= 10 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toFixed(2)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') || '0';

    // Números de una posición: distancias, %, R/R y, con la cuenta y el riesgo elegidos, el LOTE que hay que operar
    // (se redondea hacia ABAJO al paso del broker para no arriesgar más de lo planeado) y la ganancia/pérdida en dólares.
    function calcularPosicion(lado, [entrada, tp, sl], v, sym) {
        const distTP = Math.abs(tp - entrada), distSL = Math.abs(entrada - sl);
        const contrato = contratoDe(sym), conv = convUSD(sym, entrada);
        const riesgoDinero = (v.cuenta || 0) * (v.riesgo || 0) / 100;
        const porLoteSL = distSL * contrato * conv;                       // dólares que se pierden por 1 lote si salta el stop
        const paso = parseFloat(v.pasoLote) > 0 ? parseFloat(v.pasoLote) : 0.01;
        const exactos = porLoteSL > 0 && riesgoDinero > 0 ? riesgoDinero / porLoteSL : 0;
        let lotes = exactos > 0 ? Math.floor(exactos / paso + 1e-9) * paso : 0;
        let excede = false;
        if (exactos > 0 && lotes < paso) { lotes = paso; excede = true; }  // ni el lote mínimo cabe en ese riesgo: se avisa
        lotes = Number(lotes.toFixed(4));
        const signo = lado === 'long' ? 1 : -1;
        const riesgoReal = lotes * porLoteSL;
        return {
            lado, entrada, tp, sl, distTP, distSL, lotes, excede, contrato, riesgoReal,
            riesgoPct: v.cuenta ? (riesgoReal / v.cuenta) * 100 : 0,
            cantidad: lotes * contrato,                                  // unidades (lotes × contrato)
            pctTP: entrada ? (distTP / entrada) * 100 : 0, pctSL: entrada ? (distSL / entrada) * 100 : 0,
            rr: distSL > 0 ? distTP / distSL : null,
            plTP: lotes * contrato * conv * (tp - entrada) * signo, plSL: lotes * contrato * conv * (sl - entrada) * signo,
        };
    }

    // Dibujos guardados con la versión anterior (overlays nativos de KLineChart).
    const MIGRAR = {
        horizontalStraightLine: ['nltHLine', 'hline'], segment: ['nltTrend', 'trend'], rayLine: ['nltTrend', 'ray'],
        fibonacciLine: ['nltFib', 'fib'], nltRect: ['nltRect', 'rect'], nltText: ['nltText', 'text'],
    };
    function migrar(d) {
        if (NOMBRES.has(d.name) && d.extendData && d.extendData.estilo) return d;
        const m = MIGRAR[d.name];
        if (!m) return null;
        const estilo = { herramienta: m[1] };
        if (d.extendData && d.extendData.texto) estilo.texto = d.extendData.texto;
        return { name: m[0], points: d.points, lock: !!d.lock, extendData: { ...(d.extendData || {}), estilo } };
    }

    /**
     * montar({ chart, toolsEl, hintEl, barraEl, getSymbol, onZonaMovida, puedeZonaNLT, onEnviarZona })
     */
    function montar({ chart, toolsEl, hintEl, barraEl, getSymbol, onZonaMovida, puedeZonaNLT, onEnviarZona }) {
        registrar();
        simboloFn = getSymbol;
        const state = NLTCharts.state;
        const esc = NLTCharts.ui.esc;
        let activa = null;       // herramienta en curso
        let modoBorrar = false;
        let seleccionado = null; // id del overlay seleccionado
        let restaurando = false;

        chart.setStyles({
            overlay: {
                point: { color: '#4378ff', borderColor: 'rgba(67,120,255,0.35)', activeColor: '#4378ff', activeBorderColor: 'rgba(67,120,255,0.35)', radius: 5, activeRadius: 6 },
                text: { family: FUENTE, size: 11 },
            },
        });

        const CATS = EXTRA_MOD ? EXTRA_MOD.CATEGORIAS : [];
        let pila = [], pos = -1, deshaciendo = false;   // deshacer/rehacer: fotos de los dibujos del símbolo
        const ATAJOS = { t: 'trend', h: 'hline', v: 'vline', f: 'fib', r: 'rect', c: 'channel', x: 'pat_xabcd', m: 'ruler', p: 'vpfr', b: 'brush', n: 'note' };
        const ATAJO_DE = Object.fromEntries(Object.entries(ATAJOS).map(([k, id]) => [id, k.toUpperCase()]));
        let favs = (state.prefs().dibujoFavs || []).filter((id) => POR_ID[id] && POR_ID[id].cat);
        let iman = ['normal', 'weak_magnet', 'strong_magnet'].includes(state.prefs().dibujoIman) ? state.prefs().dibujoIman : 'normal';
        let mantener = !!state.prefs().dibujoMantener;
        let todosOcultos = false;
        const botonTool = (h) => `<button type="button" class="ch-tool" data-tool="${esc(h.id)}" title="${esc(h.label)}${ATAJO_DE[h.id] ? ` (Alt+${ATAJO_DE[h.id]})` : ''}" aria-label="${esc(h.label)}"><i class="ph ${esc(h.icono)}"></i></button>`;
        const NOMBRE_IMAN = { normal: 'Imán apagado', weak_magnet: 'Imán suave: se acerca a máximos y mínimos', strong_magnet: 'Imán fuerte: se pega a máximos y mínimos' };
        function pintarHerramientas() {
            toolsEl.innerHTML = HERRAMIENTAS.filter((h) => !h.cat || favs.includes(h.id)).map(botonTool).join('') +
            CATS.map((c) => `<button type="button" class="ch-tool ch-cat" data-cat="${esc(c.id)}" title="${esc(c.label)}" aria-label="${esc(c.label)}" aria-haspopup="true" aria-expanded="false"><i class="ph ${esc(c.icono)}"></i></button>`).join('') +
            `<span class="ch-tool-sep" aria-hidden="true"></span>
             <button type="button" class="ch-tool${iman !== 'normal' ? ' on' : ''}${iman === 'strong_magnet' ? ' fuerte' : ''}" data-accion="iman" title="${NOMBRE_IMAN[iman]}" aria-label="${NOMBRE_IMAN[iman]}" aria-pressed="${iman !== 'normal'}"><i class="ph ph-magnet"></i></button>
             <button type="button" class="ch-tool${mantener ? ' on' : ''}" data-accion="mantener" title="${mantener ? 'Mantener la herramienta: activado' : 'Mantener la herramienta después de dibujar'}" aria-label="Mantener la herramienta" aria-pressed="${mantener}"><i class="ph ph-push-pin"></i></button>
             <button type="button" class="ch-tool${todosOcultos ? ' on' : ''}" data-accion="ocultar" title="${todosOcultos ? 'Mostrar los dibujos' : 'Ocultar todos los dibujos'}" aria-label="Ocultar o mostrar los dibujos" aria-pressed="${todosOcultos}"><i class="ph ph-${todosOcultos ? 'eye-slash' : 'eye'}"></i></button>
             <button type="button" class="ch-tool" data-accion="deshacer" title="Deshacer (Ctrl+Z)" aria-label="Deshacer" ${pos > 0 ? '' : 'disabled'}><i class="ph ph-arrow-u-up-left"></i></button>
             <button type="button" class="ch-tool" data-accion="rehacer" title="Rehacer (Ctrl+Y)" aria-label="Rehacer" ${pos < pila.length - 1 ? '' : 'disabled'}><i class="ph ph-arrow-u-up-right"></i></button>
             <button type="button" class="ch-tool" data-accion="borrar" title="Borrar un dibujo" aria-label="Borrar un dibujo"><i class="ph ph-eraser"></i></button>
             <button type="button" class="ch-tool peligro" data-accion="limpiar" title="Borrar todos los dibujos" aria-label="Borrar todos los dibujos"><i class="ph ph-trash"></i></button>`;
            marcarBotones();
        }

        function ayuda(texto) { hintEl.hidden = !texto; hintEl.textContent = texto || ''; }
        // Menú de cada categoría (se abre junto al botón; en el celular, encima de la barra).
        const volador = document.createElement('div');
        volador.className = 'ch-fly'; volador.hidden = true; volador.setAttribute('role', 'menu');
        document.body.appendChild(volador);
        let catAbierta = null;
        function cerrarMenu() { volador.hidden = true; if (catAbierta) { const b = toolsEl.querySelector(`[data-cat="${catAbierta}"]`); if (b) b.setAttribute('aria-expanded', 'false'); } catAbierta = null; }
        function abrirMenu(cat, boton) {
            if (catAbierta === cat) { cerrarMenu(); return; }
            cerrarMenu();
            catAbierta = cat; boton.setAttribute('aria-expanded', 'true');
            volador.innerHTML = HERRAMIENTAS.filter((h) => h.cat === cat).map((h) =>
                `<div class="ch-fly-fila"><button type="button" role="menuitem" class="ch-fly-it${h.id === activa ? ' on' : ''}" data-tool="${esc(h.id)}"><i class="ph ${esc(h.icono)}"></i><span>${esc(h.label)}</span>${ATAJO_DE[h.id] ? `<kbd>Alt+${ATAJO_DE[h.id]}</kbd>` : ''}</button><button type="button" class="ch-fly-fav${favs.includes(h.id) ? ' on' : ''}" data-fav="${esc(h.id)}" title="${favs.includes(h.id) ? 'Quitar de la barra' : 'Fijar en la barra'}" aria-label="${favs.includes(h.id) ? 'Quitar de la barra' : 'Fijar en la barra'}"><i class="${favs.includes(h.id) ? 'ph-fill' : 'ph'} ph-star"></i></button></div>`).join('');
            volador.hidden = false;
            const r = boton.getBoundingClientRect();
            const ancho = window.innerWidth >= 900;
            volador.style.maxHeight = `${Math.max(160, (ancho ? window.innerHeight - 24 : r.top - 12))}px`;
            const w = volador.offsetWidth, h = volador.offsetHeight;
            volador.style.left = `${Math.max(8, Math.min(ancho ? r.right + 6 : r.left, window.innerWidth - w - 8))}px`;
            volador.style.top = `${Math.max(8, Math.min(ancho ? r.top : r.top - h - 6, window.innerHeight - h - 8))}px`;
        }
        volador.addEventListener('click', (ev) => {
            const f = ev.target.closest('[data-fav]');
            if (f) {
                const id = f.dataset.fav, cat = catAbierta;
                favs = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id];
                state.savePrefs({ dibujoFavs: favs });
                pintarHerramientas();
                const btnCat = toolsEl.querySelector(`[data-cat="${cat}"]`);
                catAbierta = null; if (btnCat) abrirMenu(cat, btnCat);   // se repinta el menú con la estrella cambiada
                return;
            }
            const b = ev.target.closest('[data-tool]');
            if (b) { cerrarMenu(); elegirHerramienta(b.dataset.tool); }
        });
        document.addEventListener('click', (ev) => { const ruta = ev.composedPath(); if (catAbierta && !ruta.includes(volador) && !ruta.some((n) => n.classList && n.classList.contains('ch-cat'))) cerrarMenu(); });
        window.addEventListener('resize', cerrarMenu);
        function marcarBotones() {
            toolsEl.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === activa));
            const hAct = activa && POR_ID[activa];
            toolsEl.querySelectorAll('[data-cat]').forEach((b) => {
                const dentro = !!(hAct && hAct.cat === b.dataset.cat);
                b.classList.toggle('on', dentro);
                const ic = b.querySelector('i'); const c = CATS.find((x) => x.id === b.dataset.cat);
                if (ic && c) ic.className = `ph ${dentro ? hAct.icono : c.icono}`;
            });
            toolsEl.querySelector('[data-accion="borrar"]').classList.toggle('on', modoBorrar);
        }
        pintarHerramientas();
        const overlay = (id) => chart.getOverlays({ id })[0] || null;

        // ── persistencia: cada cambio guarda (nunca recalcula nada) ──
        function dibujosActuales() {
            return chart.getOverlays({ groupId: GRUPO })
                .filter((o) => NOMBRES.has(o.name) && o.currentStep === -1)
                .map((o) => {
                    const ext = { ...(o.extendData || {}) };
                    delete ext.analisis;   // el análisis se pide de nuevo al servidor, no se guarda
                    const d = { name: o.name, points: o.points.map((p) => ({ timestamp: p.timestamp, value: p.value })), lock: !!o.lock, extendData: ext };
                    // Los ids de sub-paneles cambian en cada carga: se guarda de qué indicador es el panel.
                    if (o.paneId && o.paneId !== 'candle_pane') {
                        const ind = chart.getIndicators({ paneId: o.paneId })[0];
                        if (ind) d.panel = ind.name;
                    }
                    return d;
                });
        }
        let tGuardar = null;
        function guardar() {
            if (restaurando) return;
            clearTimeout(tGuardar);
            tGuardar = setTimeout(() => { state.saveDrawings(getSymbol(), dibujosActuales()); registrarFoto(); }, 60);
        }

        // ── deshacer / rehacer: fotos de los dibujos de este símbolo (hasta 60 pasos) ──
        const foto = () => JSON.stringify(dibujosActuales());
        function actualizarDeshacer() {
            const u = toolsEl.querySelector('[data-accion="deshacer"]'), r = toolsEl.querySelector('[data-accion="rehacer"]');
            if (u) u.disabled = pos <= 0;
            if (r) r.disabled = pos >= pila.length - 1;
        }
        function registrarFoto() {
            if (deshaciendo) return;
            const f = foto();
            if (pila[pos] === f) return;
            pila = pila.slice(0, pos + 1); pila.push(f);
            if (pila.length > 60) pila.shift();
            pos = pila.length - 1;
            actualizarDeshacer();
        }
        function crearDesdeGuardado(d) {
            if (!Array.isArray(d.points)) return;
            const extra = { points: d.points, extendData: d.extendData || undefined, lock: !!d.lock };
            if (d.panel) {
                const ind = chart.getIndicators({ name: d.panel })[0];
                if (ind) extra.paneId = ind.paneId;
            }
            const h = d.extendData && d.extendData.estilo && POR_ID[d.extendData.estilo.herramienta];
            if (h && h.continuo) extra.drawingMode = 'continuous';
            crear(d.name, extra);
        }
        function irAFoto(nueva) {
            if (nueva < 0 || nueva >= pila.length) return;
            cancelarEnCurso(); salirDeHerramienta();
            deshaciendo = true; restaurando = true;
            chart.removeOverlay({ groupId: GRUPO }); deseleccionar();
            JSON.parse(pila[nueva]).forEach(crearDesdeGuardado);
            restaurando = false; deshaciendo = false;
            pos = nueva;
            if (todosOcultos) chart.overrideOverlay({ groupId: GRUPO, visible: false });
            state.saveDrawings(getSymbol(), dibujosActuales());
            actualizarDeshacer();
        }
        const deshacer = () => irAFoto(pos - 1), rehacer = () => irAFoto(pos + 1);

        // Los trazos a mano alzada pueden traer cientos de puntos: se aligeran (se conserva la forma) para no pesar al guardar.
        function aligerar(o) {
            const MAX = 160;
            if (o.points.length <= MAX) return;
            const paso = (o.points.length - 1) / (MAX - 1);
            chart.overrideOverlay({ id: o.id, points: Array.from({ length: MAX }, (_, i) => o.points[Math.round(i * paso)]) });
        }

        function eventos() {
            return {
                onDrawEnd: (e) => {
                    const o = e.overlay;
                    if (o.name === 'nltPosition') completarPosicion(o);
                    if (o.drawingMode === 'continuous') aligerar(o);
                    const seguir = mantener && activa && POR_ID[activa] && !['nltText', 'nltNota', 'nltCallout'].includes(o.name);
                    if (seguir) {
                        // Mantener la herramienta: se puede seguir dibujando lo mismo sin volver a elegirla.
                        const h = POR_ID[activa];
                        guardar();
                        setTimeout(() => { if (activa === h.id) crear(h.overlay, { extendData: { estilo: { herramienta: h.id } }, ...(h.continuo ? { drawingMode: 'continuous' } : {}) }); }, 0);
                        return;
                    }
                    salirDeHerramienta();
                    guardar();
                    seleccionar(o.id);
                    if (o.name === 'nltText') abrirPropiedades(o.id, 'Texto');
                },
                onPressedMoveEnd: (e) => {
                    guardar();
                    const ext = e.overlay.extendData || {};
                    if (ext.zonaNLT && onZonaMovida) onZonaMovida(e.overlay.id);   // cambio semántico: re-analizar
                },
                onRemoved: (e) => {
                    if (seleccionado === e.overlay.id) deseleccionar();
                    if (!restaurando) guardar();
                },
                onClick: (e) => { if (modoBorrar) { chart.removeOverlay({ id: e.overlay.id }); return; } seleccionar(e.overlay.id); },
                onSelected: (e) => {
                    if (modoBorrar) { chart.removeOverlay({ id: e.overlay.id }); return; }
                    seleccionar(e.overlay.id);
                },
                onDeselected: (e) => { if (seleccionado === e.overlay.id && !dialogoAbierto) deseleccionar(); },
            };
        }

        // Tras el clic de entrada: objetivo 2R y stop a ~1,5 rangos medios de vela, 20 velas de ancho.
        function completarPosicion(o) {
            if (o.points.length >= 3) return;
            const { h } = estiloDe(o);
            const datos = chart.getDataList();
            const ult = datos.slice(-14);
            const paso = datos.length > 1 ? datos[datos.length - 1].timestamp - datos[datos.length - 2].timestamp : 60000;
            const e = o.points[0];
            const rango = ult.length ? ult.reduce((a, k) => a + (k.high - k.low), 0) / ult.length : 0;
            const r = rango > 0 ? rango * 1.5 : Math.abs(e.value) * 0.005;
            const s = h.lado === 'long' ? 1 : -1;
            const t2 = e.timestamp + paso * 20;
            chart.overrideOverlay({ id: o.id, points: [{ timestamp: e.timestamp, value: e.value }, { timestamp: t2, value: e.value + s * 2 * r }, { timestamp: t2, value: e.value - s * r }] });
        }

        function crear(name, extra = {}) {
            return chart.createOverlay({ name, groupId: GRUPO, mode: iman, ...extra, ...eventos() });
        }

        function salirDeHerramienta() { activa = null; ayuda(''); marcarBotones(); }
        function cancelarEnCurso() {
            chart.getOverlays({ groupId: GRUPO }).filter((o) => o.currentStep !== -1).forEach((o) => {
                restaurando = true; chart.removeOverlay({ id: o.id }); restaurando = false;
            });
        }

        // ── selección y barra flotante ──
        let dialogoAbierto = false;
        function seleccionar(id) {
            seleccionado = id;
            pintarBarra();
        }
        function deseleccionar() {
            seleccionado = null;
            barraEl.hidden = true;
        }

        function actualizarEstilo(id, parcial) {
            const o = overlay(id);
            if (!o) return;
            const ext = o.extendData || {};
            const estilo = { ...(ext.estilo || {}), ...parcial };
            chart.overrideOverlay({ id, extendData: { ...ext, estilo } });   // solo redibujo
            guardar();
        }

        function pintarBarra() {
            const o = seleccionado && overlay(seleccionado);
            if (!o) { deseleccionar(); return; }
            const { h, v } = estiloDe(o);
            const tieneLinea = h.inputs.some((x) => x.id === 'grosor');
            const esRect = o.name === 'nltRect';
            const esPos = o.name === 'nltPosition';
            const tr = NLTCharts.trading;
            const zona = o.extendData && o.extendData.zonaNLT;
            barraEl.innerHTML = `
                <span class="dw-nombre">${esc(h.label)}</span>
                ${esPos ? (() => { const m = calcularPosicion(h.lado, o.points.map((pt) => pt.value), v, getSymbol()); return m.lotes ? `<span class="dw-lote" title="Lote para arriesgar ${v.riesgo}% de $${v.cuenta} con este stop"><b>${formatearLotes(m.lotes)}</b> ${m.lotes === 1 ? 'lote' : 'lotes'} · riesgo $${m.riesgoReal.toFixed(2)}${m.excede ? ' ⚠' : ''}</span>` : '<span class="dw-lote" title="Poné cuenta y riesgo en la configuración">sin lote</span>'; })() : ''}
                <label class="dw-color" title="Color"><input type="color" data-dw="color" value="${esc(v.color.hex)}"><span style="background:${css({ ...v.color, t: 0 })}"></span></label>
                ${h.inputs.some((x) => x.id === 'relleno') ? `<label class="dw-color" title="Relleno"><input type="color" data-dw="relleno" value="${esc(v.relleno.hex)}"><span style="background:${css({ ...v.relleno, t: Math.min(v.relleno.t, 50) })}"></span></label>` : ''}
                ${tieneLinea ? `<select class="dw-sel" data-dw="grosor" title="Grosor">${[...new Set([1, 2, 3, 4, 6, 8, 12, 16, 24, 32, v.grosor])].sort((a, b) => a - b).map((g) => `<option value="${g}"${g === v.grosor ? ' selected' : ''}>${g}px</option>`).join('')}</select>
                ${h.inputs.some((x) => x.id === 'estiloLinea') ? `<select class="dw-sel" data-dw="estiloLinea" title="Tipo de línea">${ESTILOS_LINEA.map((x) => `<option value="${x.v}"${x.v === v.estiloLinea ? ' selected' : ''}>${x.t}</option>`).join('')}</select>` : ''}` : ''}
                ${h.inputs.some((x) => x.id === 'texto') ? `<button type="button" class="dw-btn" data-dw="texto" title="Editar el texto" aria-label="Editar el texto"><i class="ph ph-text-aa"></i></button>` : ''}
                ${esRect && puedeZonaNLT && puedeZonaNLT() ? `<button type="button" class="dw-btn${zona ? ' on' : ''}" data-dw="zona" title="${zona ? 'Zona conectada al NLT Zone Engine' : 'Enviar esta zona al NLT Zone Engine'}"><i class="ph ph-lightning"></i><span>NLT Engine</span></button>` : ''}
                ${esPos ? `<button type="button" class="dw-btn" data-dw="orden" ${tr && tr.activo() ? '' : 'disabled'} title="${tr && tr.activo() ? 'Operar esta posición con tu cuenta MT5: toca una vez para armar y otra para enviar' : 'Operar con tu cuenta todavía no está disponible'}"><i class="ph ph-paper-plane-tilt"></i><span>${h.lado === 'long' ? 'BUY' : 'SELL'}</span></button>` : ''}
                ${esPos && NLTCharts.app && NLTCharts.app.paper && NLTCharts.app.paper() ? `<button type="button" class="dw-btn" data-dw="sim" title="Practicar esta posición en el Simulador (dinero virtual)"><i class="ph ph-game-controller"></i><span>Simular</span></button>` : ''}
                <button type="button" class="dw-btn" data-dw="config" title="Configuración" aria-label="Configuración"><i class="ph ph-gear-six"></i></button>
                <button type="button" class="dw-btn" data-dw="duplicar" title="Duplicar" aria-label="Duplicar"><i class="ph ph-copy"></i></button>
                <button type="button" class="dw-btn${o.lock ? ' on' : ''}" data-dw="bloquear" title="${o.lock ? 'Desbloquear' : 'Bloquear'}" aria-label="Bloquear"><i class="ph ${o.lock ? 'ph-lock-simple' : 'ph-lock-simple-open'}"></i></button>
                <button type="button" class="dw-btn peligro" data-dw="borrar" title="Borrar" aria-label="Borrar"><i class="ph ph-trash"></i></button>`;
            barraEl.hidden = false;
        }

        barraEl.addEventListener('input', (ev) => {
            const el = ev.target.closest('[data-dw]');
            if (!el || !seleccionado) return;
            const o = overlay(seleccionado);
            if (!o) return;
            const { v } = estiloDe(o);
            if (el.dataset.dw === 'relleno') {
                actualizarEstilo(seleccionado, { relleno: { hex: el.value.toUpperCase(), t: v.relleno.t } });
                const sw = el.parentElement.querySelector('span'); if (sw) sw.style.background = el.value;
            }
            if (el.dataset.dw === 'color') {
                actualizarEstilo(seleccionado, { color: { hex: el.value.toUpperCase(), t: v.color.t } });
                const sw = barraEl.querySelector('.dw-color span'); if (sw) sw.style.background = el.value;
            }
        });
        barraEl.addEventListener('change', (ev) => {
            const el = ev.target.closest('[data-dw]');
            if (!el || !seleccionado) return;
            if (el.dataset.dw === 'grosor') actualizarEstilo(seleccionado, { grosor: parseInt(el.value, 10) });
            if (el.dataset.dw === 'estiloLinea') actualizarEstilo(seleccionado, { estiloLinea: el.value });
        });
        let ordenArmada = null;     // { id, hasta, timer }: el botón BUY/SELL pide un segundo toque antes de mandar dinero real
        function desarmar(btn) {
            if (ordenArmada) { clearTimeout(ordenArmada.timer); ordenArmada = null; }
            if (btn && btn.isConnected) { btn.classList.remove('armado'); btn.innerHTML = btn.dataset.html || btn.innerHTML; }
        }
        barraEl.addEventListener('click', (ev) => {
            const el = ev.target.closest('button[data-dw]');
            if (!el || !seleccionado) return;
            // Esta barra vive fuera de las ventanas (Simulador/Operar): sin esto, el clic "de fuera" las cerraba al instante de abrirlas
            ev.stopPropagation();
            const id = seleccionado;
            const acc = el.dataset.dw;
            if (acc === 'borrar') { chart.removeOverlay({ id }); deseleccionar(); }
            if (acc === 'config') abrirPropiedades(id);
            if (acc === 'texto') abrirPropiedades(id, 'Texto');
            if (acc === 'duplicar') duplicar(id);
            if (acc === 'bloquear') { const o = overlay(id); chart.overrideOverlay({ id, lock: !o.lock }); guardar(); pintarBarra(); }
            if (acc === 'sim' && NLTCharts.app && NLTCharts.app.paper && NLTCharts.app.paper()) NLTCharts.app.paper().desdePosicion(api.posicionComoOrden(id));
            if (acc === 'zona' && onEnviarZona) onEnviarZona(id);
            if (acc === 'orden' && NLTCharts.trading) {
                const pos = api.posicionComoOrden(id);
                if (!pos) return;
                if (!(ordenArmada && ordenArmada.id === id)) {
                    // 1er toque: queda armado 4 s y muestra exactamente qué se va a mandar
                    desarmar(el);
                    el.dataset.html = el.innerHTML; el.classList.add('armado');
                    el.innerHTML = `<i class="ph ph-check-circle"></i><span>${pos.lotes ? `${pos.lado === 'BUY' ? 'Comprar' : 'Vender'} ${formatearLotes(pos.lotes)} · tocar otra vez` : `${pos.lado === 'BUY' ? 'Comprar' : 'Vender'} · tocar otra vez`}</span>`;
                    ordenArmada = { id, timer: setTimeout(() => desarmar(el), 4000) };
                    return;
                }
                desarmar(el);
                NLTCharts.trading.enviar(pos).catch((err) => { if (NLTCharts.ui.toast) NLTCharts.ui.toast(err.message, 'error'); });
            }
        });

        function duplicar(id) {
            const o = overlay(id);
            if (!o) return;
            const datos = chart.getDataList();
            const paso = datos.length > 1 ? datos[datos.length - 1].timestamp - datos[datos.length - 2].timestamp : 60000;
            const ext = JSON.parse(JSON.stringify(o.extendData || {}));
            delete ext.analisis;
            delete ext.zonaNLT;   // la copia es un dibujo común; se conecta al motor si el usuario lo pide
            const nuevo = crear(o.name, { points: o.points.map((p) => ({ timestamp: p.timestamp + paso * 5, value: p.value })), extendData: ext });
            guardar();
            if (nuevo) seleccionar(nuevo);
        }

        // Diálogo de propiedades: Estilo / Texto / Coordenadas, con vista previa.
        function abrirPropiedades(id, tab) {
            const o = overlay(id);
            if (!o) return;
            const { h, v } = estiloDe(o);
            const coords = h.coords.map((titulo, k) => ({ id: `__p${k}`, tipo: 'float', def: o.points[k] ? o.points[k].value : 0, titulo, grupo: '', tab: 'Coordenadas', step: 0.00001 }));
            const inputs = [...h.inputs, ...coords];
            const original = { ext: JSON.parse(JSON.stringify(o.extendData || {})), points: o.points.map((p) => ({ ...p })) };
            const valoresIni = { ...v };
            coords.forEach((c, k) => { valoresIni[c.id] = o.points[k].value; });
            const aplicar = (vals) => {
                const estilo = { herramienta: h.id };
                h.inputs.forEach((inp) => { estilo[inp.id] = vals[inp.id]; });
                const points = o.points.map((p, k) => (vals[`__p${k}`] !== undefined ? { timestamp: p.timestamp, value: vals[`__p${k}`] } : p));
                chart.overrideOverlay({ id, points, extendData: { ...(overlay(id).extendData || {}), estilo } });
            };
            dialogoAbierto = true;
            NLTCharts.settings.abrirDialogo({
                titulo: h.label,
                inputs,
                valores: valoresIni,
                tab,
                alCambiar: (vals) => aplicar(vals),
                alAceptar: (vals) => {
                    dialogoAbierto = false; aplicar(vals); guardar(); pintarBarra();
                    const ext = overlay(id) && overlay(id).extendData;
                    const movida = coords.some((c, k) => vals[c.id] !== original.points[k].value);
                    if (movida && ext && ext.zonaNLT && onZonaMovida) onZonaMovida(id);
                },
                alCancelar: () => { dialogoAbierto = false; chart.overrideOverlay({ id, points: original.points, extendData: original.ext }); pintarBarra(); },
                botones: [{
                    id: 'predeterminado', texto: `Guardar como predeterminado (${h.label})`,
                    accion: (vals) => {
                        const def = {};
                        h.inputs.forEach((inp) => { if (inp.id !== 'texto') def[inp.id] = vals[inp.id]; });
                        NLTCharts.settings.guardar(claveDef(h.id), { ...NLTCharts.settings.valores(claveDef(h.id)), ...def });
                    },
                }],
            });
        }

        function elegirHerramienta(id) {
            cancelarEnCurso();
            modoBorrar = false;
            deseleccionar();
            if (activa === id) { salirDeHerramienta(); return; }
            const h = POR_ID[id];
            if (!h) return;
            activa = h.id;
            if (todosOcultos) { todosOcultos = false; chart.overrideOverlay({ groupId: GRUPO, visible: true }); pintarHerramientas(); }
            crear(h.overlay, { extendData: { estilo: { herramienta: h.id } }, ...(h.continuo ? { drawingMode: 'continuous' } : {}) });
            ayuda(h.ayuda);
            marcarBotones();
        }

        toolsEl.addEventListener('click', (ev) => {
            const b = ev.target.closest('button');
            if (!b) return;
            if (b.dataset.cat) { abrirMenu(b.dataset.cat, b); return; }
            cerrarMenu();
            if (b.dataset.tool) {
                elegirHerramienta(b.dataset.tool);
            } else if (b.dataset.accion === 'borrar') {
                cancelarEnCurso();
                activa = null;
                if (seleccionado && overlay(seleccionado) && !modoBorrar) { chart.removeOverlay({ id: seleccionado }); deseleccionar(); salirDeHerramienta(); return; }
                modoBorrar = !modoBorrar;
                ayuda(modoBorrar ? 'Tocá un dibujo para borrarlo' : '');
                marcarBotones();
            } else if (b.dataset.accion === 'iman') {
                iman = iman === 'normal' ? 'weak_magnet' : iman === 'weak_magnet' ? 'strong_magnet' : 'normal';
                state.savePrefs({ dibujoIman: iman });
                chart.getOverlays({ groupId: GRUPO }).filter((o) => o.currentStep !== -1).forEach((o) => chart.overrideOverlay({ id: o.id, mode: iman }));
                pintarHerramientas(); ayuda(NOMBRE_IMAN[iman]); setTimeout(() => { if (!activa) ayuda(''); }, 1800);
            } else if (b.dataset.accion === 'mantener') {
                mantener = !mantener; state.savePrefs({ dibujoMantener: mantener });
                pintarHerramientas(); ayuda(mantener ? 'La herramienta queda activa después de cada dibujo (Esc para salir)' : ''); setTimeout(() => { if (!activa) ayuda(''); }, 2200);
            } else if (b.dataset.accion === 'ocultar') {
                todosOcultos = !todosOcultos; chart.overrideOverlay({ groupId: GRUPO, visible: !todosOcultos });
                if (todosOcultos) deseleccionar();
                pintarHerramientas();
            } else if (b.dataset.accion === 'deshacer') {
                deshacer();
            } else if (b.dataset.accion === 'rehacer') {
                rehacer();
            } else if (b.dataset.accion === 'limpiar') {
                if (!dibujosActuales().length) return;
                if (!window.confirm('¿Borrar todos los dibujos de ' + getSymbol() + '?')) return;
                restaurando = true;
                chart.removeOverlay({ groupId: GRUPO });
                restaurando = false;
                deseleccionar();
                state.saveDrawings(getSymbol(), []);
                salirDeHerramienta();
                modoBorrar = false;
                marcarBotones();
            }
        });

        document.addEventListener('keydown', (ev) => {
            const enCampo = /INPUT|TEXTAREA|SELECT/.test((ev.target && ev.target.tagName) || '') || dialogoAbierto;
            if (enCampo) return;
            if (ev.key === 'Escape') { cancelarEnCurso(); modoBorrar = false; salirDeHerramienta(); deseleccionar(); }
            if ((ev.key === 'Delete' || ev.key === 'Backspace') && seleccionado) { chart.removeOverlay({ id: seleccionado }); deseleccionar(); }
            if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd' && seleccionado) { ev.preventDefault(); duplicar(seleccionado); }
            if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !ev.shiftKey) { ev.preventDefault(); deshacer(); }
            if ((ev.ctrlKey || ev.metaKey) && (ev.key.toLowerCase() === 'y' || (ev.key.toLowerCase() === 'z' && ev.shiftKey))) { ev.preventDefault(); rehacer(); }
            if (ev.altKey && !ev.ctrlKey && !ev.metaKey && ATAJOS[ev.key.toLowerCase()]) { ev.preventDefault(); elegirHerramienta(ATAJOS[ev.key.toLowerCase()]); }
        });

        const api = {
            seleccionado: () => seleccionado,
            // Posición dibujada -> orden (BUY/SELL, entrada, SL, TP, cantidad). La usa NLTCharts.trading.
            posicionComoOrden(id) {
                const o = overlay(id);
                if (!o || o.name !== 'nltPosition' || o.points.length < 3) return null;
                const { h, v } = estiloDe(o);
                const m = calcularPosicion(h.lado, o.points.map((pt) => pt.value), v, getSymbol());
                return { simbolo: getSymbol(), lado: h.lado === 'long' ? 'BUY' : 'SELL', entrada: m.entrada, sl: m.sl, tp: m.tp, cantidad: m.cantidad, lotes: m.lotes, riesgo: m.riesgoReal, rr: m.rr };
            },
            abrirPropiedades,
            overlay,
            // Rectángulo seleccionado (o el último) como zona: precios y desde cuándo.
            rectanguloComoZona(id) {
                const rects = chart.getOverlays({ groupId: GRUPO }).filter((o) => o.name === 'nltRect' && o.currentStep === -1);
                const r = (id && rects.find((o) => o.id === id)) || rects.find((o) => o.id === seleccionado) || rects[rects.length - 1];
                if (!r || r.points.length < 2) return null;
                const [a, b] = r.points;
                return { id: r.id, top: Math.max(a.value, b.value), bottom: Math.min(a.value, b.value), desde: Math.min(a.timestamp, b.timestamp), zonaNLT: (r.extendData || {}).zonaNLT || null };
            },
            // Marca/actualiza un rectángulo como zona del NLT Zone Engine (conexión + resultado).
            marcarZona(id, zonaNLT, analisis) {
                const o = overlay(id);
                if (!o) return;
                const ext = { ...(o.extendData || {}) };
                if (zonaNLT === null) { delete ext.zonaNLT; delete ext.analisis; } else {
                    if (zonaNLT) ext.zonaNLT = zonaNLT;
                    if (analisis !== undefined) ext.analisis = analisis;
                }
                chart.overrideOverlay({ id, extendData: ext });
                if (zonaNLT !== undefined) guardar();
                if (seleccionado === id) pintarBarra();
            },
            // Mueve los precios de un rectángulo (ej. la zona se editó en la configuración).
            fijarPrecios(id, top, bottom) {
                const o = overlay(id);
                if (!o || o.points.length < 2) return;
                const [a, b] = o.points;
                const aArriba = a.value >= b.value;
                chart.overrideOverlay({ id, points: [{ ...a, value: aArriba ? top : bottom }, { ...b, value: aArriba ? bottom : top }] });
                guardar();
            },
            zonasConectadas() {
                return chart.getOverlays({ groupId: GRUPO }).filter((o) => o.name === 'nltRect' && o.extendData && o.extendData.zonaNLT);
            },
            // Después de cargar un símbolo: saca los dibujos en pantalla y pone los guardados.
            restaurar() {
                restaurando = true;
                chart.removeOverlay({ groupId: GRUPO });
                deseleccionar();
                state.drawings(getSymbol()).map(migrar).filter(Boolean).forEach(crearDesdeGuardado);
                if (todosOcultos) chart.overrideOverlay({ groupId: GRUPO, visible: false });
                restaurando = false;
                pila = [foto()]; pos = 0; actualizarDeshacer();
                salirDeHerramienta();
                modoBorrar = false;
                marcarBotones();
            },
        };
        return api;
    }

    let precision = 5;
    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.drawings = {
        montar, HERRAMIENTAS, migrar, calcularPosicion, contratoDe, convUSD,
        setPrecision(p) { precision = p; },
        formatear(x) { return Number(x).toFixed(precision); },
    };
})();
