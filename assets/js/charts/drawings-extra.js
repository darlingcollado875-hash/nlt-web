/* NLT Charts -- herramientas de dibujo adicionales (canales, Fibonacci/Gann, patrones, medición, formas, notas).
 *
 * drawings.js las incorpora a su lista (HERRAMIENTAS) y les da el mismo trato que a las demás: estilos
 * por herramienta ("Guardar como predeterminado"), barra flotante, diálogo de propiedades, bloquear,
 * duplicar, guardado por símbolo y sincronización con la cuenta. Todo es visual (solo se redibuja): ningún
 * dibujo recalcula indicadores. Este archivo solo define QUÉ herramientas hay y CÓMO se dibujan.
 *
 *   definir(H)   -> lista de herramientas (misma forma que las de drawings.js, más `cat` = categoría)
 *   registrar(H) -> registra los overlays de KLineChart
 * H trae los ayudantes de drawings.js (col, linea, estiloDe, css, lineaEstilo, extender, etiqueta...). */
(function () {
    const CATEGORIAS = [
        { id: 'lineas', icono: 'ph-line-segment', label: 'Más líneas y canales' },
        { id: 'fib', icono: 'ph-chart-bar-horizontal', label: 'Fibonacci y Gann' },
        { id: 'patrones', icono: 'ph-wave-triangle', label: 'Patrones' },
        { id: 'medicion', icono: 'ph-ruler', label: 'Medición y pronóstico' },
        { id: 'formas', icono: 'ph-shapes', label: 'Formas' },
        { id: 'notas', icono: 'ph-note', label: 'Notas e íconos' },
    ];
    const NIVELES_EXT = [0, 0.618, 1, 1.272, 1.618, 2, 2.618];
    const NIVELES_EXT_ON = [0, 0.618, 1, 1.618];
    const FIB_TIEMPO = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
    const GANN = [[1, 8], [1, 4], [1, 3], [1, 2], [1, 1], [2, 1], [3, 1], [4, 1], [8, 1]];
    const CUADRO = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1];
    const EMOJIS = ['😀', '😎', '🔥', '🚀', '💰', '💎', '🐂', '🐻', '⚠️', '✅', '❌', '⭐', '🎯', '👀', '📈', '📉'];
    const FUENTE_EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

    // Patrones por puntos: etiquetas de cada punto, rellenos (triángulos), líneas punteadas y proporciones
    // [a0,a1,b0,b1] = |tramo a0→a1| / |tramo b0→b1|, escritas sobre la línea punteada `en`.
    const PATRONES = {
        xabcd: { n: 5, label: 'Patrón XABCD', icono: 'ph-wave-triangle', et: ['X', 'A', 'B', 'C', 'D'], relleno: [[0, 1, 2], [2, 3, 4]], punteadas: [[0, 2], [2, 4], [1, 3], [0, 4]],
            ratios: [{ r: [1, 2, 0, 1], en: [0, 2] }, { r: [2, 3, 1, 2], en: [1, 3] }, { r: [3, 4, 2, 3], en: [2, 4] }, { r: [1, 4, 0, 1], en: [0, 4] }] },
        cypher: { n: 5, label: 'Patrón Cypher', icono: 'ph-wave-sine', et: ['X', 'A', 'B', 'C', 'D'], relleno: [[0, 1, 2], [2, 3, 4]], punteadas: [[0, 2], [2, 4], [1, 3], [0, 4]],
            ratios: [{ r: [1, 2, 0, 1], en: [0, 2] }, { r: [2, 3, 0, 1], en: [1, 3] }, { r: [3, 4, 2, 3], en: [2, 4] }] },
        abcd: { n: 4, label: 'Patrón ABCD', icono: 'ph-path', et: ['A', 'B', 'C', 'D'], relleno: [], punteadas: [[0, 2], [1, 3]],
            ratios: [{ r: [1, 2, 0, 1], en: [0, 2] }, { r: [2, 3, 1, 2], en: [1, 3] }] },
        triangulo: { n: 4, label: 'Patrón triángulo', icono: 'ph-triangle', et: ['A', 'B', 'C', 'D'], relleno: [], punteadas: [], prolongar: [[0, 2], [1, 3]], ratios: [] },
        tresimpulsos: { n: 7, label: 'Tres impulsos', icono: 'ph-wave-sine', et: ['0', '1', '2', '3', '4', '5', '6'], relleno: [], punteadas: [], ratios: [] },
        hombros: { n: 7, label: 'Cabeza y hombros', icono: 'ph-mountains', et: ['', 'Hombro', '', 'Cabeza', '', 'Hombro', ''], relleno: [[1, 2, 3], [3, 4, 5]], punteadas: [], prolongar: [[2, 4]], ratios: [] },
        elliott: { n: 6, label: 'Onda de Elliott (impulso)', icono: 'ph-chart-line-up', et: ['0', '1', '2', '3', '4', '5'], relleno: [], punteadas: [], ratios: [] },
        elliottc: { n: 4, label: 'Onda de Elliott (corrección)', icono: 'ph-chart-line', et: ['0', 'A', 'B', 'C'], relleno: [], punteadas: [], ratios: [] },
    };

    function definir(H) {
        const { col, linea, textoIn, ESTILOS_LINEA } = H;
        const relleno = (hex, t = 88, titulo = 'Relleno') => ({ id: 'relleno', tipo: 'color', def: col(hex, t), titulo, grupo: 'Fondo', tab: 'Estilo', recalc: false });
        const bool = (id, def, titulo, grupo = 'Opciones', inline) => ({ id, tipo: 'bool', def, titulo, grupo, tab: 'Estilo', ...(inline ? { inline } : {}), recalc: false });
        const cuadro = (id, def, titulo, grupo, extra = {}) => ({ id, tipo: 'bool', def, titulo, grupo, tab: 'Estilo', recalc: false, ...extra });
        const ext = (izq, der) => [bool('extIzq', izq, 'Extender a la izquierda', 'Extensión', 'e'), bool('extDer', der, 'Extender a la derecha', 'Extensión', 'e')];
        const info = (def = true) => [bool('mostrarInfo', def, 'Mostrar medidas', 'Etiquetas', 'i')];
        const T = (def = '#4378ff', t = 0, g = 2) => linea({ color: col(def, t), grosor: g });
        const nivelesFib = (lista, on, grupo = 'Niveles') => lista.map((n, k) => cuadro(`n${k}`, on.includes(n), String(n), grupo, { inline: `n${Math.floor(k / 3)}` }));

        const herramientas = [
            // ── Más líneas y canales ──
            { id: 'extline', cat: 'lineas', overlay: 'nltTrend', pasos: 3, icono: 'ph-arrows-horizontal', label: 'Línea extendida', ayuda: 'Tocá dos puntos: la línea se extiende hacia los dos lados',
                inputs: [...T(), ...ext(true, true), ...textoIn()], coords: ['Precio 1', 'Precio 2'] },
            { id: 'hray', cat: 'lineas', overlay: 'nltHRay', pasos: 2, icono: 'ph-arrow-line-right', label: 'Rayo horizontal', ayuda: 'Tocá el precio: la línea sale hacia la derecha',
                inputs: [...T('#4378ff', 0, 1), bool('mostrarPrecio', true, 'Mostrar precio', 'Etiqueta'), ...textoIn()], coords: ['Precio'] },
            { id: 'vline', cat: 'lineas', overlay: 'nltVLine', pasos: 2, icono: 'ph-arrows-vertical', label: 'Línea vertical', ayuda: 'Tocá la vela donde va la línea',
                inputs: [...T('#4378ff', 0, 1), ...textoIn()], coords: ['Precio'] },
            { id: 'cross', cat: 'lineas', overlay: 'nltCross', pasos: 2, icono: 'ph-crosshair-simple', label: 'Línea cruzada', ayuda: 'Tocá el punto de cruce',
                inputs: [...T('#4378ff', 0, 1), ...textoIn()], coords: ['Precio'] },
            { id: 'infoline', cat: 'lineas', overlay: 'nltInfo', pasos: 3, icono: 'ph-line-segment', label: 'Línea con medidas', ayuda: 'Tocá dos puntos: mide precio, % y velas',
                inputs: [...T(), ...ext(false, false), ...info(), ...textoIn()], coords: ['Precio 1', 'Precio 2'] },
            { id: 'channel', cat: 'lineas', overlay: 'nltChannel', pasos: 4, icono: 'ph-equals', label: 'Canal paralelo', ayuda: 'Tocá dos puntos de la línea y después el ancho del canal',
                inputs: [...T(), relleno('#4378ff', 92), bool('mediana', true, 'Línea media', 'Canal'), ...ext(false, false)], coords: ['Precio 1', 'Precio 2', 'Precio 3 (ancho)'] },
            { id: 'fork', cat: 'lineas', overlay: 'nltFork', pasos: 4, icono: 'ph-git-fork', label: 'Horquilla de Andrews', ayuda: 'Tocá el punto 1 y después los dos extremos (2 y 3)',
                inputs: [...T('#A78BFA'), relleno('#A78BFA', 92), bool('mediana', true, 'Línea media', 'Horquilla')], coords: ['Punto 1', 'Punto 2', 'Punto 3'] },

            // ── Fibonacci y Gann ──
            { id: 'fibext', cat: 'fib', overlay: 'nltFibExt', pasos: 4, icono: 'ph-arrows-out-line-horizontal', label: 'Extensión de Fibonacci', ayuda: 'Tocá A, B y C: proyecta los objetivos desde C',
                inputs: [...linea({ color: col('#F59E0B', 0) }), ...nivelesFib(NIVELES_EXT, NIVELES_EXT_ON), bool('mostrarPrecios', true, 'Mostrar precios', 'Etiquetas', 'et'), bool('extDer', false, 'Extender a la derecha', 'Etiquetas', 'et')],
                coords: ['Precio A', 'Precio B', 'Precio C'] },
            { id: 'fibtime', cat: 'fib', overlay: 'nltFibTime', pasos: 3, icono: 'ph-clock', label: 'Zonas de tiempo de Fibonacci', ayuda: 'Tocá dos velas: la distancia es la unidad',
                inputs: [...linea({ color: col('#9CA3AF', 0), grosor: 1 }), bool('mostrarNumeros', true, 'Mostrar números', 'Etiquetas')], coords: ['Precio 1', 'Precio 2'] },
            { id: 'gannfan', cat: 'fib', overlay: 'nltGannFan', pasos: 3, icono: 'ph-arrows-out-cardinal', label: 'Abanico de Gann', ayuda: 'Tocá el origen y un punto que defina la línea 1×1',
                inputs: [...linea({ color: col('#EAB308', 0), grosor: 1 }), bool('mostrarNombres', true, 'Mostrar nombres', 'Etiquetas')], coords: ['Origen', 'Punto 1×1'] },
            { id: 'gannbox', cat: 'fib', overlay: 'nltGannBox', pasos: 3, icono: 'ph-grid-four', label: 'Caja de Gann', ayuda: 'Tocá una esquina y la opuesta',
                inputs: [...linea({ color: col('#EAB308', 0), grosor: 1 }), relleno('#EAB308', 94), bool('diagonales', true, 'Diagonales', 'Caja')], coords: ['Precio superior', 'Precio inferior'] },
        ];

        Object.entries(PATRONES).forEach(([id, p]) => {
            herramientas.push({ id: `pat_${id}`, cat: 'patrones', overlay: `nltPatron${p.n}`, pasos: p.n + 1, icono: p.icono, label: p.label, patron: id,
                ayuda: `Tocá los ${p.n} puntos del patrón en orden`,
                inputs: [...T('#4378ff'), relleno('#4378ff', 90), bool('mostrarEtiquetas', true, 'Mostrar etiquetas', 'Etiquetas', 'p'), ...(p.ratios.length ? [bool('mostrarRatios', true, 'Mostrar proporciones', 'Etiquetas', 'p')] : [])],
                coords: p.et.map((e, k) => `Punto ${k + 1}${e ? ` (${e})` : ''}`) });
        });

        herramientas.push(
            // ── Medición y pronóstico ──
            { id: 'daterange', cat: 'medicion', overlay: 'nltRangoFecha', pasos: 3, icono: 'ph-arrows-horizontal', label: 'Rango de fechas', ayuda: 'Tocá la vela inicial y la final',
                inputs: [...T('#60A5FA', 0, 1), relleno('#60A5FA', 92)], coords: ['Precio 1', 'Precio 2'] },
            { id: 'pricerange', cat: 'medicion', overlay: 'nltRangoPrecio', pasos: 3, icono: 'ph-arrows-vertical', label: 'Rango de precios', ayuda: 'Tocá el precio inicial y el final',
                inputs: [...T('#60A5FA', 0, 1), relleno('#60A5FA', 92)], coords: ['Precio 1', 'Precio 2'] },
            { id: 'dprange', cat: 'medicion', overlay: 'nltRangoFP', pasos: 3, icono: 'ph-bounding-box', label: 'Rango de fecha y precio', ayuda: 'Tocá una esquina y la opuesta',
                inputs: [...T('#60A5FA', 0, 1), relleno('#22C55E', 88, 'Relleno (sube)'), { id: 'rellenoBaja', tipo: 'color', def: col('#EF4444', 88), titulo: 'Relleno (baja)', grupo: 'Fondo', tab: 'Estilo', recalc: false }], coords: ['Precio 1', 'Precio 2'] },
            { id: 'ruler', cat: 'medicion', overlay: 'nltRegla', pasos: 3, icono: 'ph-ruler', label: 'Regla', ayuda: 'Tocá dos puntos: mide precio, % , velas y tiempo',
                inputs: [...T('#E5E7EB', 0, 1), relleno('#E5E7EB', 94)], coords: ['Precio 1', 'Precio 2'] },
            { id: 'vpfr', cat: 'medicion', overlay: 'nltVPFR', pasos: 3, icono: 'ph-chart-bar-horizontal', label: 'Perfil de volumen de rango fijo', ayuda: 'Tocá el inicio y el fin del rango: se calcula el volumen por precio',
                inputs: [{ id: 'filas', tipo: 'int', def: 24, titulo: 'Filas', grupo: 'Perfil', tab: 'Entradas', min: 8, max: 120, recalc: false },
                    { id: 'vaPct', tipo: 'int', def: 70, titulo: 'Área de valor (%)', grupo: 'Perfil', tab: 'Entradas', min: 10, max: 100, recalc: false },
                    { id: 'ancho', tipo: 'int', def: 70, titulo: 'Ancho (% del rango)', grupo: 'Perfil', tab: 'Entradas', min: 10, max: 100, recalc: false },
                    { id: 'lado', tipo: 'string', def: 'left', titulo: 'Posición', grupo: 'Perfil', tab: 'Entradas', opciones: [{ v: 'left', t: 'Izquierda' }, { v: 'right', t: 'Derecha' }], recalc: false },
                    bool('dividir', true, 'Separar volumen alcista y bajista', 'Perfil'),
                    { id: 'color', tipo: 'color', def: col('#F59E0B', 0), titulo: 'POC', grupo: 'Colores', tab: 'Estilo', inline: 'c', recalc: false },
                    { id: 'colorUp', tipo: 'color', def: col('#3B82F6', 45), titulo: 'Sube', grupo: 'Colores', tab: 'Estilo', inline: 'c', recalc: false },
                    { id: 'colorDn', tipo: 'color', def: col('#F59E0B', 45), titulo: 'Baja', grupo: 'Colores', tab: 'Estilo', inline: 'c', recalc: false },
                    { id: 'colorVA', tipo: 'color', def: col('#3B82F6', 88), titulo: 'Área de valor', grupo: 'Colores', tab: 'Estilo', recalc: false },
                    bool('mostrarPOC', true, 'Línea del POC', 'Mostrar', 'm'), bool('mostrarVA', true, 'Área de valor (VAH/VAL)', 'Mostrar', 'm'), bool('mostrarEtiquetas', true, 'Etiquetas de precio', 'Mostrar', 'm')],
                coords: ['Inicio del rango', 'Fin del rango'] },
            { id: 'forecast', cat: 'medicion', overlay: 'nltPronostico', pasos: 3, icono: 'ph-arrow-bend-up-right', label: 'Pronóstico', ayuda: 'Tocá el punto de partida y el objetivo',
                inputs: [...T('#A78BFA', 0, 2), relleno('#A78BFA', 85)], coords: ['Partida', 'Objetivo'] },

            // ── Formas ──
            { id: 'ellipse', cat: 'formas', overlay: 'nltElipse', pasos: 3, icono: 'ph-circle-dashed', label: 'Elipse', ayuda: 'Tocá dos esquinas del rectángulo que la contiene',
                inputs: [...T('#4378ff', 0, 1), relleno('#4378ff', 90), ...textoIn()], coords: ['Precio 1', 'Precio 2'] },
            { id: 'circle', cat: 'formas', overlay: 'nltCirculo', pasos: 3, icono: 'ph-circle', label: 'Círculo', ayuda: 'Tocá el centro y un punto del borde',
                inputs: [...T('#4378ff', 0, 1), relleno('#4378ff', 90), ...textoIn()], coords: ['Centro', 'Borde'] },
            { id: 'triangle', cat: 'formas', overlay: 'nltTriangulo', pasos: 4, icono: 'ph-triangle', label: 'Triángulo', ayuda: 'Tocá los 3 vértices',
                inputs: [...T('#4378ff', 0, 1), relleno('#4378ff', 90), ...textoIn()], coords: ['Vértice 1', 'Vértice 2', 'Vértice 3'] },

            { id: 'brush', cat: 'formas', overlay: 'nltBrush', pasos: 2, continuo: true, icono: 'ph-paint-brush', label: 'Pincel', ayuda: 'Mantené apretado y dibujá a mano alzada',
                inputs: [{ id: 'color', tipo: 'color', def: col('#4378ff', 0), titulo: 'Color', grupo: 'Trazo', tab: 'Estilo', inline: 'l', recalc: false },
                    { id: 'grosor', tipo: 'int', def: 3, titulo: 'Grosor', grupo: 'Trazo', tab: 'Estilo', inline: 'l', min: 1, max: 40, recalc: false }], coords: [] },
            { id: 'highlighter', cat: 'formas', overlay: 'nltBrush', pasos: 2, continuo: true, icono: 'ph-highlighter', label: 'Resaltador', ayuda: 'Mantené apretado y pasá sobre lo que querés resaltar',
                inputs: [{ id: 'color', tipo: 'color', def: col('#FACC15', 62), titulo: 'Color', grupo: 'Trazo', tab: 'Estilo', inline: 'l', recalc: false },
                    { id: 'grosor', tipo: 'int', def: 14, titulo: 'Grosor', grupo: 'Trazo', tab: 'Estilo', inline: 'l', min: 2, max: 40, recalc: false }], coords: [] },

            // ── Notas e íconos ──
            { id: 'note', cat: 'notas', overlay: 'nltNota', pasos: 2, icono: 'ph-note', label: 'Nota', ayuda: 'Tocá donde va la nota',
                inputs: [{ id: 'color', tipo: 'color', def: col('#FDE68A', 0), titulo: 'Color', grupo: 'Nota', tab: 'Estilo', recalc: false },
                    { id: 'tamano', tipo: 'int', def: 12, titulo: 'Tamaño', grupo: 'Nota', tab: 'Estilo', min: 8, max: 40, recalc: false },
                    { id: 'texto', tipo: 'texto', def: 'Nota', titulo: 'Texto', grupo: '', tab: 'Texto', max: 200, multilinea: true, recalc: false }], coords: ['Precio'] },
            { id: 'callout', cat: 'notas', overlay: 'nltCallout', pasos: 3, icono: 'ph-chat-text', label: 'Globo de texto', ayuda: 'Tocá lo que señalás y después donde va el globo',
                inputs: [...T('#4378ff', 0, 1), { id: 'tamano', tipo: 'int', def: 12, titulo: 'Tamaño', grupo: 'Texto', tab: 'Estilo', min: 8, max: 40, recalc: false },
                    { id: 'texto', tipo: 'texto', def: 'Texto', titulo: 'Texto', grupo: '', tab: 'Texto', max: 200, multilinea: true, recalc: false }], coords: ['Señala', 'Globo'] },
            { id: 'pricelabel', cat: 'notas', overlay: 'nltEtiquetaPrecio', pasos: 2, icono: 'ph-tag', label: 'Etiqueta de precio', ayuda: 'Tocá el precio que querés etiquetar',
                inputs: [...T('#4378ff', 0, 1)], coords: ['Precio'] },
            { id: 'arrowup', cat: 'notas', overlay: 'nltFlecha', pasos: 2, icono: 'ph-arrow-fat-up', label: 'Flecha arriba', dir: 'up', ayuda: 'Tocá donde apunta la flecha',
                inputs: [{ id: 'color', tipo: 'color', def: col('#22C55E', 0), titulo: 'Color', grupo: 'Flecha', tab: 'Estilo', inline: 'f', recalc: false },
                    { id: 'tamano', tipo: 'int', def: 26, titulo: 'Tamaño', grupo: 'Flecha', tab: 'Estilo', inline: 'f', min: 12, max: 80, recalc: false }, ...textoIn()], coords: ['Precio'] },
            { id: 'arrowdown', cat: 'notas', overlay: 'nltFlecha', pasos: 2, icono: 'ph-arrow-fat-down', label: 'Flecha abajo', dir: 'down', ayuda: 'Tocá donde apunta la flecha',
                inputs: [{ id: 'color', tipo: 'color', def: col('#EF4444', 0), titulo: 'Color', grupo: 'Flecha', tab: 'Estilo', inline: 'f', recalc: false },
                    { id: 'tamano', tipo: 'int', def: 26, titulo: 'Tamaño', grupo: 'Flecha', tab: 'Estilo', inline: 'f', min: 12, max: 80, recalc: false }, ...textoIn()], coords: ['Precio'] },
            { id: 'flag', cat: 'notas', overlay: 'nltIcono', pasos: 2, icono: 'ph-flag', label: 'Bandera', ayuda: 'Tocá donde va la bandera', iconoDef: '🚩', tamDef: 26,
                inputs: [{ id: 'color', tipo: 'color', def: col('#EF4444', 0), titulo: 'Color', grupo: 'Ícono', tab: 'Estilo', recalc: false },
                    { id: 'tamano', tipo: 'int', def: 26, titulo: 'Tamaño', grupo: 'Ícono', tab: 'Estilo', min: 12, max: 90, recalc: false },
                    { id: 'icono', tipo: 'string', def: '🚩', titulo: 'Ícono', grupo: 'Ícono', tab: 'Estilo', opciones: ['🚩', '🏁', '📍', '📌', ...EMOJIS].map((e) => ({ v: e, t: e })), recalc: false }], coords: ['Precio'] },
            { id: 'emoji', cat: 'notas', overlay: 'nltIcono', pasos: 2, icono: 'ph-smiley', label: 'Emoji', ayuda: 'Tocá donde va el emoji (se cambia en la configuración)',
                inputs: [{ id: 'color', tipo: 'color', def: col('#FACC15', 0), titulo: 'Color', grupo: 'Emoji', tab: 'Estilo', recalc: false },
                    { id: 'tamano', tipo: 'int', def: 28, titulo: 'Tamaño', grupo: 'Emoji', tab: 'Estilo', min: 12, max: 90, recalc: false },
                    { id: 'icono', tipo: 'string', def: '🔥', titulo: 'Emoji', grupo: 'Emoji', tab: 'Estilo', opciones: EMOJIS.map((e) => ({ v: e, t: e })), recalc: false }], coords: ['Precio'] },
        );
        void ESTILOS_LINEA; void cuadro;
        return herramientas;
    }

    // ───────────────────────────── dibujo ─────────────────────────────
    function registrar(H) {
        const { estiloDe, css, lineaEstilo, extender, etiqueta, FUENTE, guiones } = H;
        const pr = (x) => NLTCharts.drawings.formatear(x);
        const MS = { second: 1000, minute: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 };
        const sig = (n) => (n >= 0 ? '+' : '−');

        function barras(chart, a, b) {
            if (Number.isFinite(a.dataIndex) && Number.isFinite(b.dataIndex)) return Math.round(b.dataIndex - a.dataIndex);
            const p = chart.getPeriod && chart.getPeriod();
            const ms = p ? (MS[p.type] || 60000) * (p.span || 1) : 60000;
            return Math.round((b.timestamp - a.timestamp) / ms);
        }
        function duracion(ms) {
            ms = Math.abs(ms);
            const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
            return [d ? `${d}d` : '', h ? `${h}h` : '', !d && m ? `${m}m` : ''].filter(Boolean).join(' ') || '0m';
        }
        function medidas(chart, p1, p2) {
            const dp = p2.value - p1.value, pct = p1.value ? (dp / p1.value) * 100 : 0, nb = barras(chart, p1, p2);
            return { dp, pct, nb, tiempo: duracion(p2.timestamp - p1.timestamp), texto: `${sig(dp)}${pr(Math.abs(dp))} (${sig(pct)}${Math.abs(pct).toFixed(2)}%) · ${Math.abs(nb)} velas · ${duracion(p2.timestamp - p1.timestamp)}` };
        }
        const caja = (x, y, texto, fondo, base = 'middle', align = 'center', color = '#fff') => ({
            type: 'text', ignoreEvent: true, attrs: { x, y, text: texto, align, baseline: base },
            styles: { color, backgroundColor: fondo, size: 11, family: FUENTE, weight: 500, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, borderRadius: 3, borderSize: 0 },
        });
        const rect4 = (x1, y1, x2, y2) => [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
        const poli = (coordinates, color) => ({ type: 'polygon', ignoreEvent: true, attrs: { coordinates }, styles: { style: 'fill', color } });
        const seg = (a, b, estilo) => ({ type: 'line', attrs: { coordinates: [a, b] }, styles: estilo });
        const punteada = (v) => ({ ...lineaEstilo(v), style: 'dashed', dashedValue: [4, 4], size: 1 });
        const sinEvento = (f) => ({ ...f, ignoreEvent: true });
        function flecha(a, b, estilo, tam = 8) {
            const ang = Math.atan2(b.y - a.y, b.x - a.x);
            const p = (da) => ({ x: b.x - tam * Math.cos(ang + da), y: b.y - tam * Math.sin(ang + da) });
            return [seg(a, b, estilo), seg(p(0.45), b, estilo), seg(p(-0.45), b, estilo)];
        }
        // Rayo desde `p` en la dirección `d` hasta el borde del panel.
        function rayo(p, d, ancho) {
            if (!d.x) return [p, { x: p.x, y: p.y + (d.y || 1) * 5000 }];
            const fin = d.x > 0 ? ancho : 0;
            return [p, { x: fin, y: p.y + d.y * ((fin - p.x) / d.x) }];
        }
        // Precio -> y, interpolando entre dos puntos con precio distinto (el eje de precios es lineal).
        function yDePrecio(cs, ps) {
            for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
                if (ps[i].value !== ps[j].value) {
                    const k = (cs[j].y - cs[i].y) / (ps[j].value - ps[i].value);
                    return (precio) => cs[i].y + (precio - ps[i].value) * k;
                }
            }
            return () => (cs[0] ? cs[0].y : 0);
        }
        const reg = (def) => klinecharts.registerOverlay({ needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true, ...def });

        // ── líneas ──
        reg({ name: 'nltHRay', totalStep: 2, needDefaultXAxisFigure: false,
            createPointFigures: ({ overlay, coordinates, bounding }) => {
                if (!coordinates.length) return [];
                const { v } = estiloDe(overlay); const c = coordinates[0];
                const f = [seg(c, { x: bounding.width, y: c.y }, lineaEstilo(v))];
                if (v.texto) f.push(etiqueta(c.x + 4, c.y - 3, v.texto, v));
                return f;
            },
            createYAxisFigures: ({ overlay, coordinates }) => {
                const { v } = estiloDe(overlay);
                if (!v.mostrarPrecio || !coordinates.length) return [];
                return [{ type: 'text', attrs: { x: 0, y: coordinates[0].y, text: pr(overlay.points[0].value), align: 'left', baseline: 'middle' }, styles: { color: '#0B0E14', backgroundColor: css({ ...v.color, t: 0 }), size: 11, family: FUENTE, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2, borderRadius: 2 } }];
            } });
        reg({ name: 'nltVLine', totalStep: 2, needDefaultYAxisFigure: false,
            createPointFigures: ({ overlay, coordinates, bounding }) => {
                if (!coordinates.length) return [];
                const { v } = estiloDe(overlay); const x = coordinates[0].x;
                const f = [seg({ x, y: 0 }, { x, y: bounding.height }, lineaEstilo(v))];
                if (v.texto) f.push(etiqueta(x + 3, 14, v.texto, v));
                return f;
            } });
        reg({ name: 'nltCross', totalStep: 2,
            createPointFigures: ({ overlay, coordinates, bounding }) => {
                if (!coordinates.length) return [];
                const { v } = estiloDe(overlay); const { x, y } = coordinates[0];
                const f = [seg({ x: 0, y }, { x: bounding.width, y }, lineaEstilo(v)), seg({ x, y: 0 }, { x, y: bounding.height }, lineaEstilo(v))];
                if (v.texto) f.push(etiqueta(x + 4, y - 3, v.texto, v));
                return f;
            } });
        reg({ name: 'nltInfo', totalStep: 3,
            createPointFigures: ({ chart, overlay, coordinates, bounding }) => {
                if (coordinates.length < 2) return [];
                const { v } = estiloDe(overlay);
                const [p1, p2] = extender(coordinates[0], coordinates[1], v.extIzq, v.extDer, bounding.width);
                const f = [seg(p1, p2, lineaEstilo(v))];
                if (overlay.points.length >= 2 && v.mostrarInfo) {
                    const m = medidas(chart, overlay.points[0], overlay.points[1]);
                    f.push(caja(coordinates[1].x, coordinates[1].y + (m.dp >= 0 ? -14 : 14), m.texto, 'rgba(17,24,39,.9)'));
                }
                if (v.texto) f.push(etiqueta((coordinates[0].x + coordinates[1].x) / 2, (coordinates[0].y + coordinates[1].y) / 2 - 4, v.texto, v, 'center'));
                return f;
            } });
        reg({ name: 'nltChannel', totalStep: 4,
            createPointFigures: ({ overlay, coordinates, bounding }) => {
                if (coordinates.length < 2) return [];
                const { v } = estiloDe(overlay);
                const [a, b] = coordinates;
                const [l1, l2] = extender(a, b, v.extIzq, v.extDer, bounding.width);
                const f = [];
                if (coordinates.length >= 3) {
                    const dx = b.x - a.x, dy = b.y - a.y, c = coordinates[2];
                    const [m1, m2] = extender(c, { x: c.x + dx, y: c.y + dy }, v.extIzq, v.extDer, bounding.width);
                    // La paralela pasa por el 3.er punto; con las extensiones ambas líneas terminan en el mismo x.
                    const x1 = v.extIzq ? l1.x : Math.min(a.x, b.x), x2 = v.extDer ? l2.x : Math.max(a.x, b.x);
                    const yEn = (p, q, x) => (q.x === p.x ? p.y : p.y + (q.y - p.y) * ((x - p.x) / (q.x - p.x)));
                    const sup = [{ x: x1, y: yEn(a, b, x1) }, { x: x2, y: yEn(a, b, x2) }], inf = [{ x: x1, y: yEn(c, { x: c.x + dx, y: c.y + dy }, x1) }, { x: x2, y: yEn(c, { x: c.x + dx, y: c.y + dy }, x2) }];
                    f.push(poli([sup[0], sup[1], inf[1], inf[0]], css(v.relleno)));
                    f.push(seg(inf[0], inf[1], lineaEstilo(v)));
                    if (v.mediana) f.push(sinEvento(seg({ x: x1, y: (sup[0].y + inf[0].y) / 2 }, { x: x2, y: (sup[1].y + inf[1].y) / 2 }, punteada(v))));
                    void m1; void m2;
                }
                f.push(seg(l1, l2, lineaEstilo(v)));
                return f;
            } });
        reg({ name: 'nltFork', totalStep: 4,
            createPointFigures: ({ overlay, coordinates, bounding }) => {
                if (coordinates.length < 3) return coordinates.length === 2 ? [seg(coordinates[0], coordinates[1], punteada(estiloDe(overlay).v))] : [];
                const { v } = estiloDe(overlay);
                const [p0, p1, p2] = coordinates;
                const m = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
                const d = { x: m.x - p0.x, y: m.y - p0.y };
                const r0 = rayo(p0, d, bounding.width), r1 = rayo(p1, d, bounding.width), r2 = rayo(p2, d, bounding.width);
                const f = [poli([r1[0], r1[1], r2[1], r2[0]], css(v.relleno)), seg(r1[0], r1[1], lineaEstilo(v)), seg(r2[0], r2[1], lineaEstilo(v)),
                    sinEvento(seg(p1, p2, punteada(v)))];
                f.unshift(seg(r0[0], r0[1], { ...lineaEstilo(v), size: v.grosor + 1 }));
                if (v.mediana) f.push(sinEvento(seg(r0[0], m, punteada(v))));
                return f;
            } });

        // ── Fibonacci y Gann ──
        reg({ name: 'nltFibExt', totalStep: 4,
            createPointFigures: ({ overlay, coordinates, bounding }) => {
                if (coordinates.length < 2) return [];
                const { v } = estiloDe(overlay);
                const f = [sinEvento(seg(coordinates[0], coordinates[1], punteada(v)))];
                if (coordinates.length >= 3 && overlay.points.length >= 3) {
                    const [A, B, C] = overlay.points;
                    f.push(sinEvento(seg(coordinates[1], coordinates[2], punteada(v))));
                    const y = yDePrecio(coordinates, overlay.points);
                    const x1 = Math.min(coordinates[1].x, coordinates[2].x), x2 = v.extDer ? bounding.width : Math.max(coordinates[2].x, x1 + 60) + 60;
                    NIVELES_EXT.forEach((n, k) => {
                        if (!v[`n${k}`]) return;
                        const precio = C.value + (B.value - A.value) * n, yy = y(precio);
                        f.push(seg({ x: x1, y: yy }, { x: x2, y: yy }, lineaEstilo(v)));
                        f.push(etiqueta(x1 + 2, yy - 2, `${n}${v.mostrarPrecios ? ` (${pr(precio)})` : ''}`, v));
                    });
                }
                return f;
            } });
        reg({ name: 'nltFibTime', totalStep: 3, needDefaultYAxisFigure: false,
            createPointFigures: ({ overlay, coordinates, bounding }) => {
                if (coordinates.length < 2) return [];
                const { v } = estiloDe(overlay);
                const d = coordinates[1].x - coordinates[0].x;
                if (!d) return [];
                const f = [];
                FIB_TIEMPO.forEach((n) => {
                    const x = coordinates[0].x + d * n;
                    if (x < -2 || x > bounding.width + 2) return;
                    f.push(seg({ x, y: 0 }, { x, y: bounding.height }, lineaEstilo(v)));
                    if (v.mostrarNumeros) f.push(etiqueta(x + 3, 14, String(n), v));
                });
                return f;
            } });
        reg({ name: 'nltGannFan', totalStep: 3,
            createPointFigures: ({ overlay, coordinates, bounding }) => {
                if (coordinates.length < 2) return [];
                const { v } = estiloDe(overlay);
                const o = coordinates[0], dx = coordinates[1].x - o.x, dy = coordinates[1].y - o.y;
                if (!dx) return [];
                const f = [];
                GANN.forEach(([a, b]) => {
                    const fin = dx > 0 ? bounding.width : 0;
                    const e = { x: fin, y: o.y + dy * (a / b) * ((fin - o.x) / dx) };
                    f.push(seg(o, e, { ...lineaEstilo(v), size: a === b ? v.grosor + 1 : v.grosor }));
                    if (v.mostrarNombres && e.y > 4 && e.y < bounding.height - 4) f.push(etiqueta(e.x + (dx > 0 ? -2 : 2), e.y - 2, `${a}×${b}`, v, dx > 0 ? 'right' : 'left'));
                });
                return f;
            } });
        reg({ name: 'nltGannBox', totalStep: 3,
            createPointFigures: ({ overlay, coordinates }) => {
                if (coordinates.length < 2) return [];
                const { v } = estiloDe(overlay);
                const [a, b] = coordinates;
                const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
                const f = [poli(rect4(x1, y1, x2, y2), css(v.relleno))];
                CUADRO.forEach((n) => {
                    const x = x1 + (x2 - x1) * n, y = y1 + (y2 - y1) * n;
                    f.push(seg({ x: x1, y }, { x: x2, y }, lineaEstilo(v)), seg({ x, y: y1 }, { x, y: y2 }, lineaEstilo(v)));
                });
                if (v.diagonales) f.push(sinEvento(seg({ x: x1, y: y1 }, { x: x2, y: y2 }, punteada(v))), sinEvento(seg({ x: x1, y: y2 }, { x: x2, y: y1 }, punteada(v))));
                return f;
            } });

        // ── patrones ──
        [4, 5, 6, 7].forEach((n) => {
            reg({ name: `nltPatron${n}`, totalStep: n + 1,
                createPointFigures: ({ overlay, coordinates, bounding }) => {
                    const { h, v } = estiloDe(overlay);
                    const p = PATRONES[h.patron];
                    if (!p || coordinates.length < 2) return [];
                    const completo = coordinates.length >= p.n && overlay.points.length >= p.n;
                    const f = [];
                    if (completo) p.relleno.forEach((t) => f.push(poli(t.map((i) => coordinates[i]), css(v.relleno))));
                    for (let i = 1; i < coordinates.length; i++) f.push(seg(coordinates[i - 1], coordinates[i], lineaEstilo(v)));
                    if (completo) {
                        p.punteadas.forEach(([i, j]) => f.push(sinEvento(seg(coordinates[i], coordinates[j], punteada(v)))));
                        (p.prolongar || []).forEach(([i, j]) => {
                            const [e1, e2] = extender(coordinates[i], coordinates[j], false, true, bounding.width);
                            f.push(seg(e1, e2, h.patron === 'triangulo' ? lineaEstilo(v) : punteada(v)));
                        });
                        if (v.mostrarRatios) {
                            p.ratios.forEach(({ r, en }) => {
                                const den = Math.abs(overlay.points[r[3]].value - overlay.points[r[2]].value);
                                if (!den) return;
                                const q = (Math.abs(overlay.points[r[1]].value - overlay.points[r[0]].value) / den);
                                const a = coordinates[en[0]], b = coordinates[en[1]];
                                f.push(caja((a.x + b.x) / 2, (a.y + b.y) / 2, q.toFixed(3), 'rgba(17,24,39,.85)', 'middle', 'center', css({ ...v.color, t: 0 })));
                            });
                        }
                    }
                    if (v.mostrarEtiquetas) {
                        coordinates.forEach((c, i) => {
                            const t = p.et[i];
                            if (!t) return;
                            const ant = coordinates[i - 1], sgt = coordinates[i + 1];
                            const pico = (!ant || c.y <= ant.y) && (!sgt || c.y <= sgt.y);   // y menor = más arriba en pantalla
                            f.push(etiqueta(c.x, c.y + (pico ? -6 : 6), t, v, 'center', pico ? 'bottom' : 'top'));
                        });
                    }
                    return f;
                } });
        });

        // ── medición y pronóstico ──
        reg({ name: 'nltRangoFecha', totalStep: 3, needDefaultYAxisFigure: false,
            createPointFigures: ({ chart, overlay, coordinates, bounding }) => {
                if (coordinates.length < 2) return [];
                const { v } = estiloDe(overlay);
                const [a, b] = coordinates;
                const ym = (a.y + b.y) / 2;
                const f = [poli(rect4(a.x, 0, b.x, bounding.height), css(v.relleno)),
                    seg({ x: a.x, y: 0 }, { x: a.x, y: bounding.height }, lineaEstilo(v)), seg({ x: b.x, y: 0 }, { x: b.x, y: bounding.height }, lineaEstilo(v)),
                    ...flecha(a.x < b.x ? { x: a.x, y: ym } : { x: b.x, y: ym }, a.x < b.x ? { x: b.x, y: ym } : { x: a.x, y: ym }, lineaEstilo(v)).map(sinEvento)];
                if (overlay.points.length >= 2) f.push(caja((a.x + b.x) / 2, ym - 14, `${Math.abs(barras(chart, overlay.points[0], overlay.points[1]))} velas · ${duracion(overlay.points[1].timestamp - overlay.points[0].timestamp)}`, 'rgba(17,24,39,.9)'));
                return f;
            } });
        reg({ name: 'nltRangoPrecio', totalStep: 3,
            createPointFigures: ({ overlay, coordinates, bounding }) => {
                if (coordinates.length < 2) return [];
                const { v } = estiloDe(overlay);
                const [a, b] = coordinates;
                const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x, x1 + 40), xm = (x1 + x2) / 2;
                const f = [poli(rect4(x1, a.y, x2, b.y), css(v.relleno)), seg({ x: x1, y: a.y }, { x: x2, y: a.y }, lineaEstilo(v)), seg({ x: x1, y: b.y }, { x: x2, y: b.y }, lineaEstilo(v)),
                    ...flecha({ x: xm, y: a.y }, { x: xm, y: b.y }, lineaEstilo(v)).map(sinEvento)];
                if (overlay.points.length >= 2) {
                    const dp = overlay.points[1].value - overlay.points[0].value, pct = overlay.points[0].value ? (dp / overlay.points[0].value) * 100 : 0;
                    f.push(caja(xm, (a.y + b.y) / 2, `${sig(dp)}${pr(Math.abs(dp))} (${sig(pct)}${Math.abs(pct).toFixed(2)}%)`, 'rgba(17,24,39,.9)'));
                }
                void bounding;
                return f;
            } });
        const regla = (conDiagonal) => ({ chart, overlay, coordinates }) => {
            if (coordinates.length < 2) return [];
            const { v } = estiloDe(overlay);
            const [a, b] = coordinates;
            const sube = b.y <= a.y;
            const f = [poli(rect4(a.x, a.y, b.x, b.y), css(sube || !v.rellenoBaja ? v.relleno : v.rellenoBaja))];
            const xm = (a.x + b.x) / 2, ym = (a.y + b.y) / 2;
            f.push(...flecha({ x: xm, y: a.y }, { x: xm, y: b.y }, lineaEstilo(v)).map(sinEvento), ...flecha({ x: a.x, y: ym }, { x: b.x, y: ym }, lineaEstilo(v)).map(sinEvento));
            if (conDiagonal) f.push(seg(a, b, punteada(v)));
            if (overlay.points.length >= 2) {
                const m = medidas(chart, overlay.points[0], overlay.points[1]);
                f.push(caja(xm, b.y + (sube ? -16 : 16), m.texto, sube ? 'rgba(21,128,61,.92)' : 'rgba(185,28,28,.92)'));
            }
            return f;
        };
        reg({ name: 'nltRangoFP', totalStep: 3, createPointFigures: regla(false) });
        reg({ name: 'nltRegla', totalStep: 3, createPointFigures: regla(true) });
        reg({ name: 'nltPronostico', totalStep: 3,
            createPointFigures: ({ chart, overlay, coordinates }) => {
                if (coordinates.length < 2) return [];
                const { v } = estiloDe(overlay);
                const [a, b] = coordinates;
                const f = [poli(rect4(a.x, a.y, b.x, b.y), css(v.relleno)), ...flecha(a, b, lineaEstilo(v))];
                f.push({ type: 'circle', ignoreEvent: true, attrs: { x: b.x, y: b.y, r: 5 }, styles: { style: 'fill', color: css({ ...v.color, t: 0 }) } });
                if (overlay.points.length >= 2) {
                    const m = medidas(chart, overlay.points[0], overlay.points[1]);
                    f.push(caja(b.x, b.y + (m.dp >= 0 ? -16 : 16), `Objetivo ${pr(overlay.points[1].value)} · ${m.texto}`, 'rgba(17,24,39,.92)'));
                }
                return f;
            } });

        // ── perfil de volumen de rango fijo ──
        // El volumen de cada vela se reparte entre las filas de precio que su rango (mín–máx) toca, en proporción.
        // Se calcula una vez y se guarda: mover el gráfico o el cursor solo redibuja, no recalcula (ver `cachePerfil`).
        const cachePerfil = new Map();
        function perfilDe(datos, t1, t2, filas, vaPct) {
            const ult = datos[datos.length - 1];
            const clave = `${t1}|${t2}|${datos.length}|${ult ? ult.volume : 0}|${ult ? ult.close : 0}|${filas}|${vaPct}`;
            if (cachePerfil.has(clave)) return cachePerfil.get(clave);
            const velas = datos.filter((d) => d.timestamp >= t1 && d.timestamp <= t2);
            if (!velas.length) return null;
            let lo = Infinity, hi = -Infinity;
            velas.forEach((d) => { lo = Math.min(lo, d.low); hi = Math.max(hi, d.high); });
            if (!(hi > lo)) return null;
            const paso = (hi - lo) / filas, up = new Array(filas).fill(0), dn = new Array(filas).fill(0);
            velas.forEach((d) => {
                const vol = d.volume > 0 ? d.volume : 1, rango = d.high - d.low, sube = d.close >= d.open;
                const a = Math.max(0, Math.min(filas - 1, Math.floor((d.low - lo) / paso))), b = Math.max(0, Math.min(filas - 1, Math.floor((d.high - lo - 1e-12) / paso)));
                for (let i = a; i <= b; i++) {
                    const sup = Math.min(d.high, lo + (i + 1) * paso) - Math.max(d.low, lo + i * paso);
                    const parte = rango > 0 ? vol * (sup / rango) : vol / (b - a + 1);
                    if (sube) up[i] += parte; else dn[i] += parte;
                }
            });
            const tot = up.map((v, i) => v + dn[i]), suma = tot.reduce((x, y) => x + y, 0);
            let poc = 0; tot.forEach((v, i) => { if (v > tot[poc]) poc = i; });
            // Área de valor: desde el POC se suma la fila vecina más grande hasta cubrir vaPct% del volumen.
            let a = poc, b = poc, acum = tot[poc];
            while (acum < (suma * vaPct) / 100 && (a > 0 || b < filas - 1)) {
                const arriba = b < filas - 1 ? tot[b + 1] : -1, abajo = a > 0 ? tot[a - 1] : -1;
                if (arriba >= abajo) { b++; acum += tot[b]; } else { a--; acum += tot[a]; }
            }
            const r = { lo, hi, paso, up, dn, tot, poc, vaLo: a, vaHi: b, max: Math.max(...tot), n: velas.length };
            if (cachePerfil.size > 40) cachePerfil.clear();
            cachePerfil.set(clave, r);
            return r;
        }
        reg({ name: 'nltVPFR', totalStep: 3,
            createPointFigures: ({ chart, overlay, coordinates, bounding, yAxis }) => {
                if (coordinates.length < 2 || overlay.points.length < 2 || !yAxis) return [];
                const { v } = estiloDe(overlay);
                const [a, b] = overlay.points;
                const x1 = Math.min(coordinates[0].x, coordinates[1].x), x2 = Math.max(coordinates[0].x, coordinates[1].x);
                const t1 = Math.min(a.timestamp, b.timestamp), t2 = Math.max(a.timestamp, b.timestamp);
                const f = [{ type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x: x1, y: 0 }, { x: x1, y: bounding.height }] }, styles: { ...lineaEstilo({ ...v, grosor: 1, estiloLinea: 'dashed' }), color: 'rgba(148,163,184,.55)' } },
                    { type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x: x2, y: 0 }, { x: x2, y: bounding.height }] }, styles: { ...lineaEstilo({ ...v, grosor: 1, estiloLinea: 'dashed' }), color: 'rgba(148,163,184,.55)' } }];
                const P = perfilDe(chart.getDataList(), t1, t2, v.filas, v.vaPct);
                if (!P) return f;
                const ancho = Math.max(8, (x2 - x1) * (v.ancho / 100)), izq = v.lado === 'left';
                const yDe = (precio) => yAxis.convertToPixel(precio);
                if (v.mostrarVA) {
                    const yt = yDe(P.lo + (P.vaHi + 1) * P.paso), yb = yDe(P.lo + P.vaLo * P.paso);
                    f.push({ type: 'rect', ignoreEvent: true, attrs: { x: x1, y: Math.min(yt, yb), width: x2 - x1, height: Math.abs(yb - yt) }, styles: { style: 'fill', color: css(v.colorVA) } });
                }
                for (let i = 0; i < P.tot.length; i++) {
                    const yt = yDe(P.lo + (i + 1) * P.paso), yb = yDe(P.lo + i * P.paso), alto = Math.max(1, Math.abs(yb - yt) - 1), y = Math.min(yt, yb);
                    const largo = (P.tot[i] / P.max) * ancho, enVA = i >= P.vaLo && i <= P.vaHi;
                    const xBase = izq ? x1 : x2;
                    const seg = (desde, ancho2, color) => ({ type: 'rect', ignoreEvent: true, attrs: { x: izq ? xBase + desde : xBase - desde - ancho2, y, width: Math.max(0, ancho2), height: alto }, styles: { style: 'fill', color } });
                    if (v.dividir) {
                        const lu = (P.up[i] / P.max) * ancho, ld = (P.dn[i] / P.max) * ancho;
                        f.push(seg(0, lu, css(enVA || !v.mostrarVA ? v.colorUp : { ...v.colorUp, t: Math.min(95, v.colorUp.t + 25) })), seg(lu, ld, css(enVA || !v.mostrarVA ? v.colorDn : { ...v.colorDn, t: Math.min(95, v.colorDn.t + 25) })));
                    } else {
                        f.push(seg(0, largo, css(enVA || !v.mostrarVA ? v.colorUp : { ...v.colorUp, t: Math.min(95, v.colorUp.t + 25) })));
                    }
                }
                if (v.mostrarPOC) {
                    const y = yDe(P.lo + (P.poc + 0.5) * P.paso);
                    f.push({ type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x: x1, y }, { x: x2, y }] }, styles: { style: 'solid', size: 1.5, color: css({ ...v.color, t: 0 }) } });
                    if (v.mostrarEtiquetas) f.push(caja(izq ? x2 - 4 : x1 + 4, y - 9, `POC ${pr(P.lo + (P.poc + 0.5) * P.paso)}`, 'rgba(17,24,39,.85)', 'bottom', izq ? 'right' : 'left', css({ ...v.color, t: 0 })));
                }
                if (v.mostrarVA && v.mostrarEtiquetas) {
                    const vah = P.lo + (P.vaHi + 1) * P.paso, val = P.lo + P.vaLo * P.paso;
                    f.push(caja(izq ? x2 - 4 : x1 + 4, yDe(vah), `VAH ${pr(vah)}`, 'rgba(17,24,39,.85)', 'bottom', izq ? 'right' : 'left'), caja(izq ? x2 - 4 : x1 + 4, yDe(val), `VAL ${pr(val)}`, 'rgba(17,24,39,.85)', 'top', izq ? 'right' : 'left'));
                }
                return f;
            } });

        // ── formas ──
        const textoCentro = (v, x, y) => (v.texto ? [etiqueta(x, y, v.texto, v, 'center', 'middle')] : []);
        reg({ name: 'nltElipse', totalStep: 3,
            createPointFigures: ({ overlay, coordinates }) => {
                if (coordinates.length < 2) return [];
                const { v } = estiloDe(overlay);
                const [a, b] = coordinates;
                const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(a.x - b.x) / 2, ry = Math.abs(a.y - b.y) / 2;
                const pts = Array.from({ length: 72 }, (_, i) => ({ x: cx + rx * Math.cos((i / 72) * 2 * Math.PI), y: cy + ry * Math.sin((i / 72) * 2 * Math.PI) }));
                return [{ type: 'polygon', attrs: { coordinates: pts }, styles: { style: 'stroke_fill', color: css(v.relleno), borderColor: css(v.color), borderSize: v.grosor, borderStyle: v.estiloLinea === 'solid' ? 'solid' : 'dashed', borderDashedValue: guiones(v.estiloLinea, v.grosor) } }, ...textoCentro(v, cx, cy)];
            } });
        reg({ name: 'nltCirculo', totalStep: 3,
            createPointFigures: ({ overlay, coordinates }) => {
                if (coordinates.length < 2) return [];
                const { v } = estiloDe(overlay);
                const [c, b] = coordinates;
                const r = Math.hypot(b.x - c.x, b.y - c.y);
                return [{ type: 'circle', attrs: { x: c.x, y: c.y, r }, styles: { style: 'stroke_fill', color: css(v.relleno), borderColor: css(v.color), borderSize: v.grosor, borderStyle: v.estiloLinea === 'solid' ? 'solid' : 'dashed', borderDashedValue: guiones(v.estiloLinea, v.grosor) } }, ...textoCentro(v, c.x, c.y)];
            } });
        reg({ name: 'nltTriangulo', totalStep: 4,
            createPointFigures: ({ overlay, coordinates }) => {
                if (coordinates.length < 2) return [];
                const { v } = estiloDe(overlay);
                if (coordinates.length < 3) return [seg(coordinates[0], coordinates[1], lineaEstilo(v))];
                const cx = (coordinates[0].x + coordinates[1].x + coordinates[2].x) / 3, cy = (coordinates[0].y + coordinates[1].y + coordinates[2].y) / 3;
                return [{ type: 'polygon', attrs: { coordinates: coordinates.slice(0, 3) }, styles: { style: 'stroke_fill', color: css(v.relleno), borderColor: css(v.color), borderSize: v.grosor, borderStyle: v.estiloLinea === 'solid' ? 'solid' : 'dashed', borderDashedValue: guiones(v.estiloLinea, v.grosor) } }, ...textoCentro(v, cx, cy)];
            } });

        reg({ name: 'nltBrush', totalStep: 2, needDefaultPointFigure: false, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
            createPointFigures: ({ overlay, coordinates }) => {
                if (coordinates.length < 2) return [];
                const { v } = estiloDe(overlay);
                return [{ type: 'line', attrs: { coordinates }, styles: { style: 'solid', size: v.grosor, color: css(v.color) } }];
            } });

        // ── notas e íconos ──
        const globo = (x, y, texto, fondo, borde, tam, align = 'left', base = 'bottom') => ({
            type: 'text', attrs: { x, y, text: texto || ' ', align, baseline: base },
            styles: { color: '#0B0E14', size: tam, family: FUENTE, weight: 600, backgroundColor: fondo, borderColor: borde, borderSize: 1, borderRadius: 5, paddingLeft: 7, paddingRight: 7, paddingTop: 5, paddingBottom: 5 },
        });
        reg({ name: 'nltNota', totalStep: 2,
            createPointFigures: ({ overlay, coordinates }) => {
                if (!coordinates.length) return [];
                const { v } = estiloDe(overlay); const c = coordinates[0];
                return [{ type: 'circle', ignoreEvent: true, attrs: { x: c.x, y: c.y, r: 3 }, styles: { style: 'fill', color: css({ ...v.color, t: 0 }) } },
                    globo(c.x + 6, c.y - 6, v.texto, css({ ...v.color, t: 0 }), 'rgba(0,0,0,.25)', v.tamano)];
            } });
        reg({ name: 'nltCallout', totalStep: 3,
            createPointFigures: ({ overlay, coordinates }) => {
                if (coordinates.length < 2) return [];
                const { v } = estiloDe(overlay); const [a, b] = coordinates;
                return [seg(a, b, lineaEstilo(v)), { type: 'circle', ignoreEvent: true, attrs: { x: a.x, y: a.y, r: 3 }, styles: { style: 'fill', color: css({ ...v.color, t: 0 }) } },
                    globo(b.x, b.y, v.texto, css({ ...v.color, t: 0 }), css({ ...v.color, t: 0 }), v.tamano, 'center', 'middle')];
            } });
        reg({ name: 'nltEtiquetaPrecio', totalStep: 2,
            createPointFigures: ({ overlay, coordinates }) => {
                if (!coordinates.length) return [];
                const { v } = estiloDe(overlay); const c = coordinates[0];
                return [poli([c, { x: c.x + 7, y: c.y - 9 }, { x: c.x + 7, y: c.y + 9 }], css({ ...v.color, t: 0 })),
                    { type: 'text', attrs: { x: c.x + 7, y: c.y, text: pr(overlay.points[0].value), align: 'left', baseline: 'middle' }, styles: { color: '#0B0E14', size: 11, family: FUENTE, weight: 600, backgroundColor: css({ ...v.color, t: 0 }), borderSize: 0, borderRadius: 3, paddingLeft: 6, paddingRight: 6, paddingTop: 4, paddingBottom: 4 } }];
            } });
        reg({ name: 'nltFlecha', totalStep: 2,
            createPointFigures: ({ overlay, coordinates }) => {
                if (!coordinates.length) return [];
                const { h, v } = estiloDe(overlay); const c = coordinates[0];
                const t = v.tamano, s = h.dir === 'down' ? -1 : 1;   // la punta queda en el punto; el cuerpo, del lado opuesto
                const pts = [[0, 0], [-0.5, 0.5], [-0.2, 0.5], [-0.2, 1.1], [0.2, 1.1], [0.2, 0.5], [0.5, 0.5]].map(([dx, dy]) => ({ x: c.x + dx * t, y: c.y + s * dy * t }));
                const f = [{ type: 'polygon', attrs: { coordinates: pts }, styles: { style: 'fill', color: css({ ...v.color, t: 0 }) } }];
                if (v.texto) f.push(etiqueta(c.x, c.y + s * 1.2 * t, v.texto, v, 'center', s > 0 ? 'top' : 'bottom'));
                return f;
            } });
        reg({ name: 'nltIcono', totalStep: 2,
            createPointFigures: ({ overlay, coordinates }) => {
                if (!coordinates.length) return [];
                const { v } = estiloDe(overlay); const c = coordinates[0];
                return [{ type: 'text', attrs: { x: c.x, y: c.y, text: v.icono || '🔥', align: 'center', baseline: 'middle' }, styles: { color: '#fff', size: v.tamano, family: FUENTE_EMOJI, backgroundColor: 'transparent', borderSize: 0 } }];
            } });
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.drawingsExtra = { CATEGORIAS, PATRONES, definir, registrar };
})();
