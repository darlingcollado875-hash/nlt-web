/* NLT Charts -- NLT AI: el indicador con IA, trabajando DESDE el gráfico (sin alertas ni webhooks).
 *
 * Flujo: marcas una zona (rectángulo → «NLT Engine») → NLT AI la analiza con IA en el servidor (el motor del NLT Zone Engine
 * corre allí, así que no hace falta ninguna alerta) → en el gráfico aparece un AVISO con el resumen («Entrada óptima»,
 * «Entrada no válida»…) y el reporte completo queda en «Reportes» (visor dentro del gráfico y panel NLT Indicator).
 * El navegador solo pide el estado y el análisis; nunca el payload ni los scores internos del motor. */
(function () {
    const ID = 'NLT_INDICATOR_AI';
    // Con un análisis en curso ("sent") se consulta cada 5 s hasta que llega. Si no, el panel se
    // actualiza con cada cálculo del Zone Engine (vela nueva, zona movida) y solo por las dudas cada
    // 5 min: cada consulta hace que el servidor recalcule el motor con sus series externas.
    const REFRESCO_MS = 5000;               // mientras la IA analiza: se pregunta cada 5 s hasta que llega
    const REFRESCO_LENTO_MS = 300000;
    const POSICIONES = ['Top Left', 'Top Right', 'Bottom Left', 'Bottom Right'].map((p) => ({ v: p, t: p }));
    const INPUTS = [
        {
            id: 'modo', tipo: 'string', def: 'Zona manual', titulo: 'Cuándo analizar', grupo: 'Eventos del NLT Zone Engine', recalc: false,
            opciones: [{ v: 'Zona manual', t: 'Zona manual' }, { v: 'Eventos auto', t: 'Eventos auto (ENTRY_READY)' }, { v: 'Ambos', t: 'Ambos' }],
            tooltip: '"Zona manual": cuando cambia la zona manual del Zone Engine. "Eventos auto": en cada ENTRY_READY del motor. Igual que "Cuándo emitir" de V13.4.',
        },
        { id: 'posicion', tipo: 'string', def: 'Bottom Right', titulo: 'Posición del panel', grupo: 'Panel', opciones: POSICIONES, recalc: false },
    ];
    const ESTADOS = {
        coming_soon: ['#9CA3AF', 'PRÓXIMAMENTE', 'El análisis con IA llega con NLT Indicator AI.'],
        no_access: ['#9CA3AF', 'SIN ACCESO', 'Necesitas NLT Indicator AI (o análisis gratis).'],
        no_zone: ['#D29922', 'SIN ZONA', 'Dibuja un rectángulo y toca «NLT Engine» para analizarlo.'],
        waiting: ['#3FB950', '● LISTA', ''],
        sent: ['#4378FF', '◌ ANALIZANDO', 'La IA está analizando la zona…'],
        pipeline_unavailable: ['#D29922', 'EVENTO LISTO', 'El análisis con IA todavía no está activo.'],
        already_analyzed: ['#3FB950', '● ANALIZADA', ''],
        invalid: ['#F85149', 'ERROR', 'El evento no se pudo analizar.'],
    };
    const COLOR_VEREDICTO = (v) => (/INVALID|AVOID|NO_/.test(v || '') ? '#F85149' : /WAIT|WATCH|CONFIRM/.test(v || '') ? '#D29922' : '#3FB950');

    function crear({ getSymbol, getTimeframe, pro, onCambio }) {
        const S = NLTCharts.settings, state = NLTCharts.state, esc = NLTCharts.ui.esc;
        S.registrar(ID, { titulo: '🌐 NLT AI', inputs: INPUTS });
        let ver = !!state.prefs().nltAiVer;
        let datos = null, error = '', seq = 0, timer = null, firma = '';
        let vistoId = null, pidioAnalisis = 0;       // vistoId: último análisis ya visto (null = aún no se leyó nada); pidioAnalisis: hora en que el usuario pidió uno

        const hora = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const nonce = () => (state.prefs().nltAiNonce || {})[getSymbol()] || 0;

        // Un solo pedido a la vez: si llega otro aviso mientras hay uno en curso, se repite UNA vez al terminar.
        let enCurso = false, otraVez = false;
        async function refrescar() {
            clearTimeout(timer);
            if (!ver) { pintar(); return; }
            if (NLTCharts.market.enReplay && NLTCharts.market.enReplay()) { datos = null; error = 'NLT AI está en pausa durante el Bar Replay.'; pintar(); return; }
            if (NLTCharts.market.enHistorico && NLTCharts.market.enHistorico()) { datos = null; error = 'NLT AI analiza el mercado en vivo: en pausa mientras mirás el histórico.'; pintar(); return; }
            if (!pro.tieneAcceso()) { datos = null; error = 'NLT AI recibe los eventos del NLT Zone Engine: actívalo primero.'; pintar(); return; }
            if (enCurso) { otraVez = true; return; }
            enCurso = true;
            const n = ++seq;
            // Generación del dataset al pedir: si mientras tanto se entró al replay (o cambió símbolo/timeframe),
            // la respuesta es del vivo / de otro gráfico y NO se muestra (antes quedaba pintada en el replay).
            const gen = NLTCharts.market.generacion ? NLTCharts.market.generacion() : 0;
            try {
                const modo = pidioAnalisis && Date.now() - pidioAnalisis < 25000 ? 'Ambos' : S.valores(ID).modo;      // «Analizar zona» funciona aunque estés en «Eventos auto»
                const r = await NLT_API.chartsNltAi(getSymbol(), getTimeframe(), pro.entradasActuales(), modo, nonce());
                if (n !== seq) { enCurso = false; return; }
                if (NLTCharts.market.generacion && gen !== NLTCharts.market.generacion()) { enCurso = false; programar(0); return; }
                datos = r; error = '';
            } catch (err) {
                if (n !== seq) { enCurso = false; return; }
                if (NLTCharts.market.generacion && gen !== NLTCharts.market.generacion()) { enCurso = false; programar(0); return; }
                error = err.message;
            }
            enCurso = false;
            pintar();
            revisarAviso();
            onCambio && onCambio();
            clearTimeout(timer);
            if (otraVez) { otraVez = false; timer = setTimeout(refrescar, 0); } else timer = setTimeout(refrescar, datos && datos.status === 'sent' ? REFRESCO_MS : REFRESCO_LENTO_MS);
        }
        const programar = (ms) => { clearTimeout(timer); timer = setTimeout(refrescar, ms); };
        pro.alRefrescar(() => { if (ver) programar(150); });   // cada cálculo del Zone Engine (vela nueva, zona movida...)

        function fila(l, v, c) {
            return `<tr><td style="color:rgba(156,163,175,.9)">${esc(l)}</td><td style="color:${c || 'rgba(229,231,235,.9)'}">${esc(v)}</td></tr>`;
        }
        function htmlPanel() {
            const R = window.NLTAiReporte;
            const st = datos && ESTADOS[datos.status];
            const z = pro.zonaActual();
            const an = datos && datos.analysis;
            const res = an && R ? R.resumen(an) : null;
            const analizando = datos && datos.status === 'sent' && !res;
            const f = NLTCharts.drawings.formatear;
            const estado = error ? 'ERROR' : analizando ? 'ANALIZANDO…' : res ? res.titulo.toUpperCase() : st ? st[1] : 'cargando…';
            const colorEstado = error ? '#F85149' : res ? res.color : st ? st[0] : '#9CA3AF';
            return `<table class="ze-tabla ze-nlt${minimizado() ? ' ze-min' : ''}">
                <tr class="ze-hdr" data-nltai="minimizar" title="Toca para minimizar o expandir" style="background:rgba(67,120,255,.12)"><td style="color:#fff">🌐 NLT AI</td>
                    <td style="color:${colorEstado}">${esc(estado)}</td></tr>
                ${fila('Zona', z ? `${z.esOB ? 'OB' : 'FVG'} · ${z.alcista ? 'LONG' : 'SHORT'}` : '—', z ? (z.alcista ? '#3FB950' : '#F85149') : '#6B7280')}
                ${z ? fila('Precio', `${f(z.top)} → ${f(z.bottom)}`) : ''}
                ${res ? fila('Calidad', [res.calidad, res.score != null ? `${res.score}%` : null].filter(Boolean).join(' · ') || '—') : ''}
                ${res && res.motivo ? `<tr><td colspan="2" style="white-space:normal; max-width:260px; color:rgba(229,231,235,.85)">${esc(res.motivo)}</td></tr>` : ''}
                ${error || (st && st[2] && !res && !analizando) ? `<tr><td colspan="2" style="color:rgba(156,163,175,.8); white-space:normal; max-width:260px">${esc(error || st[2])}</td></tr>` : ''}
                <tr><td colspan="2" style="padding-top:6px"><span class="ze-btns">
                    ${z ? `<button type="button" data-nltai="analizar" class="ze-btn on"${analizando ? ' disabled' : ''}>${analizando ? 'Analizando…' : (res ? 'Analizar de nuevo' : 'Analizar zona')}</button>` : ''}
                    <button type="button" data-nltai="reportes" class="ze-btn">Reportes</button></span></td></tr>
            </table>`;
        }
        // Minimizado (solo la cabecera con el estado): lo elige el usuario tocando la cabecera, igual que el
        // panel del Zone Engine. Por defecto, minimizado en pantallas chicas para no tapar el otro panel.
        function minimizado() {
            const m = state.prefs().nltAiMin;
            return typeof m === 'boolean' ? m : window.innerWidth < 900;
        }
        function alternarMinimizado() {
            state.savePrefs({ nltAiMin: !minimizado() });
            firma = ''; pintar();
        }
        function pintar() {
            const T = NLTCharts.ui.tablero;
            if (!ver) { T.quitar('nlt-ai'); firma = ''; return; }
            const html = htmlPanel();
            if (html === firma) return;
            firma = html;
            const el = T.slot(S.valores(ID).posicion, 'nlt-ai');
            if (el && !el.dataset.oyente) {
                el.dataset.oyente = '1';
                el.addEventListener('click', (ev) => {
                    const b = ev.target.closest('[data-nltai]'); if (!b) return;
                    const acc = b.dataset.nltai;
                    if (acc === 'minimizar') alternarMinimizado();
                    else if (acc === 'analizar') pedirNuevo();
                    else if (acc === 'reportes') abrirReportes();
                });
            }
            if (el) el.innerHTML = `<div class="ud-dash">${html}</div>`;
        }

        // ───────────── aviso en el gráfico: el resumen del reporte ─────────────
        let aviso = null, avisoTimer = null;
        function elAviso() {
            if (aviso && aviso.isConnected) return aviso;
            const host = document.querySelector('.ch-stage');
            if (!host) return null;
            aviso = document.createElement('div');
            aviso.className = 'air-pop'; aviso.setAttribute('role', 'status'); aviso.setAttribute('aria-live', 'polite');
            aviso.addEventListener('click', (e) => {
                if (e.target.closest('[data-air="x"]')) { cerrarAviso(); return; }
                if (e.target.closest('[data-air="ver"]')) { const id = aviso.dataset.id; cerrarAviso(); abrirReportes(id); }
            });
            aviso.addEventListener('mouseenter', () => { clearTimeout(avisoTimer); aviso.classList.remove('auto'); });
            aviso.addEventListener('mouseleave', () => { if (!aviso.classList.contains('cargando')) programarCierre(6000); });
            host.appendChild(aviso);
            return aviso;
        }
        function cerrarAviso() { clearTimeout(avisoTimer); if (aviso) { aviso.classList.remove('on', 'auto'); } }
        function programarCierre(ms) {
            clearTimeout(avisoTimer);
            if (!aviso) return;
            aviso.style.setProperty('--air-t', `${ms}ms`);
            aviso.classList.remove('auto'); void aviso.offsetWidth; aviso.classList.add('auto');
            avisoTimer = setTimeout(cerrarAviso, ms);
        }
        function avisoAnalizando() {
            const el = elAviso(); if (!el) return;
            el.style.setProperty('--air-c', '#8fb1ff'); el.classList.add('cargando'); el.classList.remove('auto'); el.dataset.id = '';
            el.innerHTML = `<span class="air-ico"><i class="ph ph-circle-notch"></i></span><div class="air-pop-t"><b>Analizando la zona…</b><span>NLT AI está revisando estructura, liquidez y confluencias</span></div>
                <div class="air-pop-a"><button type="button" class="air-pop-x" data-air="x" aria-label="Cerrar"><i class="ph ph-x"></i></button></div>`;
            requestAnimationFrame(() => el.classList.add('on'));
            clearTimeout(avisoTimer); avisoTimer = setTimeout(cerrarAviso, 120000);
        }
        function avisoResumen(a) {
            const R = window.NLTAiReporte, r = R && R.resumen(a), el = elAviso(); if (!r || !el) return;
            el.classList.remove('cargando'); el.style.setProperty('--air-c', r.color); el.dataset.id = a.analysis_id || '';
            const linea = [r.simbolo || getSymbol(), r.direccion, r.calidad, r.score != null ? `${r.score}%` : null].filter(Boolean).join(' · ');
            el.innerHTML = `<span class="air-ico"><i class="${r.icono}"></i></span>
                <div class="air-pop-t"><b>${esc(r.titulo)}</b><span>${esc(linea)}</span>${r.motivo ? `<em>${esc(r.motivo)}</em>` : ''}</div>
                <div class="air-pop-a"><button type="button" class="air-pop-x" data-air="x" aria-label="Cerrar"><i class="ph ph-x"></i></button><button type="button" class="air-pop-ver" data-air="ver">Ver reporte</button></div>`;
            requestAnimationFrame(() => { el.classList.add('on'); programarCierre(14000); });
        }
        // Aviso solo cuando llega un análisis NUEVO (el que ya estaba al abrir el gráfico no vuelve a saltar).
        function revisarAviso() {
            const a = datos && datos.analysis;
            if (a && a.analysis_id) {
                if (vistoId === null) { vistoId = a.analysis_id; return; }
                if (a.analysis_id !== vistoId) { vistoId = a.analysis_id; pidioAnalisis = 0; avisoResumen(a); return; }
            } else if (vistoId === null && datos) vistoId = '';
            if (datos && datos.status === 'sent' && !(a && a.analysis_id !== undefined && a.analysis_id === vistoId && vistoId !== '')) {
                const reciente = (datos.last_sent && Date.now() - datos.last_sent.at < 150000) || (pidioAnalisis && Date.now() - pidioAnalisis < 150000);
                if (reciente && !(aviso && aviso.classList.contains('on') && !aviso.classList.contains('cargando'))) avisoAnalizando();
            } else if (aviso && aviso.classList.contains('cargando') && !(datos && datos.status === 'sent')) cerrarAviso();
        }

        // ───────────── Reportes: visor dentro del gráfico (lista + reporte completo) ─────────────
        let visor = null;
        function abrirReportes(idInicial) {
            const R = window.NLTAiReporte;
            if (!R) return;
            if (!visor) {
                visor = document.createElement('div');
                visor.className = 'air-modal'; visor.hidden = true; visor.setAttribute('role', 'dialog'); visor.setAttribute('aria-label', 'Reportes de NLT AI');
                visor.addEventListener('click', (e) => {
                    if (e.target === visor || e.target.closest('[data-air="cerrar"]')) { visor.hidden = true; return; }
                    if (e.target.closest('[data-air="lista"]')) { cargarLista(); return; }
                    const f = e.target.closest('[data-air-id]'); if (f) verReporte(f.dataset.airId);
                });
                document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && visor && !visor.hidden) visor.hidden = true; });
                document.body.appendChild(visor);
            }
            const marco = (titulo, atras, cuerpo) => {
                visor.innerHTML = `<div class="air-card"><header>${atras ? '<button type="button" data-air="lista" aria-label="Volver a la lista"><i class="ph ph-arrow-left"></i></button>' : ''}<h2><i class="ph-fill ph-sparkle"></i> ${esc(titulo)}</h2>
                    <a href="indicator-dashboard.html" target="_blank" rel="noopener" class="air-enlace"><button type="button">Abrir en el panel</button></a><button type="button" data-air="cerrar" aria-label="Cerrar"><i class="ph ph-x"></i></button></header>
                    <div class="air-cuerpo">${cuerpo}</div></div>`;
            };
            async function cargarLista() {
                marco('Reportes de NLT AI', false, '<p class="air-vacio">Cargando tus reportes…</p>');
                try {
                    const { items } = await NLT_API.indicatorAiHistorial({ limit: 50 });
                    marco('Reportes de NLT AI', false, items.length ? items.map(R.fila).join('') : '<p class="air-vacio">Todavía no hay reportes. Dibuja una zona, tócala con «NLT Engine» y pulsa <b>Analizar zona</b>: el reporte aparecerá aquí.</p>');
                } catch (e) { marco('Reportes de NLT AI', false, `<p class="air-vacio">${esc(e.message || 'No se pudieron cargar los reportes.')}</p>`); }
            }
            async function verReporte(id) {
                marco('Reporte', true, '<p class="air-vacio">Cargando el reporte…</p>');
                try { marco('Reporte', true, R.html(await NLT_API.indicatorAiAnalisis(id))); }
                catch (e) { marco('Reporte', true, `<p class="air-vacio">${esc(e.message || 'No se pudo abrir el reporte.')}</p>`); }
            }
            visor.hidden = false;
            if (idInicial) verReporte(idInicial); else cargarLista();
        }

        function alternar(si) {
            ver = !!si;
            state.savePrefs({ nltAiVer: ver });
            ver ? refrescar() : pintar();
            onCambio && onCambio();
        }
        function pedirNuevo() {
            pidioAnalisis = Date.now();
            state.savePrefs({ nltAiNonce: { ...(state.prefs().nltAiNonce || {}), [getSymbol()]: nonce() + 1 } });
            refrescar();
        }
        function abrirAjustes() {
            const e = S.esquema(ID);
            S.abrirDialogo({
                titulo: e.titulo, inputs: e.inputs, valores: S.valores(ID),
                alAceptar: (v) => { S.guardar(ID, v); firma = ''; pintar(); refrescar(); },
                botones: [{ id: 'nuevo', texto: 'Pedir nuevo análisis de esta zona', accion: () => pedirNuevo() }],
            });
        }

        // Tarjeta en la sección PRO del panel de indicadores (separada de la del Zone Engine).
        function htmlSeccion(ind, fav) {
            const acc = ind.access || {};
            const pronto = ind.status !== 'available';
            const extra = pronto && acc.free_analyses_left != null ? ` · ${esc(acc.free_analyses_left)} análisis gratis cuando esté disponible` : '';
            return `<div class="ch-pro" data-pro-card="${ID}">
                <div class="ch-pro-head"><span class="ch-ind-name">🌐 NLT AI</span>
                    <span style="display:flex; align-items:center; gap:4px">
                        <button type="button" class="ch-gear ch-ind-star${fav ? ' on' : ''}" data-fav-ind="${ID}" title="${fav ? 'Quitar de favoritos' : 'Agregar a favoritos'}" aria-label="Favorito NLT AI"><i class="${fav ? 'ph-fill' : 'ph'} ph-star"></i></button>
                        <button type="button" class="ch-gear" data-nltai-gear title="Configuración" aria-label="Configuración de NLT AI"><i class="ph ph-gear-six"></i></button>
                        ${pronto ? '<span class="ch-lock">PRÓXIMAMENTE</span>' : '<button type="button" class="ch-gear" data-nltai-guia title="Ver guía" aria-label="Ver guía de uso"><i class="ph ph-question"></i></button>'}
                    </span></div>
                <p class="ch-ind-desc">Marca una zona, pulsa «Analizar zona» y la IA te dice si la entrada es válida: resumen en el gráfico y reporte completo en «Reportes». No necesita alertas ni webhooks.${extra}</p>
                <label class="ch-ind" style="padding-left:0; margin-top:6px">
                    <input type="checkbox" data-nltai-ver${ver ? ' checked' : ''}>
                    <span><span class="ch-ind-name block">Mostrar panel NLT AI</span><span class="ch-ind-desc">Estado de tu zona, botón para analizar y acceso a los reportes</span></span>
                </label></div>`;
        }
        function enlazar(el) {
            const cb = el.querySelector('[data-nltai-ver]');
            if (cb) cb.addEventListener('change', () => alternar(cb.checked));
            const gu = el.querySelector('[data-nltai-guia]');
            if (gu) gu.addEventListener('click', () => { if (window.NLTGuiaPro) window.NLTGuiaPro.iniciar('ai'); });
            const g = el.querySelector('[data-nltai-gear]');
            if (g) g.addEventListener('click', () => {
                document.getElementById('chPanel').hidden = true;
                document.getElementById('chPanelBg').hidden = true;
                abrirAjustes();
            });
        }

        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ver) programar(300); });

        return {
            id: ID, htmlSeccion, enlazar, alternar, abrirAjustes, pedirNuevo,
            visible: () => ver,
            iniciar() { if (ver) programar(800); },
            cambioDeSimbolo() { datos = null; firma = ''; vistoId = null; cerrarAviso(); pintar(); if (ver) programar(700); },
            abrirReportes,
        };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.nltAi = { crear, ID };
})();
