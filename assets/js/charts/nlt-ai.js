/* NLT Charts -- NLT AI: indicador APARTE del NLT Zone Engine.
 *
 * El Zone Engine (V13.3.3, el que se vende sin IA) dibuja zonas, estados y
 * su panel. NLT AI es otro producto: recibe los EVENTOS del Zone Engine
 * (cambio de zona manual, ENTRY_READY) y muestra el análisis por IA en su
 * propio panel. En TradingView eso requería una alerta con webhook (V13.4);
 * acá el motor corre en el servidor, así que el servidor detecta el evento
 * y le manda el payload a NLT Indicator AI (Claude) sin que el usuario
 * configure nada. El navegador solo pide el estado: eventos, último envío
 * y análisis -- nunca el payload ni los scores del motor.
 *
 * Hoy NLT Indicator AI figura "próximamente" en el catálogo: el panel
 * muestra los eventos del motor y el estado, sin análisis. */
(function () {
    const ID = 'NLT_INDICATOR_AI';
    // Con un análisis en curso ("sent") se consulta cada 30 s hasta que llega. Si no, el panel se
    // actualiza con cada cálculo del Zone Engine (vela nueva, zona movida) y solo por las dudas cada
    // 5 min: cada consulta hace que el servidor recalcule el motor con sus series externas.
    const REFRESCO_MS = 30000;
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
        no_access: ['#9CA3AF', 'SIN ACCESO', 'Necesitás NLT Indicator AI (o análisis gratis).'],
        no_zone: ['#D29922', 'SIN ZONA', 'Marcá una zona manual en el NLT Zone Engine.'],
        waiting: ['#3FB950', '● LIVE · zona enviada', ''],
        sent: ['#4378FF', '⇧ ENVIADO', 'Analizando…'],
        pipeline_unavailable: ['#D29922', 'EVENTO LISTO', 'El análisis con IA todavía no está activo.'],
        already_analyzed: ['#3FB950', '● LIVE · ya analizada', ''],
        invalid: ['#F85149', 'ERROR', 'El evento no se pudo analizar.'],
    };
    const COLOR_VEREDICTO = (v) => (/INVALID|AVOID|NO_/.test(v || '') ? '#F85149' : /WAIT|WATCH|CONFIRM/.test(v || '') ? '#D29922' : '#3FB950');

    function crear({ getSymbol, getTimeframe, pro, onCambio }) {
        const S = NLTCharts.settings, state = NLTCharts.state, esc = NLTCharts.ui.esc;
        S.registrar(ID, { titulo: '🌐 NLT AI', inputs: INPUTS });
        let ver = !!state.prefs().nltAiVer;
        let datos = null, error = '', seq = 0, timer = null, firma = '';

        const hora = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const nonce = () => (state.prefs().nltAiNonce || {})[getSymbol()] || 0;

        // Un solo pedido a la vez: si llega otro aviso mientras hay uno en curso, se repite UNA vez al terminar.
        let enCurso = false, otraVez = false;
        async function refrescar() {
            clearTimeout(timer);
            if (!ver) { pintar(); return; }
            if (!pro.tieneAcceso()) { datos = null; error = 'NLT AI recibe los eventos del NLT Zone Engine: activalo primero.'; pintar(); return; }
            if (enCurso) { otraVez = true; return; }
            enCurso = true;
            const n = ++seq;
            try {
                const r = await NLT_API.chartsNltAi(getSymbol(), getTimeframe(), pro.entradasActuales(), S.valores(ID).modo, nonce());
                if (n !== seq) { enCurso = false; return; }
                datos = r; error = '';
            } catch (err) {
                if (n !== seq) { enCurso = false; return; }
                error = err.message;
            }
            enCurso = false;
            pintar();
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
            const st = datos && ESTADOS[datos.status];
            const z = pro.zonaActual();
            const ev = datos && datos.events.length ? datos.events[datos.events.length - 1] : null;
            const env = datos && datos.last_sent;
            const f = NLTCharts.drawings.formatear;
            return `<table class="ze-tabla ze-nlt${minimizado() ? ' ze-min' : ''}">
                <tr class="ze-hdr" data-nltai="minimizar" title="Tocá para minimizar o expandir" style="background:rgba(67,120,255,.12)"><td style="color:#fff">🌐 NLT AI</td>
                    <td style="color:${st ? st[0] : '#9CA3AF'}">${esc(error ? 'ERROR' : st ? st[1] : 'cargando…')}</td></tr>
                ${fila('Zona', z ? `${z.esOB ? 'OB' : 'FVG'} · ${z.alcista ? 'LONG' : 'SHORT'}` : '—', z ? (z.alcista ? '#3FB950' : '#F85149') : '#6B7280')}
                ${z ? fila('Precio', `${f(z.top)} → ${f(z.bottom)}`) : ''}
                ${fila('Evento del motor', ev ? `${ev.event} ${ev.dir} · ${hora(ev.time)}` : '—')}
                ${fila('Último envío', env ? `${hora(env.at)} (${env.event})` : '—')}
                ${htmlAnalisis(datos && datos.analysis)}
                ${error || (st && st[2] && !(datos && datos.analysis)) ? `<tr><td colspan="2" style="color:rgba(156,163,175,.8); white-space:normal; max-width:260px">${esc(error || st[2])}</td></tr>` : ''}
            </table>`;
        }
        // Resultado de NLT AI (Claude + motor cuantitativo): veredicto, calidad, explicación y listas.
        function htmlAnalisis(a) {
            if (!a) return fila('Análisis IA', '—');
            const lista = (titulo, xs, c) => (xs && xs.length ? `<tr><td colspan="2" style="white-space:normal; max-width:280px; color:${c}"><span style="color:rgba(156,163,175,.9)">${esc(titulo)}:</span> ${xs.map(esc).join(' · ')}</td></tr>` : '');
            return `${fila('Veredicto', a.verdict || '—', COLOR_VEREDICTO(a.verdict))}
                ${fila('Calidad', [a.quality, a.category].filter(Boolean).join(' · ') || '—')}
                ${fila('Score IA', a.score != null ? `${Math.round(a.score)} / 100` : '—')}
                ${fila('Riesgo · R/R', [a.risk_level, a.rr_quality].filter(Boolean).join(' · ') || '—')}
                ${a.explanation ? `<tr><td colspan="2" style="white-space:normal; max-width:280px; color:rgba(229,231,235,.9)">${esc(a.explanation)}</td></tr>` : ''}
                ${lista('A favor', a.confluences, '#3FB950')}
                ${lista('Advertencias', a.warnings, '#D29922')}
                ${lista('Falta confirmar', a.confirmation_required, 'rgba(229,231,235,.85)')}
                ${lista('Invalida', a.invalidation, '#F85149')}
                ${a.ai_called ? '' : fila('Modo', 'solo cuantitativo (sin IA)', '#9CA3AF')}`;
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
                el.addEventListener('click', (ev) => { if (ev.target.closest('[data-nltai="minimizar"]')) alternarMinimizado(); });
            }
            if (el) el.innerHTML = `<div class="ud-dash">${html}</div>`;
        }

        function alternar(si) {
            ver = !!si;
            state.savePrefs({ nltAiVer: ver });
            ver ? refrescar() : pintar();
            onCambio && onCambio();
        }
        function pedirNuevo() {
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
                        ${pronto ? '<span class="ch-lock">PRÓXIMAMENTE</span>' : ''}
                    </span></div>
                <p class="ch-ind-desc">Indicador aparte del Zone Engine: recibe sus eventos (zona manual, ENTRY_READY) y los analiza con IA en su propio panel.${extra}</p>
                <label class="ch-ind" style="padding-left:0; margin-top:6px">
                    <input type="checkbox" data-nltai-ver${ver ? ' checked' : ''}>
                    <span><span class="ch-ind-name block">Mostrar panel NLT AI</span><span class="ch-ind-desc">Eventos del NLT Zone Engine y estado del análisis</span></span>
                </label></div>`;
        }
        function enlazar(el) {
            const cb = el.querySelector('[data-nltai-ver]');
            if (cb) cb.addEventListener('change', () => alternar(cb.checked));
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
            cambioDeSimbolo() { datos = null; firma = ''; pintar(); if (ver) programar(700); },
        };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.nltAi = { crear, ID };
})();
