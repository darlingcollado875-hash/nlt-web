/* NLT Charts -- panel «Trade» estilo MT5 (el de la app del teléfono): saldo, equity, margen y, sobre todo, tus posiciones
 * con lo que vas ganando o perdiendo en vivo, y tus órdenes pendientes. Vive pegado abajo del gráfico: plegado es una barra
 * fina (cuenta, saldo y ganancia/pérdida abierta); al tocarla sube y muestra todo.
 * Fuentes: la cuenta REAL conectada (trader.js) y el SIMULADOR (paper.js). Cada una expone datosPanel() y sus acciones. */
(function () {
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    const dinero = (n) => { const v = num(n); return v == null ? '—' : `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
    const conSigno = (n) => { const v = num(n); return v == null ? '—' : `${v >= 0 ? '+' : '−'}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
    const clase = (n) => { const v = num(n) || 0; return v > 0.004 ? 'gan' : v < -0.004 ? 'per' : ''; };
    const TIPO = { limit: 'límite', stop: 'stop', stop_limit: 'stop límite' };

    function montar({ mainEl, state, getSymbol }) {
        if (!mainEl) return null;
        const prefs = () => { try { return state.prefs(); } catch (_) { return {}; } };
        const guardar = (o) => { try { state.savePrefs(o); } catch (_) { /* sin preferencias */ } };
        let fuente = prefs().panelTradeFuente === 'sim' ? 'sim' : 'real';
        let abierto = !!prefs().panelTradeAbierto, tab = 'pos', fila = null, armado = null, aviso = '', timerAviso = null, ultimaFirma = '';
        const el = document.createElement('section');
        el.id = 'chTrade'; el.className = 'tp'; el.hidden = true; el.setAttribute('aria-label', 'Trade: posiciones y resultado');
        const ancla = mainEl.querySelector('#chLab');
        if (ancla) mainEl.insertBefore(el, ancla); else mainEl.appendChild(el);

        const apis = () => {
            const N = window.NLTCharts || {};
            return { real: N.traderApi || null, sim: N.app && N.app.paper ? N.app.paper() : null };
        };
        const datos = (cual) => { const a = apis()[cual]; try { return a && a.datosPanel ? a.datosPanel() : null; } catch (_) { return null; } };
        const tieneActividad = (d) => !!(d && ((d.positions && d.positions.length) || (d.orders && d.orders.length)));

        // qué fuente se muestra: la elegida si existe; si no, la otra
        function elegir() {
            const real = datos('real'), sim = datos('sim');
            let f = fuente, d = f === 'real' ? real : sim;
            if (!d && f === 'sim' && real) { f = 'real'; d = real; }
            if (!d && f === 'real' && sim && tieneActividad(sim)) { f = 'sim'; d = sim; }
            return { f, d, real, sim };
        }
        function avisar(t) { aviso = t || ''; clearTimeout(timerAviso); if (aviso) timerAviso = setTimeout(() => { aviso = ''; pintar(true); }, 5000); }

        function resumen(d) {
            const s = d.summary || {}, nivel = num(s.margin_level);
            const celdas = [
                ['Balance', dinero(s.balance), ''], ['Equity', dinero(s.equity), ''], ['Margen', dinero(s.margin), ''],
                ['Margen libre', dinero(s.free_margin), ''], ['Nivel de margen', nivel == null ? '—' : `${nivel.toLocaleString('en-US', { maximumFractionDigits: 0 })}%`, ''],
                ['Ganancia / pérdida', conSigno(s.profit), clase(s.profit)],
            ];
            return `<div class="tp-res">${celdas.map(([a, b, c]) => `<div class="tp-cel ${c}"><small>${a}</small><b>${b}</b></div>`).join('')}</div>`;
        }
        function filaPos(p, d) {
            const dec = Math.min(6, d.dec ? d.dec(p.nlt) : 5), px = (v) => (num(v) == null ? '—' : Number(v).toFixed(dec));
            const abierta = fila === `p:${p.id}`;
            const niveles = `${p.sl ? `<span class="tp-niv per">SL ${px(p.sl)}</span>` : ''}${p.tp ? `<span class="tp-niv gan">TP ${px(p.tp)}</span>` : ''}`;
            return `<div class="tp-fila${abierta ? ' abierta' : ''}" data-tp-fila="p:${esc(p.id)}">
                <div class="tp-principal"><div class="tp-info"><div class="tp-linea1"><b>${esc(p.sym)}</b><span class="tp-lado ${p.side === 'buy' ? 'compra' : 'venta'}">${p.side === 'buy' ? 'compra' : 'venta'} ${esc(p.lots)}</span></div>
                    <div class="tp-linea2">${px(p.open)} <i class="ph ph-arrow-right"></i> ${px(p.current)}${niveles}</div></div>
                    <div class="tp-pl ${clase(p.pl)}">${conSigno(p.pl)}</div></div>
                ${abierta ? `<div class="tp-acc"><button type="button" data-tp="ver" data-sym="${esc(p.nlt)}"><i class="ph ph-chart-line-up"></i> Ver gráfico</button><button type="button" data-tp="sltp" data-id="${esc(p.id)}"><i class="ph ph-crosshair"></i> SL / TP</button>
                    <button type="button" class="tp-cerrar${armado === p.id ? ' armado' : ''}" data-tp="cerrar" data-id="${esc(p.id)}"><i class="ph ph-x-circle"></i> ${armado === p.id ? 'Toca otra vez para cerrar' : 'Cerrar'}</button></div>` : ''}</div>`;
        }
        function filaOrd(o, d) {
            const dec = Math.min(6, d.dec ? d.dec(o.nlt) : 5), px = (v) => (num(v) == null ? '—' : Number(v).toFixed(dec));
            const abierta = fila === `o:${o.id}`;
            return `<div class="tp-fila${abierta ? ' abierta' : ''}" data-tp-fila="o:${esc(o.id)}">
                <div class="tp-principal"><div class="tp-info"><div class="tp-linea1"><b>${esc(o.sym)}</b><span class="tp-lado ${o.side === 'buy' ? 'compra' : 'venta'}">${o.side === 'buy' ? 'compra' : 'venta'} ${esc(TIPO[String(o.type).toLowerCase()] || o.type)} ${esc(o.lots)}</span></div>
                    <div class="tp-linea2">en ${px(o.price)}${o.sl ? `<span class="tp-niv per">SL ${px(o.sl)}</span>` : ''}${o.tp ? `<span class="tp-niv gan">TP ${px(o.tp)}</span>` : ''}</div></div>
                    <div class="tp-pl pend">pendiente</div></div>
                ${abierta ? `<div class="tp-acc"><button type="button" data-tp="ver" data-sym="${esc(o.nlt)}"><i class="ph ph-chart-line-up"></i> Ver gráfico</button>
                    <button type="button" class="tp-cerrar${armado === 'o' + o.id ? ' armado' : ''}" data-tp="cancelar" data-id="${esc(o.id)}"><i class="ph ph-trash"></i> ${armado === 'o' + o.id ? 'Toca otra vez para cancelar' : 'Cancelar orden'}</button></div>` : ''}</div>`;
        }

        function pintar(forzar) {
            const { f, d, real, sim } = elegir();
            const hayReal = !!real, haySim = tieneActividad(sim);
            if (!d || (!hayReal && !haySim)) { el.hidden = true; document.body.classList.remove('tp-on'); return; }
            const firma = JSON.stringify([f, abierto, tab, fila, armado, aviso, d.summary, d.positions, d.orders, d.error, hayReal, haySim]);
            if (!forzar && firma === ultimaFirma && !el.hidden) return;
            ultimaFirma = firma;
            el.hidden = false; document.body.classList.add('tp-on');
            el.classList.toggle('abierto', abierto);
            const s = d.summary || {}, pos = d.positions || [], ord = d.orders || [];
            const selector = (hayReal && sim) ? `<div class="tp-seg" role="tablist" aria-label="Cuenta">${[['real', 'Real'], ['sim', 'Simulado']].map(([k, t]) => `<button type="button" role="tab" data-tp="fuente" data-v="${k}" aria-selected="${f === k}" class="${f === k ? 'on' : ''}">${t}</button>`).join('')}</div>` : `<span class="tp-etq">${esc(d.etiqueta)}</span>`;
            const barra = `<button type="button" class="tp-barra" data-tp="alternar" aria-expanded="${abierto}" aria-label="${abierto ? 'Cerrar el panel Trade' : 'Abrir el panel Trade'}">
                    <span class="tp-id"><i class="ph-fill ph-circle ${d.error ? 'mal' : 'ok'}"></i><b>${f === 'real' ? `#${esc(d.cuenta.login)}` : 'Virtual'}</b></span>
                    <span class="tp-bal"><small>Balance</small><b>${dinero(s.balance)}</b></span>
                    <span class="tp-eq"><small>Equity</small><b>${dinero(s.equity)}</b></span>
                    <span class="tp-bpl ${clase(s.profit)}"><small>${pos.length ? (pos.length === 1 ? '1 posición' : `${pos.length} posiciones`) : 'Sin posiciones'}</small><b>${conSigno(s.profit)}</b></span>
                    <i class="ph ph-caret-up tp-flecha"></i></button>`;
            let cuerpo = '';
            if (abierto) {
                const lista = tab === 'pos' ? (pos.map((p) => filaPos(p, d)).join('') || '<p class="tp-vacio">No tienes posiciones abiertas.<br><span>Dibuja una Long/Short y toca BUY / SELL para abrir una.</span></p>')
                    : (ord.map((o) => filaOrd(o, d)).join('') || '<p class="tp-vacio">No tienes órdenes pendientes.</p>');
                cuerpo = `<div class="tp-cuerpo">
                    <div class="tp-cab">${selector}${f === 'real' ? '<button type="button" class="tp-lnk" data-tp="historial"><i class="ph ph-clock-counter-clockwise"></i> Historial</button>' : ''}</div>
                    ${d.error ? `<p class="tp-error">${esc(d.error)}</p>` : ''}${resumen(d)}
                    <div class="tp-tabs"><button type="button" data-tp="tab" data-v="pos" class="${tab === 'pos' ? 'on' : ''}">Posiciones <i>${pos.length}</i></button><button type="button" data-tp="tab" data-v="ord" class="${tab === 'ord' ? 'on' : ''}">Órdenes <i>${ord.length}</i></button></div>
                    ${aviso ? `<p class="tp-aviso" role="status">${esc(aviso)}</p>` : ''}<div class="tp-lista">${lista}</div></div>`;
            }
            const alto = el.querySelector('.tp-lista') ? el.querySelector('.tp-lista').scrollTop : 0;
            el.innerHTML = barra + cuerpo;
            const nueva = el.querySelector('.tp-lista'); if (nueva && alto) nueva.scrollTop = alto;
        }

        el.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-tp]');
            const filaEl = e.target.closest('[data-tp-fila]');
            const N = window.NLTCharts || {}, A = apis();
            if (b) {
                e.stopPropagation();
                const acc = b.dataset.tp, id = b.dataset.id;
                if (acc === 'alternar') { abierto = !abierto; guardar({ panelTradeAbierto: abierto }); fila = null; armado = null; }
                else if (acc === 'fuente') { fuente = b.dataset.v; guardar({ panelTradeFuente: fuente }); fila = null; armado = null; }
                else if (acc === 'tab') { tab = b.dataset.v; fila = null; armado = null; }
                else if (acc === 'historial') { const bt = document.getElementById('chBtnTrader'); if (bt) { bt.click(); setTimeout(() => { const h = document.querySelector('#chTrader [data-tab="hist"]'); if (h) h.click(); }, 150); } return; }
                else if (acc === 'ver') { if (N.app && N.app.irA && b.dataset.sym) N.app.irA(b.dataset.sym); return; }
                else if (acc === 'cerrar' || acc === 'cancelar') {
                    const clave = acc === 'cancelar' ? 'o' + id : id;
                    if (armado !== clave) { armado = clave; setTimeout(() => { if (armado === clave) { armado = null; pintar(true); } }, 3000); pintar(true); return; }
                    armado = null;
                    const api = A[elegir().f];
                    const err = api ? await (acc === 'cerrar' ? api.cerrarPosicion(id) : api.cancelarOrden(id)) : 'Cuenta no disponible.';
                    avisar(err || (acc === 'cerrar' ? 'Posición cerrada.' : 'Orden cancelada.')); fila = null;
                    if (N.ui && N.ui.toast) N.ui.toast(err || (acc === 'cerrar' ? 'Posición cerrada.' : 'Orden cancelada.'), err ? 'error' : 'ok');
                }
                else if (acc === 'sltp') {
                    const d = elegir().d, p = d && d.positions.find((x) => x.id === id); if (!p) return;
                    const sl = window.prompt('Stop loss (vacío = sin stop):', p.sl != null && p.sl !== 0 ? p.sl : ''); if (sl === null) return;
                    const tp = window.prompt('Take profit (vacío = sin take profit):', p.tp != null && p.tp !== 0 ? p.tp : ''); if (tp === null) return;
                    const v = (t) => (t.trim() === '' ? null : Number(t.replace(',', '.')));
                    const nsl = v(sl), ntp = v(tp);
                    if ((nsl != null && !Number.isFinite(nsl)) || (ntp != null && !Number.isFinite(ntp))) { avisar('Escribe números válidos.'); pintar(true); return; }
                    const api = A[elegir().f]; const err = api ? await api.cambiarSLTP(id, nsl, ntp) : 'Cuenta no disponible.';
                    avisar(err || 'Stop loss y take profit actualizados.');
                }
                pintar(true); return;
            }
            if (filaEl) { const k = filaEl.dataset.tpFila; fila = fila === k ? null : k; armado = null; pintar(true); }
        });

        // se repinta cuando cualquiera de las fuentes cambia (la real cada pocos segundos, el simulador con cada precio)
        let pendiente = false;
        const avisarCambio = () => { if (pendiente) return; pendiente = true; requestAnimationFrame(() => { pendiente = false; pintar(); }); };
        const enlazadas = new Set();
        function enlazar() {
            const A = apis();
            Object.entries(A).forEach(([k, api]) => { if (api && api.alCambiar && !enlazadas.has(k)) { enlazadas.add(k); api.alCambiar(avisarCambio); } });
        }
        // las fuentes se montan después que este panel: se enlazan en cuanto existen
        let intentos = 0;
        const espera = setInterval(() => { enlazar(); pintar(); if ((enlazadas.size === 2 || ++intentos > 40)) clearInterval(espera); }, 500);
        enlazar(); pintar();
        window.addEventListener('resize', () => { if (abierto) ultimaFirma = ''; });
        document.addEventListener('pointerdown', (e) => { if (abierto && !el.hidden && !el.contains(e.target) && !e.target.closest('.nlt-toast')) { abierto = false; fila = null; armado = null; guardar({ panelTradeAbierto: false }); pintar(true); } }, true);
        return { pintar: () => pintar(true), abrir: () => { abierto = true; pintar(true); } };
    }
    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.tradePanel = { montar };
})();
