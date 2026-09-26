/* NLT Charts -- sección PRO del panel y dibujo del Zone Engine.
 *
 * Este archivo NO decide acceso ni calcula zonas. Muestra lo que dice el
 * backend (/charts/pro/catalog) y dibuja los resultados que devuelve
 * /charts/pro/zone-engine. Si alguien modifica este JS para "encender" el
 * PRO sin permiso, el backend responde 403 y no hay nada que dibujar.
 *
 * Lo único que se guarda en el navegador es una preferencia de pantalla
 * ("quiero ver el Zone Engine"), nunca un permiso. */
(function () {
    const ZE = 'NLT_ZONE_ENGINE';
    const REFRESCO_MS = 30000;
    const PREF = 'nlt_charts_pro_ver_v1';
    const FUENTE = 'Inter, system-ui, sans-serif';

    let zonas = [];          // última respuesta del backend (solo para dibujar)
    let registrado = false;

    function registrar() {
        if (registrado) return;
        registrado = true;
        klinecharts.registerIndicator({
            name: 'NLT_PRO_ZONES',
            shortName: 'Zone Engine PRO',
            figures: [],
            calc: (dataList) => dataList.map(() => ({})),
            createTooltipDataSource: () => ({ name: 'Zone Engine PRO', calcParamsText: '', features: [], legends: [] }),
            draw: ({ ctx, chart, bounding }) => {
                const ancho = bounding.width;
                ctx.save();
                ctx.font = `600 10px ${FUENTE}`;
                ctx.textBaseline = 'top';
                zonas.forEach((z) => {
                    const a = chart.convertToPixel({ timestamp: z.from, value: z.top });
                    const b = chart.convertToPixel({ timestamp: z.until || z.created, value: z.bottom });
                    if (a.x == null || a.y == null || b.y == null) return;
                    const x0 = a.x, x1 = z.until ? b.x : ancho;
                    if (x1 < 0 || x0 > ancho) return;
                    const activa = z.state === 'active';
                    const rgb = z.kind === 'ob' ? (z.dir === 'bull' ? '34,197,94' : '239,68,68') : (z.dir === 'bull' ? '45,212,191' : '251,146,60');
                    const top = Math.min(a.y, b.y), h = Math.max(1, Math.abs(b.y - a.y));
                    ctx.fillStyle = `rgba(${rgb},${activa ? 0.14 : 0.05})`;
                    ctx.fillRect(x0, top, x1 - x0, h);
                    ctx.setLineDash(activa ? [] : [4, 3]);
                    ctx.strokeStyle = `rgba(${rgb},${activa ? 0.8 : 0.35})`;
                    ctx.strokeRect(x0 + 0.5, top + 0.5, x1 - x0 - 1, h - 1);
                    if (h >= 10 && x1 - x0 > 30) {
                        ctx.fillStyle = `rgba(${rgb},${activa ? 0.95 : 0.5})`;
                        ctx.fillText(`${z.kind.toUpperCase()}${activa ? '' : ' ✕'}`, Math.max(x0, 0) + 3, top + 2);
                    }
                });
                ctx.restore();
                return false;
            },
        });
    }

    function leerPref() { try { return localStorage.getItem(PREF) === '1'; } catch (_) { return false; } }
    function guardarPref(v) { try { localStorage.setItem(PREF, v ? '1' : '0'); } catch (_) { /* sin almacenamiento */ } }

    function tiempoRestante(iso) {
        const ms = new Date(iso).getTime() - Date.now();
        if (ms <= 0) return 'termina ahora';
        const h = Math.floor(ms / 3600000);
        return h >= 24 ? `quedan ${Math.floor(h / 24)} d ${h % 24} h` : `quedan ${h} h ${Math.floor((ms % 3600000) / 60000)} min`;
    }

    /**
     * crear({ chart, getSymbol, getTimeframe, getRectangulo, onCambio }) -> api
     */
    // Mismas entradas que el grupo "📦 ZONA MANUAL (precios)" del V13.4 en TradingView.
    // Son datos del usuario (su zona), no permisos: el backend decide el acceso.
    const AJUSTES = {
        titulo: 'NLT Zone Engine PRO',
        inputs: [
            { id: 'zoneTop', tipo: 'float', def: 0, titulo: 'Zona TOP', grupo: '📦 ZONA MANUAL (precios)', step: 0.00001, min: 0 },
            { id: 'zoneBot', tipo: 'float', def: 0, titulo: 'Zona BOTTOM', grupo: '📦 ZONA MANUAL (precios)', step: 0.00001, min: 0 },
            { id: 'zoneIsOB', tipo: 'bool', def: true, titulo: 'Tipo de zona: Order Block  (desmarcar = FVG)', grupo: '📦 ZONA MANUAL (precios)' },
            { id: 'zoneIsBull', tipo: 'bool', def: true, titulo: 'Dirección: ALCISTA / LONG  (desmarcar = Bajista / SHORT)', grupo: '📦 ZONA MANUAL (precios)' },
        ],
    };

    function crear({ chart, getSymbol, getTimeframe, getRectangulo, onCambio }) {
        registrar();
        NLTCharts.settings.registrar(ZE, AJUSTES);
        const esc = NLTCharts.ui.esc;
        let catalogo = null;
        let error = '';
        let ver = leerPref();
        let dibujado = false;
        let manual = null;       // resultado de la zona manual
        let zonaManual = null;   // { top, bottom, desde, esOB, alcista } -- desde el rectángulo
        const zonaDeAjustes = () => {
            const a = NLTCharts.settings.valores(ZE);
            return a.zoneTop > 0 && a.zoneBot > 0 && a.zoneTop > a.zoneBot
                ? { top: a.zoneTop, bottom: a.zoneBot, esOB: a.zoneIsOB, alcista: a.zoneIsBull, desde: null } : null;
        };
        let timer = null;
        let tipoSel = 'ob', dirSel = 'bull';

        const zeAcceso = () => {
            const ze = catalogo && catalogo.indicators.find((i) => i.id === ZE);
            return ze ? ze.access : null;
        };

        function mostrarEnGrafico(si) {
            if (si && !dibujado) { chart.createIndicator({ name: 'NLT_PRO_ZONES', paneId: 'candle_pane' }, true); dibujado = true; }
            if (!si && dibujado) { chart.removeIndicator({ name: 'NLT_PRO_ZONES' }); dibujado = false; zonas = []; }
        }

        async function cargarCatalogo() {
            try {
                catalogo = await NLT_API.chartsProCatalogo();
                error = '';
            } catch (err) {
                error = err.message;
            }
            onCambio && onCambio();
        }

        async function refrescar() {
            clearTimeout(timer);
            const acc = zeAcceso();
            if (!ver || !acc || !acc.has_access) { mostrarEnGrafico(false); return; }
            if (document.visibilityState !== 'visible') { timer = setTimeout(refrescar, REFRESCO_MS); return; }
            try {
                const r = await NLT_API.chartsZoneEngine(getSymbol(), getTimeframe(), zonaManual || zonaDeAjustes());
                zonas = r.zones || [];
                manual = r.manual_zone;
                mostrarEnGrafico(true);
                // repinta con los datos nuevos
                chart.overrideIndicator({ name: 'NLT_PRO_ZONES', extendData: { t: Date.now() } });
                error = '';
            } catch (err) {
                error = err.message;
                if (/Necesitás|plan|prueba/i.test(err.message)) { ver = false; mostrarEnGrafico(false); await cargarCatalogo(); }
            }
            onCambio && onCambio();
            timer = setTimeout(refrescar, REFRESCO_MS);
        }

        function seccionZoneEngine(ind) {
            const acc = ind.access;
            let cuerpo;
            if (acc.has_access) {
                const origen = acc.reason === 'trial' ? `Prueba gratis · ${esc(tiempoRestante(acc.trial_expires_at))}` :
                    acc.reason === 'admin' ? 'Acceso de administrador' : 'Incluido en tu plan';
                cuerpo = `
                    <label class="ch-ind" style="padding-left:0">
                        <input type="checkbox" data-pro-ver${ver ? ' checked' : ''}>
                        <span><span class="ch-ind-name block">Mostrar en el gráfico</span><span class="ch-ind-desc">${origen}</span></span>
                    </label>
                    <div class="ch-pro-manual">
                        <p class="ch-ind-desc" style="margin-bottom:6px">Zona manual: dibujá un rectángulo y analizalo con el motor.</p>
                        <div style="display:flex; gap:6px; flex-wrap:wrap">
                            <select data-pro-tipo class="ch-select" style="font-size:12px"><option value="ob">Order Block</option><option value="fvg"${tipoSel === 'fvg' ? ' selected' : ''}>FVG</option></select>
                            <select data-pro-dir class="ch-select" style="font-size:12px"><option value="bull">Alcista</option><option value="bear"${dirSel === 'bear' ? ' selected' : ''}>Bajista</option></select>
                            <button type="button" data-pro-analizar class="ch-btn">Analizar rectángulo</button>
                        </div>
                        ${manual ? `<p class="ch-ind-desc" style="margin-top:8px; color:#E5E7EB">Estado: <strong>${esc(manual.status)}</strong> · ${esc(manual.touches)} toques${manual.in_zone ? ' · precio en la zona' : manual.near ? ' · precio cerca' : ''}${manual.inverse_fvg ? ' · FVG invertido' : ''}</p>` : ''}
                    </div>`;
            } else if (acc.trial_status === 'NOT_STARTED' && ind.trial) {
                cuerpo = `<button type="button" data-pro-trial class="ch-btn" style="margin-top:6px">Probar ${esc(ind.trial.days)} días gratis</button>`;
            } else if (acc.trial_status === 'EXPIRED') {
                cuerpo = `<p class="ch-ind-desc" style="margin-top:4px">Tu prueba gratis terminó.</p>
                          <a href="indicator.html" class="ch-btn" style="margin-top:6px; display:inline-flex">Ver planes de NLT Indicator</a>`;
            } else {
                cuerpo = `<a href="indicator.html" class="ch-btn" style="margin-top:6px; display:inline-flex">Ver planes de NLT Indicator</a>`;
            }
            return `<div class="ch-pro"><div class="ch-pro-head"><span class="ch-ind-name">${esc(ind.name)}</span>${acc.has_access ? '<button type="button" class="ch-gear" data-pro-gear title="Configuración" aria-label="Configuración del Zone Engine"><i class="ph ph-gear-six"></i></button>' : '<span class="ch-lock">PRO</span>'}</div>
                    <p class="ch-ind-desc">${esc(ind.description)}</p>${cuerpo}</div>`;
        }

        function seccionProximamente(ind) {
            const extra = ind.access && ind.access.free_analyses_left != null
                ? ` · ${esc(ind.access.free_analyses_left)} análisis gratis cuando esté disponible` : '';
            return `<div class="ch-pro"><div class="ch-pro-head"><span class="ch-ind-name">${esc(ind.name)}</span><span class="ch-lock">PRÓXIMAMENTE</span></div>
                    <p class="ch-ind-desc">${esc(ind.description)}${extra}</p></div>`;
        }

        const api = {
            iniciar() { return cargarCatalogo().then(refrescar); },
            refrescar,
            renderSeccion(el) {
                if (!catalogo) {
                    el.innerHTML = `<p class="ch-grupo">PRO</p><p class="ch-ind-desc" style="padding:0 8px">${error ? esc(error) : 'Cargando...'}</p>`;
                    return;
                }
                el.innerHTML = '<p class="ch-grupo">PRO</p>' + catalogo.indicators.map((ind) =>
                    ind.id === ZE && ind.status === 'available' ? seccionZoneEngine(ind) : seccionProximamente(ind)).join('') +
                    (error ? `<p class="ch-ind-desc" style="color:rgb(248,113,113); padding:0 8px">${esc(error)}</p>` : '');

                const cb = el.querySelector('[data-pro-ver]');
                if (cb) cb.addEventListener('change', () => { ver = cb.checked; guardarPref(ver); refrescar(); });
                const bt = el.querySelector('[data-pro-trial]');
                if (bt) bt.addEventListener('click', async () => {
                    bt.disabled = true;
                    try {
                        await NLT_API.chartsProIniciarTrial(ZE);
                        ver = true; guardarPref(true);
                        await cargarCatalogo();
                        await refrescar();
                    } catch (err) { error = err.message; onCambio && onCambio(); }
                });
                const gear = el.querySelector('[data-pro-gear]');
                if (gear) gear.addEventListener('click', () => {
                    document.getElementById('chPanel').hidden = true;
                    document.getElementById('chPanelBg').hidden = true;
                    // La zona de los ajustes reemplaza a la del rectángulo.
                    NLTCharts.settings.abrir(ZE, () => { zonaManual = null; ver = true; guardarPref(true); refrescar(); });
                });
                const an = el.querySelector('[data-pro-analizar]');
                if (an) an.addEventListener('click', () => {
                    const r = getRectangulo();
                    if (!r) { error = 'Primero dibujá un rectángulo sobre la zona.'; onCambio && onCambio(); return; }
                    tipoSel = el.querySelector('[data-pro-tipo]').value;
                    dirSel = el.querySelector('[data-pro-dir]').value;
                    zonaManual = { ...r, esOB: tipoSel === 'ob', alcista: dirSel === 'bull' };
                    ver = true; guardarPref(true);
                    refrescar();
                });
            },
            tieneAcceso() { const a = zeAcceso(); return !!(a && a.has_access); },
            conectarZona() { /* bloque G */ },
            zonaMovida() { /* bloque G */ },
            // Al cambiar de símbolo la zona manual deja de aplicar.
            cambioDeSimbolo() { zonaManual = null; manual = null; refrescar(); },
        };
        return api;
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.pro = { crear };
})();
