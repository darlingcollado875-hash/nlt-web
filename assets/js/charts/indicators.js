/* NLT Charts -- indicadores: panel, leyenda de cada panel y configuración.
 *
 * FREE: se calculan en el navegador. El indicador por defecto es la NLT
 * Unified Suite (unified-suite.js, port del .pine); los demás propios de NLT
 * están en indicators-free.js; los clásicos ("NLT Basics") vienen con el motor.
 * Los que van sobre el precio se dibujan en el panel de velas; los osciladores
 * (RSI, MACD, volumen, estocástico...) en su propio panel debajo.
 *
 * Como en TradingView, cada panel tiene su leyenda con el nombre y tres
 * controles por indicador: ojo (mostrar/ocultar), engranaje (configuración) y
 * quitar. La configuración tiene pestañas Entradas / Estilo / Visibilidad, con
 * vista previa en vivo. Los cambios solo visuales (colores, grosores,
 * visibilidad) redibujan sin recalcular (ver settings.exigeRecalculo).
 *
 * PRO: NO se calculan acá. El navegador solo pide al backend el catálogo y,
 * si el backend confirma el acceso (plan o trial), los RESULTADOS para
 * dibujar. Ver pro.js. */
(function () {
    const CANDLE_PANE = 'candle_pane';
    const PALETA = ['#FF9600', '#935EBD', '#1677FF', '#E11D74', '#01C5C4'];

    // `params`: entradas de los clásicos = calcParams del motor.
    // `lineas`: nombre de cada línea (en el orden de las figuras del motor), para la pestaña Estilo.
    const GRUPOS = [
        {
            titulo: 'NLT · gratis',
            items: [
                { id: 'NLT_UNIFIED', nombre: 'NLT Unified Suite', desc: 'Soporte y resistencia, BOS/CHoCH, Order Blocks, FVG, sesiones, liquidez y SMC Market Bias', pane: 'candle', propio: true },
                { id: 'NLT_SESSIONS', nombre: 'NLT Sessions', desc: 'Asia, Londres y Nueva York (hora NY) en gráficos intradía', pane: 'candle', propio: true },
                { id: 'NLT_KEY_LEVELS', nombre: 'NLT Key Levels', desc: 'PDH, PDL, PWH y PWL: máximos y mínimos del día y la semana anteriores', pane: 'candle', propio: true },
                { id: 'NLT_FVG', nombre: 'FVG básico', desc: 'Huecos de 3 velas todavía sin rellenar', pane: 'candle', propio: true },
                { id: 'NLT_FREE_ZONES', nombre: 'NLT Free Zones', desc: 'Oferta y demanda simple: pivotes no testeados', pane: 'candle', propio: true },
            ],
        },
        {
            titulo: 'NLT Basics · sobre el precio',
            items: [
                { id: 'MA', nombre: 'Medias móviles', pane: 'candle', params: [['Período 1', 20], ['Período 2', 50]], lineas: ['MA 1', 'MA 2'] },
                { id: 'EMA', nombre: 'EMA', pane: 'candle', params: [['Período 1', 9], ['Período 2', 21]], lineas: ['EMA 1', 'EMA 2'] },
                { id: 'BOLL', nombre: 'Bandas de Bollinger', pane: 'candle', params: [['Período', 20], ['Desvíos', 2]], lineas: ['Superior', 'Media', 'Inferior'] },
                { id: 'SAR', nombre: 'Parabolic SAR', pane: 'candle', params: [['Inicio (×0,01)', 2], ['Paso (×0,01)', 2], ['Máximo (×0,01)', 20]], circulos: true },
            ],
        },
        {
            titulo: 'NLT Basics · osciladores (panel propio)',
            items: [
                { id: 'VOL', nombre: 'Volumen', pane: 'sub', params: [['Media 1', 5], ['Media 2', 10], ['Media 3', 20]], lineas: ['Media 1', 'Media 2', 'Media 3'], barras: true },
                { id: 'RSI', nombre: 'RSI', pane: 'sub', params: [['Período', 14]], precision: 2, lineas: ['RSI'] },
                { id: 'MACD', nombre: 'MACD', pane: 'sub', params: [['Rápida', 12], ['Lenta', 26], ['Señal', 9]], lineas: ['DIF', 'DEA'], barras: true },
                { id: 'KDJ', nombre: 'Estocástico (KDJ)', pane: 'sub', params: [['Período', 9], ['Suavizado K', 3], ['Suavizado D', 3]], precision: 2, lineas: ['K', 'D', 'J'] },
                { id: 'CCI', nombre: 'CCI', pane: 'sub', params: [['Período', 20]], precision: 2, lineas: ['CCI'] },
                { id: 'WR', nombre: 'Williams %R', pane: 'sub', params: [['Período', 14]], precision: 2, lineas: ['%R'] },
            ],
        },
    ];
    // Más indicadores (VWAP, Ichimoku, Supertrend, ATR, MFI, ADX...): ver indicators-extra.js
    if (NLTCharts.indicatorsExtra) GRUPOS.push(...NLTCharts.indicatorsExtra.GRUPOS);
    const FREE = GRUPOS.flatMap((g) => g.items);
    // Indicadores PRO que se pueden marcar con ⭐ (se prenden desde su propio módulo).
    const PRO_FAV = {
        NLT_ZONE_ENGINE: { nombre: 'NLT Zone Engine PRO', desc: 'Order Blocks, FVG y estados del motor NLT', api: () => NLTCharts.app && NLTCharts.app.pro },
        NLT_INDICATOR_AI: { nombre: 'NLT AI', desc: 'Análisis con IA de los eventos del Zone Engine', api: () => NLTCharts.app && NLTCharts.app.nltAi },
    };
    const FAV_DEF = ['NLT_ZONE_ENGINE', 'NLT_INDICATOR_AI', 'RSI', 'MACD', 'EMA'];
    const porId = Object.fromEntries(FREE.map((f) => [f.id, f]));
    const col = (hex, t = 0) => ({ hex, t });
    const css = (c) => NLTCharts.pine.css(c);

    // ---------------------------------------------------------------- esquemas de configuración
    // Visibilidad por temporalidad (pestaña Visibilidad), común a todos.
    const VIS = [
        { id: 'vis_m', tipo: 'bool', def: true, titulo: 'Minutos', grupo: 'Mostrar en', tab: 'Visibilidad', recalc: false },
        { id: 'vis_h', tipo: 'bool', def: true, titulo: 'Horas', grupo: 'Mostrar en', tab: 'Visibilidad', recalc: false },
        { id: 'vis_d', tipo: 'bool', def: true, titulo: 'Días', grupo: 'Mostrar en', tab: 'Visibilidad', recalc: false },
        { id: 'vis_w', tipo: 'bool', def: true, titulo: 'Semanas', grupo: 'Mostrar en', tab: 'Visibilidad', recalc: false },
    ];
    function claveVis(tf) {
        const u = String(tf || '').slice(-1);
        if (u === 'm') return 'vis_m';
        if (u === 'h' || u === 'H') return 'vis_h';
        if (u === 'd' || u === 'D') return 'vis_d';
        if (u === 'w' || u === 'W') return 'vis_w';
        return null;
    }

    function estiloInputs(f) {
        const out = [];
        (f.lineas || []).forEach((nombre, k) => {
            out.push({ id: `c${k}`, tipo: 'color', def: col(PALETA[k % PALETA.length]), titulo: nombre, grupo: 'Líneas', tab: 'Estilo', inline: `l${k}`, recalc: false });
            out.push({ id: `g${k}`, tipo: 'int', def: 1, titulo: 'Grosor', grupo: 'Líneas', tab: 'Estilo', inline: `l${k}`, min: 1, max: 4, recalc: false });
        });
        if (f.barras) {
            out.push({ id: 'barUp', tipo: 'color', def: col('#22C55E', 55), titulo: 'Sube', grupo: 'Barras', tab: 'Estilo', inline: 'b', recalc: false });
            out.push({ id: 'barDown', tipo: 'color', def: col('#EF4444', 55), titulo: 'Baja', grupo: 'Barras', tab: 'Estilo', inline: 'b', recalc: false });
        }
        if (f.circulos) {
            out.push({ id: 'cirUp', tipo: 'color', def: col('#2DC08E', 30), titulo: 'Alcista', grupo: 'Puntos', tab: 'Estilo', inline: 'p', recalc: false });
            out.push({ id: 'cirDown', tipo: 'color', def: col('#F92855', 30), titulo: 'Bajista', grupo: 'Puntos', tab: 'Estilo', inline: 'p', recalc: false });
        }
        return out;
    }

    // Clásicos: períodos (Entradas) + colores y grosores (Estilo) + Visibilidad.
    // Propios: su esquema (de su archivo) + Visibilidad.
    function registrarEsquemas() {
        const S = NLTCharts.settings;
        FREE.forEach((f) => {
            if (f.params) {
                S.registrar(f.id, {
                    titulo: f.nombre,
                    inputs: [
                        ...f.params.map(([titulo, def], k) => ({ id: `p${k}`, tipo: 'int', def, titulo, grupo: 'Entradas', min: 1, max: 500 })),
                        ...estiloInputs(f), ...VIS,
                    ],
                });
                return;
            }
            const e = S.esquema(f.id) || { titulo: f.nombre, inputs: [] };
            if (!e.inputs.some((inp) => inp.id === 'vis_m')) S.registrar(f.id, { ...e, inputs: [...e.inputs, ...VIS] });
        });
    }
    const valoresDe = (id) => NLTCharts.settings.valores(id);
    const paramsDe = (f) => f.params.map((_, k) => valoresDe(f.id)[`p${k}`]);

    // Estilos de un clásico para el motor (figuras por índice: lines[k], bars[0], circles[0]).
    function estilosDe(f) {
        const v = valoresDe(f.id);
        const st = {};
        if (f.lineas) st.lines = f.lineas.map((_, k) => ({ style: 'solid', smooth: false, size: v[`g${k}`], dashedValue: [2, 2], color: css(v[`c${k}`]) }));
        if (f.barras) st.bars = [{ style: 'fill', borderStyle: 'solid', borderSize: 1, borderDashedValue: [2, 2], upColor: css(v.barUp), downColor: css(v.barDown), noChangeColor: 'rgba(107,114,128,0.45)' }];
        if (f.circulos) st.circles = [{ style: 'fill', borderStyle: 'solid', borderSize: 1, borderDashedValue: [2, 2], upColor: css(v.cirUp), downColor: css(v.cirDown), noChangeColor: '#76808F' }];
        return st;
    }

    // ---------------------------------------------------------------- leyenda (controles en cada panel)
    // Íconos de Phosphor (misma fuente que el resto de la interfaz).
    const ICONO = { ojo: '', ojoNo: '', ajustes: '', quitar: '' };
    let leyendaCtx = null;   // lo completa montar()
    function feature(id, code) {
        return {
            id, position: 'middle', type: 'icon_font', content: { family: 'Phosphor', code },
            size: 13, color: '#8B93A1', activeColor: '#FFFFFF', backgroundColor: 'transparent', activeBackgroundColor: 'rgba(255,255,255,0.10)',
            marginLeft: 2, marginTop: 1, marginRight: 0, marginBottom: 0, paddingLeft: 3, paddingTop: 2, paddingRight: 3, paddingBottom: 2, borderRadius: 4,
        };
    }
    function features(indicator) {
        if (!leyendaCtx || !indicator) return [];
        const id = indicator.name;
        const out = [feature('ojo', indicator.visible ? ICONO.ojo : ICONO.ojoNo)];
        if (leyendaCtx.tieneAjustes(id)) out.push(feature('ajustes', ICONO.ajustes));
        if (leyendaCtx.sePuedeQuitar(id)) out.push(feature('quitar', ICONO.quitar));
        return out;
    }

    /**
     * montar({ chart, panelEl, panelBgEl, activos, getTimeframe, onCambio, pro })
     *   -> { abrir(), refrescarPanel(), activar(id), recalcular(), abrirAjustes(id), cambioTimeframe() }
     *   pro: objeto de pro.js (opcional) que dibuja su propia sección en el panel.
     */
    function montar({ chart, panelEl, panelBgEl, activos, getTimeframe, onCambio, pro }) {
        NLTCharts.freeIndicators.registrar();
        if (NLTCharts.indicatorsExtra) NLTCharts.indicatorsExtra.registrar();
        NLTCharts.unified.registrar();
        registrarEsquemas();
        const state = NLTCharts.state;
        const esc = NLTCharts.ui.esc;
        const on = new Set();
        const visibleAhora = new Map();
        let ocultos = new Set(state.prefs().indicadoresOcultos || []);
        // ⭐ Favoritos: indicadores gratis y PRO (Zone Engine, NLT AI). Por defecto los del pedido de Fase 3.
        let favs = (state.prefs().indicadoresFav || FAV_DEF).filter((id) => porId[id] || PRO_FAV[id]);
        let filtro = '';
        let version = 0;

        // Visible = el ojo no lo ocultó y la temporalidad actual está habilitada en Visibilidad.
        function visibleDeseado(id) {
            if (ocultos.has(id)) return false;
            const k = claveVis(getTimeframe && getTimeframe());
            return !k || valoresDe(id)[k] !== false;
        }
        function aplicarVisibilidad(id) {
            if (!on.has(id)) return;
            const v = visibleDeseado(id);
            if (visibleAhora.get(id) === v) return;
            visibleAhora.set(id, v);
            chart.overrideIndicator({ name: id, visible: v });
        }

        function activar(id) {
            const def = porId[id];
            if (!def || on.has(id)) return;
            const crear = { name: id, visible: visibleDeseado(id) };
            if (def.params) crear.calcParams = paramsDe(def);
            if (def.propio) crear.calcParams = [version];
            if (def.precision != null) crear.precision = def.precision;
            if (def.lineas || def.barras || def.circulos) {
                crear.styles = estilosDe(def);
                // leyenda con controles también en los clásicos (nombre y valores los pone el motor)
                crear.createTooltipDataSource = ({ indicator }) => ({ features: features(indicator) });
            }
            if (def.pane === 'candle') {
                crear.paneId = CANDLE_PANE;
                chart.createIndicator(crear, true);
            } else {
                chart.createIndicator(crear, false, { height: 110, minHeight: 60 });
            }
            on.add(id);
            visibleAhora.set(id, crear.visible);
            if (def.pane !== 'candle') ajustarPaneles();
        }

        // Los paneles de osciladores nunca dejan al gráfico de velas con menos de ~45% del alto
        // (en pantallas bajas 3 paneles de 110 px lo aplastaban). Si entran, se respeta el
        // tamaño que el usuario les dio arrastrando el separador.
        function ajustarPaneles() {
            const H = (chart.getSize() || {}).height || 0;
            const subs = [...on].filter((id) => porId[id] && porId[id].pane === 'sub')
                .map((id) => chart.getIndicators({ name: id })[0]).filter(Boolean);
            if (!H || !subs.length) return;
            const alto = (i) => ((chart.getSize(i.paneId) || {}).height || 0);
            const tope = Math.floor(H * 0.55);
            if (subs.reduce((a, i) => a + alto(i), 0) <= tope) return;
            const h = Math.max(36, Math.floor(tope / subs.length));
            subs.forEach((i) => chart.setPaneOptions({ id: i.paneId, height: h, minHeight: 30 }));
        }
        let timerPaneles = null;
        window.addEventListener('resize', () => { clearTimeout(timerPaneles); timerPaneles = setTimeout(ajustarPaneles, 150); });

        function desactivar(id) {
            if (!on.has(id)) return;
            chart.removeIndicator({ name: id });
            on.delete(id);
            visibleAhora.delete(id);
            // quitado = vuelve visible si se agrega de nuevo (como en TradingView)
            if (ocultos.delete(id)) state.savePrefs({ indicadoresOcultos: [...ocultos] });
            if (id === NLTCharts.unified.ID) NLTCharts.unified.limpiar();
        }

        // Cambio en la configuración: visual -> solo redibujar; si no, recalcular.
        function aplicarAjustes(id, cambiados) {
            const def = porId[id];
            if (!def || !on.has(id)) return;
            aplicarVisibilidad(id);
            if (!NLTCharts.settings.exigeRecalculo(id, cambiados)) {
                // Clásicos: el motor toma estilos por indicador vía override (cálculo trivial).
                // Propios: los colores se resuelven al dibujar -> alcanza con redibujar.
                if (def.params) chart.overrideIndicator({ name: id, styles: estilosDe(def) });
                else chart.setStyles({});
                return;
            }
            version += 1;
            const o = { name: id, calcParams: def.params ? paramsDe(def) : [version] };
            if (def.params) o.styles = estilosDe(def);
            chart.overrideIndicator(o);
        }
        const abrirAjustes = (id) => {
            if (!NLTCharts.settings.tiene(id)) return;
            NLTCharts.settings.abrir(id, (vals, cambiados) => aplicarAjustes(id, cambiados));
        };

        function guardarActivos() { onCambio([...on]); }
        function alternarOjo(id) {
            ocultos.has(id) ? ocultos.delete(id) : ocultos.add(id);
            state.savePrefs({ indicadoresOcultos: [...ocultos] });
            aplicarVisibilidad(id);
        }

        leyendaCtx = {
            tieneAjustes: (id) => (id === 'NLT_PRO_ZONES' ? !!(pro && pro.abrirAjustes) : NLTCharts.settings.tiene(id)),
            sePuedeQuitar: (id) => !!porId[id],
        };
        chart.subscribeAction('onIndicatorTooltipFeatureClick', (data) => {
            const id = data && data.indicator && data.indicator.name;
            const acc = data && data.feature && data.feature.id;
            if (!id || !acc) return;
            if (id === 'NLT_PRO_ZONES') {
                if (acc === 'ojo' && pro && pro.alternarVisible) pro.alternarVisible();
                if (acc === 'ajustes' && pro && pro.abrirAjustes) pro.abrirAjustes();
                return;
            }
            if (acc === 'ojo') alternarOjo(id);
            else if (acc === 'ajustes') abrirAjustes(id);
            else if (acc === 'quitar') { desactivar(id); guardarActivos(); refrescarPanel(); }
        });

        // ------------------------------------------------------------ panel
        function descripcion(f) {
            if (!f.params) return f.desc;
            return paramsDe(f).join(', ');
        }
        function fila(f) {
            const fav = favs.includes(f.id);
            return `<div class="ch-ind-fila">
                <label class="ch-ind">
                    <input type="checkbox" data-ind="${esc(f.id)}"${on.has(f.id) ? ' checked' : ''}>
                    <span><span class="ch-ind-name block">${esc(f.nombre)}</span><span class="ch-ind-desc">${esc(descripcion(f))}</span></span>
                </label>
                <button type="button" class="ch-gear ch-ind-star${fav ? ' on' : ''}" data-fav-ind="${esc(f.id)}" title="${fav ? 'Quitar de favoritos' : 'Agregar a favoritos'}" aria-label="${fav ? 'Quitar' : 'Agregar'} ${esc(f.nombre)} ${fav ? 'de' : 'a'} favoritos"><i class="${fav ? 'ph-fill' : 'ph'} ph-star"></i></button>
                ${NLTCharts.settings.tiene(f.id) ? `<button type="button" class="ch-gear" data-gear="${esc(f.id)}" title="Configuración" aria-label="Configuración de ${esc(f.nombre)}"><i class="ph ph-gear-six"></i></button>` : ''}
            </div>`;
        }
        // Fila de un favorito PRO: su casilla prende/apaga el indicador (el acceso lo decide el servidor).
        function filaPro(id) {
            const p = PRO_FAV[id], api = p.api();
            if (!api) return '';
            return `<div class="ch-ind-fila">
                <label class="ch-ind">
                    <input type="checkbox" data-pro-fav="${esc(id)}"${api.visible() ? ' checked' : ''}>
                    <span><span class="ch-ind-name block">${esc(p.nombre)}</span><span class="ch-ind-desc">${esc(p.desc)}</span></span>
                </label>
                <button type="button" class="ch-gear ch-ind-star on" data-fav-ind="${esc(id)}" title="Quitar de favoritos" aria-label="Quitar ${esc(p.nombre)} de favoritos"><i class="ph-fill ph-star"></i></button>
            </div>`;
        }
        function listaHTML() {
            const q = filtro.trim().toLowerCase();
            const coincide = (f) => !q || [f.nombre, f.desc || '', f.id].some((t) => t.toLowerCase().includes(q));
            const bloques = [];
            // La búsqueda muestra primero los favoritos que coinciden (gratis y PRO).
            const favHTML = favs.map((id) => (porId[id] ? (coincide(porId[id]) ? fila(porId[id]) : '') : PRO_FAV[id] && coincide({ id, ...PRO_FAV[id] }) ? filaPro(id) : '')).join('');
            if (favHTML) bloques.push(`<p class="ch-grupo"><i class="ph-fill ph-star" style="color:#FACC15"></i> Favoritos</p>${favHTML}`);
            GRUPOS.forEach((g) => {
                const items = g.items.filter(coincide);
                if (items.length) bloques.push(`<p class="ch-grupo">${esc(g.titulo)}</p>${items.map(fila).join('')}`);
            });
            return bloques.join('') || '<p class="ch-ind-desc" style="padding:8px 2px">Sin resultados.</p>';
        }
        // ── Plantillas: guarda los indicadores activos con su configuración y los vuelve a poner con un clic ──
        const plantillas = () => { const p = state.prefs().plantillasInd; return p && typeof p === 'object' ? p : {}; };
        function plantillasHTML() {
            const nombres = Object.keys(plantillas()).sort();
            return `<div class="ch-plant"><select data-plant-sel aria-label="Plantillas de indicadores"><option value="">Plantillas…</option>${nombres.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select>
                <button type="button" data-plant="aplicar" title="Aplicar la plantilla elegida">Aplicar</button>
                <button type="button" data-plant="guardar" title="Guardar los indicadores actuales como plantilla">Guardar</button>
                <button type="button" data-plant="borrar" title="Borrar la plantilla elegida" aria-label="Borrar plantilla"><i class="ph ph-trash"></i></button></div>`;
        }
        function guardarPlantilla() {
            const ids = [...on];
            if (!ids.length) { window.alert('No hay indicadores activos para guardar.'); return; }
            const nombre = (window.prompt('Nombre de la plantilla') || '').trim().slice(0, 40);
            if (!nombre) return;
            const todas = plantillas();
            if (todas[nombre] && !window.confirm(`Ya existe "${nombre}". ¿Reemplazarla?`)) return;
            const ajustes = {};
            ids.forEach((id) => { if (NLTCharts.settings.tiene(id)) ajustes[id] = { ...NLTCharts.settings.valores(id) }; });
            state.savePrefs({ plantillasInd: { ...todas, [nombre]: { ids, ajustes } } });
            render();
            const sel = panelEl.querySelector('[data-plant-sel]'); if (sel) sel.value = nombre;
        }
        function aplicarPlantilla(nombre) {
            const t = plantillas()[nombre];
            if (!t) return;
            [...on].forEach(desactivar);
            (t.ids || []).filter((id) => porId[id]).forEach((id) => {
                if (t.ajustes && t.ajustes[id]) NLTCharts.settings.guardar(id, t.ajustes[id]);
                activar(id);
            });
            guardarActivos(); render();
        }
        function render() {
            panelEl.innerHTML = `
                <div class="flex items-center justify-between mb-3">
                    <p class="text-sm font-bold">Indicadores</p>
                    <button type="button" data-cerrar class="ch-tool" aria-label="Cerrar"><i class="ph ph-x"></i></button>
                </div>
 ${plantillasHTML()}
                <input type="search" class="wl-buscar ch-ind-buscar" placeholder="Buscar indicador" value="${esc(filtro)}" aria-label="Buscar indicador">
                <div data-ind-lista>${listaHTML()}</div>
                <div id="chProSeccion"></div>`;
            if (pro) pro.renderSeccion(panelEl.querySelector('#chProSeccion'), filtro, favs);
        }
        function refrescarPanel() { if (!panelEl.hidden) render(); }

        function cerrar() { panelEl.hidden = true; panelBgEl.hidden = true; }

        panelEl.addEventListener('change', (ev) => {
            const pf = ev.target.dataset && ev.target.dataset.proFav;
            if (pf) { const api = PRO_FAV[pf] && PRO_FAV[pf].api(); if (api) api.alternar(ev.target.checked); return; }
            const id = ev.target.dataset && ev.target.dataset.ind;
            if (!id) return;
            ev.target.checked ? activar(id) : desactivar(id);
            guardarActivos();
            // el mismo indicador puede estar en Favoritos y en su grupo
            panelEl.querySelectorAll(`[data-ind="${id}"]`).forEach((c) => { c.checked = on.has(id); });
        });
        panelEl.addEventListener('input', (ev) => {
            if (!ev.target.classList.contains('ch-ind-buscar')) return;
            filtro = ev.target.value;
            panelEl.querySelector('[data-ind-lista]').innerHTML = listaHTML();
            if (pro) pro.renderSeccion(panelEl.querySelector('#chProSeccion'), filtro, favs);
        });
        panelEl.addEventListener('click', (ev) => {
            if (ev.target.closest('[data-cerrar]')) { cerrar(); return; }
            const pl = ev.target.closest('[data-plant]');
            if (pl) {
                const sel = panelEl.querySelector('[data-plant-sel]'); const nombre = sel && sel.value;
                if (pl.dataset.plant === 'guardar') guardarPlantilla();
                else if (!nombre) window.alert('Elige una plantilla de la lista.');
                else if (pl.dataset.plant === 'aplicar') aplicarPlantilla(nombre);
                else if (pl.dataset.plant === 'borrar' && window.confirm(`¿Borrar la plantilla "${nombre}"?`)) { const t = { ...plantillas() }; delete t[nombre]; state.savePrefs({ plantillasInd: t }); render(); }
                return;
            }
            const star = ev.target.closest('[data-fav-ind]');
            if (star) {
                const id = star.dataset.favInd;
                favs = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id];
                state.savePrefs({ indicadoresFav: favs });
                panelEl.querySelector('[data-ind-lista]').innerHTML = listaHTML();
                if (pro) pro.renderSeccion(panelEl.querySelector('#chProSeccion'), filtro, favs);
                return;
            }
            const g = ev.target.closest('[data-gear]');
            if (!g) return;
            const id = g.dataset.gear;
            if (!on.has(id)) { activar(id); guardarActivos(); }
            cerrar();
            abrirAjustes(id);
        });
        panelBgEl.addEventListener('click', cerrar);
        document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !panelEl.hidden) cerrar(); });

        (activos || []).forEach(activar);
        // el alto real del contenedor se conoce después del primer layout
        requestAnimationFrame(ajustarPaneles);

        return {
            activar(id) { activar(id); guardarActivos(); },
            desactivar(id) { desactivar(id); guardarActivos(); },
            abrir() { render(); panelEl.hidden = false; panelBgEl.hidden = false; },
            refrescarPanel,
            // Recalcula los indicadores propios (ej. al cambiar de símbolo el
            // contexto HTF de la Suite).
            recalcular() { FREE.filter((f) => f.propio && on.has(f.id)).forEach((f) => aplicarAjustes(f.id)); },
            abrirAjustes,
            // Al cambiar de temporalidad se aplica la pestaña Visibilidad de cada indicador.
            cambioTimeframe() { on.forEach((id) => aplicarVisibilidad(id)); },
            activos: () => [...on],
        };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.indicators = { montar, FREE, GRUPOS };
    window.NLTCharts.leyenda = { features, feature, ICONO: { ...ICONO, codigo: '\ue1bc' } };
})();
