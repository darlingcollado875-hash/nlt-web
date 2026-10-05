/* NLT Charts -- Operar con tu cuenta MT5 real (plan NLT Charts Trader).
 *
 * El navegador SOLO muestra y pide: el servidor decide el acceso (plan o admin), si la ejecución está encendida, a qué cuenta
 * pertenece cada operación, el volumen máximo y evita duplicados. Tu contraseña de MT5 viaja una vez al proveedor para
 * conectar la cuenta y no se guarda en NLT.
 *
 * Qué hay: conectar/desconectar cuentas, saldo y posiciones en vivo, ticket de compra/venta a mercado con confirmación,
 * y sobre el gráfico (poschips.js) mover el SL/TP arrastrando, agregarlos/quitarlos y cerrar la posición en dos toques.
 * Las órdenes pendientes (límite/stop) llegan en una fase siguiente. */
(function () {
    const REFRESCO_MS = 3000;
    const dinero = (n) => `${n < 0 ? '−' : ''}$${Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const idUnico = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
    const numero = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

    function montar({ chart, getSymbol, simbolos }) {
        const state = NLTCharts.state, esc = NLTCharts.ui.esc;
        const info = Object.fromEntries(simbolos.map((s) => [s.symbol, s]));
        let est = null;            // /status
        let cuentaId = state.prefs().traderCuenta || null;
        let vivo = { summary: null, positions: [], orders: [] };
        let mapa = null;            // /symbols de la cuenta: { map, suggested, broker_symbols, nlt_symbols }
        let tab = 'operar', msg = '', mostrarConexion = false, pendiente = null, prefill = null, cargando = false, timer = null, errorVivo = '';

        const btn = document.createElement('button');
        btn.type = 'button'; btn.id = 'chBtnTrader'; btn.className = 'ch-btn'; btn.title = 'Operar con tu cuenta MT5'; btn.setAttribute('aria-label', 'Operar con tu cuenta MT5');
        btn.innerHTML = '<i class="ph ph-currency-circle-dollar"></i><span class="ch-btn-label">Operar</span>';
        const pop = document.createElement('div');
        pop.className = 'mc-menu pp-pop tr-pop'; pop.id = 'chTrader'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Operar con tu cuenta MT5');
        document.body.appendChild(pop);

        const puedeOperar = () => !!(est && est.has_access && est.execution_enabled && cuentaActual());
        const cuentaActual = () => (est && est.accounts || []).find((c) => c.id === cuentaId) || null;
        const esDelSimbolo = (x) => (x.nlt_symbol ? x.nlt_symbol === getSymbol() : norm(x.symbol).startsWith(norm(getSymbol())));
        const posDeSimbolo = () => vivo.positions.filter(esDelSimbolo);
        const pendDeSimbolo = () => (vivo.orders || []).filter(esDelSimbolo);
        const ultimoPrecio = () => { const l = chart.getDataList(); return l.length ? l[l.length - 1].close : null; };
        const decimales = (sym) => (info[sym] ? info[sym].price_precision : 5);

        // ── P/L de un nivel (para las fichas): lotes × contrato × conversión a USD ──
        function plEn(p, nivel) {
            const D = NLTCharts.drawings, sym = getSymbol();
            const contrato = D && D.contratoDe ? D.contratoDe(sym) : 1, conv = D && D.convUSD ? D.convUSD(sym, nivel) : 1;
            return (p.side === 'buy' ? nivel - p.open_price : p.open_price - nivel) * p.volume * contrato * conv;
        }

        // ── fichas sobre el gráfico ──
        const chips = NLTCharts.poschips.crear({
            chart, grupo: 'nlt-trader', precision: () => decimales(getSymbol()),
            fuente: {
                descripciones() {
                    const out = [];
                    posDeSimbolo().forEach((p) => {
                        const g = Number(p.profit) || 0, k = String(p.ticket);
                        out.push({ clave: `e:${k}`, tipo: 'entrada', id: k, valor: p.open_price, color: g >= 0 ? '#22C55E' : '#EF4444', texto: `${p.side === 'buy' ? 'BUY' : 'SELL'} ${p.volume} · ${g >= 0 ? '+' : ''}${dinero(g)}`, fantasmas: [p.stop_loss ? null : 'sl', p.take_profit ? null : 'tp'].filter(Boolean) });
                        if (p.stop_loss) out.push({ clave: `s:${k}`, tipo: 'sl', id: k, valor: p.stop_loss, color: '#EF4444', texto: `SL ${dinero(plEn(p, p.stop_loss))}` });
                        if (p.take_profit) out.push({ clave: `t:${k}`, tipo: 'tp', id: k, valor: p.take_profit, color: '#22C55E', texto: `TP +${dinero(plEn(p, p.take_profit))}` });
                    });
                    pendDeSimbolo().forEach((o) => {
                        if (!(Number(o.price) > 0)) return;
                        out.push({ clave: `o:${o.ticket}`, tipo: 'orden', id: String(o.ticket), valor: Number(o.price), color: '#F59E0B', texto: `${o.side === 'buy' ? 'BUY' : 'SELL'} ${String(o.type || '').toUpperCase()} ${o.volume}` });
                    });
                    return out;
                },
                alCambiar: () => { if (!pop.hidden) pintar(); },
                textoArrastre(d, v) {
                    const p = vivo.positions.find((x) => String(x.ticket) === d.id);
                    if (!p) return d.texto;
                    const g = plEn(p, v);
                    return `${d.tipo.toUpperCase()} ${g >= 0 ? '+' : ''}${dinero(g)} · ${v.toFixed(decimales(getSymbol()))}`;
                },
                async mover(d, nuevo) {
                    if (!puedeOperar()) return { error: avisoNoOperar() };
                    if (d.tipo === 'orden') {
                        try { await NLT_API.chartsTraderModificarOrden(cuentaId, d.id, { price: nuevo }); } catch (e) { return { error: e.message || 'El broker rechazó el cambio.' }; }
                        await refrescar(); return { aviso: `Orden movida a ${nuevo.toFixed(decimales(getSymbol()))}.` };
                    }
                    const campo = d.tipo === 'sl' ? 'stop_loss' : 'take_profit';
                    try { await NLT_API.chartsTraderModificar(cuentaId, d.id, { [campo]: nuevo }); } catch (e) { return { error: e.message || 'El broker rechazó el cambio.' }; }
                    await refrescar(); return { aviso: `${d.tipo === 'sl' ? 'Stop loss' : 'Take profit'} actualizado en ${nuevo.toFixed(decimales(getSymbol()))}.` };
                },
                async accion(d, a) {
                    if (!puedeOperar()) return { error: avisoNoOperar() };
                    if (a === 'cancelar' && d.tipo === 'orden') {
                        try { await NLT_API.chartsTraderCancelarOrden(cuentaId, d.id); } catch (e) { return { error: e.message || 'El broker rechazó la cancelación.' }; }
                        await refrescar(); return { aviso: 'Orden cancelada.' };
                    }
                    const p = vivo.positions.find((x) => String(x.ticket) === d.id);
                    if (!p) return { error: 'Esa posición ya no está abierta.' };
                    try {
                        if (a === 'cerrar') {
                            const g = Number(p.profit) || 0;
                            await NLT_API.chartsTraderCerrar(cuentaId, p.ticket); await refrescar();
                            return { aviso: `Posición cerrada (${g >= 0 ? '+' : ''}${dinero(g)} aprox.)` };
                        }
                        if (a === 'quitar') { await NLT_API.chartsTraderModificar(cuentaId, p.ticket, { [d.tipo === 'sl' ? 'stop_loss' : 'take_profit']: null }); await refrescar(); return {}; }
                        if (a === 'addsl' || a === 'addtp') {
                            const base = chips.sugerirDistancia(), dist = base > 0 ? base : Math.abs(p.open_price) * 0.005, signo = p.side === 'buy' ? 1 : -1;
                            const px = Number(p.current_price) || p.open_price, dec = decimales(getSymbol());
                            const nivel = a === 'addsl' ? px - signo * dist : px + signo * dist * 2;
                            await NLT_API.chartsTraderModificar(cuentaId, p.ticket, { [a === 'addsl' ? 'stop_loss' : 'take_profit']: Number(nivel.toFixed(dec)) });
                            await refrescar(); return { aviso: `${a === 'addsl' ? 'Stop loss' : 'Take profit'} agregado: arrastralo para ajustarlo.` };
                        }
                    } catch (e) { return { error: e.message || 'El broker rechazó la operación.' }; }
                    return {};
                },
            },
        });
        function avisoNoOperar() {
            if (!est || !est.has_access) return 'Necesitas el plan NLT Charts Trader.';
            if (!est.execution_enabled) return 'La ejecución de órdenes todavía no está activada: por ahora solo puedes ver tu cuenta.';
            return 'Conecta una cuenta primero.';
        }

        // ── datos ──
        async function cargarEstado() {
            try { est = await NLT_API.chartsTraderEstado(); } catch (e) { est = est || { has_access: false, accounts: [], reason: e.message }; }
            if (est.accounts && est.accounts.length && !est.accounts.some((c) => c.id === cuentaId)) { cuentaId = est.accounts[0].id; state.savePrefs({ traderCuenta: cuentaId }); }
            if (!est.accounts || !est.accounts.length) cuentaId = null;
        }
        async function refrescar() {
            if (!est || !est.has_access || !cuentaId || cargando) return;
            cargando = true;
            try { vivo = await NLT_API.chartsTraderEnVivo(cuentaId); errorVivo = ''; } catch (e) { errorVivo = e.message || 'No se pudo leer la cuenta.'; }
            cargando = false;
            chips.actualizar(); if (!pop.hidden) pintar(); programar();
        }
        function programar() {
            const necesita = est && est.has_access && cuentaId && (!pop.hidden || vivo.positions.length || (vivo.orders || []).length);
            if (necesita && !timer) timer = setInterval(() => { if (!document.hidden) refrescar(); }, REFRESCO_MS);
            if (!necesita && timer) { clearInterval(timer); timer = null; }
        }

        async function cargarMapa() {
            if (!cuentaId) return;
            try { mapa = await NLT_API.chartsTraderSimbolos(cuentaId); } catch (e) { msg = e.message || 'No se pudieron leer los símbolos de la cuenta.'; }
            if (!pop.hidden) { pintar(); posicionar(); }
        }
        // ── panel ──
        function pintar() {
            const sym = getSymbol();
            let cuerpo = '';
            if (!est) cuerpo = '<p class="mc-nota">Cargando…</p>';
            else if (!est.has_access) {
                cuerpo = `<div class="tr-lock"><i class="ph-fill ph-lock-key"></i><b>NLT Charts Trader</b><p>Conecta tus cuentas MT5 al gráfico y opera desde ahí: compra, venta, SL/TP y cierre con un toque. Incluye crear tus propios indicadores.</p>
                    <a class="mc-d on" href="charts-trader.html">Ver el plan</a></div>`;
            } else {
                const cuentas = est.accounts || [], c = cuentaActual(), s = vivo.summary || {};
                const modo = est.execution_enabled ? '' : '<p class="tr-modo">Modo solo lectura: la ejecución de órdenes todavía no está activada. Puedes conectar y ver tu cuenta.</p>';
                const form = (mostrarConexion || !cuentas.length) ? `<form data-tr-conectar class="al-form tr-conectar"><b>Conectar cuenta MT5</b>
                    <input name="login_numero" class="mc-sel" inputmode="numeric" placeholder="Número de cuenta" required><input name="password" class="mc-sel" type="password" autocomplete="off" placeholder="Contraseña" required>
                    <input name="broker_server" class="mc-sel" placeholder="Servidor del broker (ej. ICMarkets-Demo)" required>
                    <select name="mode" class="mc-sel"><option value="trade">Operar (contraseña de trading)</option><option value="investor">Solo lectura (contraseña de inversor)</option></select>
                    <p class="mc-nota">La contraseña se envía una vez al proveedor para conectar la cuenta; NLT no la guarda. Hasta ${est.max_accounts} cuentas. Empieza con una cuenta DEMO.</p>
                    <button type="submit" class="mc-d on">Conectar</button></form>` : '';
                const sel = cuentas.length ? `<div class="al-fila2"><select data-tr-cuenta class="mc-sel">${cuentas.map((x) => `<option value="${esc(x.id)}"${x.id === cuentaId ? ' selected' : ''}>#${esc(x.login)} · ${esc(x.server || '')}</option>`).join('')}</select>
                    <button type="button" data-tr="mas" class="mc-d" title="Conectar otra cuenta">+</button><button type="button" data-tr="desconectar" class="mc-d" title="Desconectar esta cuenta">Quitar</button></div>` : '';
                const resumen = c ? `<div class="pp-cuenta"><div><small>Balance</small><b>${s.balance != null ? dinero(s.balance) : dinero(c.balance)}</b></div><div><small>Equity</small><b>${s.equity != null ? dinero(s.equity) : '—'}</b></div>
                    <div><small>G/P abierta</small><b style="color:${(Number(s.profit) || 0) >= 0 ? '#22C55E' : '#EF4444'}">${s.profit != null ? dinero(s.profit) : '—'}</b></div><div><small>Posiciones</small><b>${vivo.positions.length}</b></div></div>` : '';
                const tabs = c ? `<div class="pp-tabs"><button type="button" data-tab="operar" class="${tab === 'operar' ? 'on' : ''}">Operar</button><button type="button" data-tab="pos" class="${tab === 'pos' ? 'on' : ''}">Posiciones (${vivo.positions.length})</button><button type="button" data-tab="ord" class="${tab === 'ord' ? 'on' : ''}">Órdenes (${(vivo.orders || []).length})</button><button type="button" data-tab="sym" class="${tab === 'sym' ? 'on' : ''}">Símbolos</button></div>` : '';
                let panel = '';
                if (c && tab === 'operar') {
                    const pf = prefill || {};
                    panel = pendiente ? `<div class="tr-conf"><b>${pendiente.side === 'buy' ? 'COMPRAR' : 'VENDER'} ${pendiente.volume} lotes de ${esc(pendiente.symbol)}${pendiente.type === 'market' ? ' a mercado' : ` · ${pendiente.type === 'limit' ? 'LÍMITE' : 'STOP'} en ${pendiente.price}`}</b>
                        <p>Cuenta #${esc(c.login)} · ${esc(c.server || '')}<br>${pendiente.stop_loss ? `SL ${pendiente.stop_loss}` : 'Sin stop loss'} · ${pendiente.take_profit ? `TP ${pendiente.take_profit}` : 'Sin take profit'}</p>
                        <p class="mc-nota">${pendiente.type === 'market' ? 'Es una orden REAL a mercado.' : 'Es una orden pendiente REAL: se ejecuta sola cuando el precio llegue.'} Revisa la cuenta antes de confirmar.</p>
                        <div class="al-fila2"><button type="button" data-tr="confirmar" class="mc-d on">Confirmar</button><button type="button" data-tr="cancelar" class="mc-d">Cancelar</button></div></div>`
                        : `<form data-tr-orden class="al-form"><div class="al-fila2"><b>${esc(sym)}</b><span class="pp-px">${ultimoPrecio() != null ? ultimoPrecio().toFixed(decimales(sym)) : ''}</span></div>
                        <div class="al-fila2"><select name="type" class="mc-sel" data-tr-tipo><option value="market">A mercado</option><option value="limit"${pf.type === 'limit' ? ' selected' : ''}>Límite</option><option value="stop"${pf.type === 'stop' ? ' selected' : ''}>Stop</option></select>
                        <input name="price" class="mc-sel" type="number" step="any" inputmode="decimal" placeholder="Precio (pendiente)" value="${pf.price != null ? esc(pf.price) : ''}"></div>
                        <div class="al-fila2"><input name="volume" class="mc-sel" type="number" step="any" min="0" inputmode="decimal" placeholder="Lotes" value="${pf.volume != null ? esc(pf.volume) : '0.10'}" required>
                        <input name="stop_loss" class="mc-sel" type="number" step="any" inputmode="decimal" placeholder="Stop loss" value="${pf.sl != null ? esc(pf.sl) : ''}"><input name="take_profit" class="mc-sel" type="number" step="any" inputmode="decimal" placeholder="Take profit" value="${pf.tp != null ? esc(pf.tp) : ''}"></div>
                        <div class="al-fila2"><button type="submit" data-side="buy" class="pp-buy">COMPRAR</button><button type="submit" data-side="sell" class="pp-sell">VENDER</button></div>
                        <p class="mc-nota">Máximo ${est.max_lots} lotes por orden. Tip: dibuja una posición Long/Short y usa su botón BUY/SELL: trae el lote calculado según tu riesgo.</p></form>`;
                } else if (c && tab === 'ord') {
                    panel = (vivo.orders || []).map((o) => `<div class="al-fila"><div class="al-txt"><b>${esc(o.symbol)}</b> ${o.side === 'buy' ? 'COMPRA' : 'VENTA'} ${esc(String(o.type || '').toUpperCase())} ${esc(o.volume)} @ ${esc(o.price)}<br><small>${o.stop_loss ? `SL ${esc(o.stop_loss)}` : 'sin SL'} · ${o.take_profit ? `TP ${esc(o.take_profit)}` : 'sin TP'}</small></div>
                        <button type="button" data-tr="cancelar-orden" data-ticket="${esc(o.ticket)}" title="Cancelar orden" aria-label="Cancelar orden"><i class="ph ph-trash"></i></button></div>`).join('') || '<p class="mc-nota">No hay órdenes pendientes. Crea una desde la pestaña Operar (Límite o Stop).</p>';
                } else if (c && tab === 'sym') {
                    panel = !mapa ? '<p class="mc-nota">Cargando los símbolos de tu cuenta…</p>' : `<p class="mc-nota">Cada broker nombra distinto los símbolos (por ejemplo <b>GOLD</b> en vez de XAUUSD, o <b>EURUSD.m</b>). NLT los empareja solo; corrige aquí lo que haga falta.</p>
                        <datalist id="trBrokerSyms">${mapa.broker_symbols.map((b) => `<option value="${esc(b)}">`).join('')}</datalist>
                        <form data-tr-mapa>${mapa.nlt_symbols.map((n) => { const v = (mapa.map && mapa.map[n]) || ''; const ok = v && mapa.broker_symbols.includes(v);
                            return `<div class="al-fila2" style="margin-bottom:6px"><b style="width:74px;font-size:12px">${esc(n)}</b><input class="mc-sel" list="trBrokerSyms" name="${esc(n)}" value="${esc(v)}" placeholder="${mapa.suggested[n] ? esc(mapa.suggested[n]) + ' (sugerido)' : 'sin asignar'}" autocomplete="off"><span title="${ok ? 'Existe en tu cuenta' : 'Sin asignar'}" style="color:${ok ? '#22C55E' : '#6B7280'}">${ok ? '✓' : '·'}</span></div>`; }).join('')}
                        <div class="al-fila2"><button type="button" data-tr="sugeridos" class="mc-d">Usar sugeridos</button><button type="submit" class="mc-d on">Guardar</button></div></form>`;
                } else if (c) {
                    panel = vivo.positions.map((p) => { const g = Number(p.profit) || 0; return `<div class="al-fila"><div class="al-txt"><b>${esc(p.symbol)}</b> ${p.side === 'buy' ? 'COMPRA' : 'VENTA'} ${esc(p.volume)} @ ${esc(p.open_price)}<br><small>${p.stop_loss ? `SL ${esc(p.stop_loss)}` : 'sin SL'} · ${p.take_profit ? `TP ${esc(p.take_profit)}` : 'sin TP'}</small></div>
                        <b style="color:${g >= 0 ? '#22C55E' : '#EF4444'}">${g >= 0 ? '+' : ''}${dinero(g)}</b>
                        <button type="button" data-tr="cerrar" data-ticket="${esc(p.ticket)}" title="Cerrar posición (dos toques)" aria-label="Cerrar posición"><i class="ph ph-x-circle"></i></button></div>`; }).join('') || '<p class="mc-nota">No hay posiciones abiertas en esta cuenta.</p>';
                }
                cuerpo = `${modo}${sel}${errorVivo ? `<p class="al-msg">${esc(errorVivo)}</p>` : ''}${form}${resumen}${tabs}${msg ? `<p class="al-msg">${esc(msg)}</p>` : ''}${panel}
                    <p class="mc-nota">Operar con dinero real implica riesgo de pérdida. Las posiciones, SL y TP se ven y se mueven también directo en el gráfico.</p>`;
            }
            pop.innerHTML = `<div class="mc-tit">Operar · cuenta real</div>${cuerpo}`;
        }
        const posicionar = () => { const r = btn.getBoundingClientRect(); pop.style.top = `${r.bottom + 6}px`; pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`; };
        async function abrir(t) {
            document.querySelectorAll('.mc-menu').forEach((m) => { m.hidden = true; });
            if (t) tab = t;
            pintar(); pop.hidden = false; posicionar();
            await cargarEstado(); pintar(); posicionar(); await refrescar(); posicionar();
        }
        btn.addEventListener('click', (e) => { e.stopPropagation(); if (!pop.hidden) { pop.hidden = true; programar(); return; } msg = ''; abrir(); });
        document.addEventListener('click', (e) => { const ruta = e.composedPath(); if (!pop.hidden && !ruta.includes(pop) && !ruta.includes(btn)) { pop.hidden = true; programar(); } });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { pop.hidden = true; programar(); } });

        let cierreArmado = null;
        pop.addEventListener('click', async (e) => {
            const t = e.target.closest('[data-tab]');
            if (t) { tab = t.dataset.tab; msg = ''; pendiente = null; pintar(); posicionar(); if (tab === 'sym' && !mapa) cargarMapa(); return; }
            const a = e.target.closest('[data-tr]'); if (!a) return;
            const acc = a.dataset.tr;
            if (acc === 'mas') { mostrarConexion = !mostrarConexion; pintar(); posicionar(); return; }
            if (acc === 'cancelar') { pendiente = null; pintar(); posicionar(); return; }
            try {
                if (acc === 'desconectar') {
                    if (!window.confirm('¿Desconectar esta cuenta de NLT Charts? No cierra tus operaciones en el broker.')) return;
                    await NLT_API.chartsTraderDesconectar(cuentaId); vivo = { summary: null, positions: [], orders: [] }; await cargarEstado(); msg = 'Cuenta desconectada.';
                } else if (acc === 'confirmar' && pendiente) {
                    const orden = pendiente; pendiente = null;
                    try {
                        const r = await NLT_API.chartsTraderOrden(cuentaId, orden);
                        msg = r.status === 'duplicate' ? 'Esa orden ya se había enviado.' : (orden.type === 'market' ? 'Orden enviada al broker.' : 'Orden pendiente creada.');
                        prefill = null; tab = orden.type === 'market' ? 'pos' : 'ord'; await refrescar();
                    } catch (err) { msg = err.message || 'El broker rechazó la orden.'; }
                } else if (acc === 'cancelar-orden') {
                    await NLT_API.chartsTraderCancelarOrden(cuentaId, a.dataset.ticket); msg = 'Orden cancelada.'; await refrescar();
                } else if (acc === 'sugeridos' && mapa) {
                    mapa.map = { ...mapa.suggested }; msg = 'Sugeridos cargados: pulsa Guardar.';
                } else if (acc === 'cerrar') {
                    const ticket = a.dataset.ticket;
                    if (cierreArmado !== ticket) { cierreArmado = ticket; a.innerHTML = '<span style="font-size:11px;font-weight:700;color:#fff;background:#DC2626;border-radius:6px;padding:4px 6px">Cerrar</span>'; setTimeout(() => { if (cierreArmado === ticket) { cierreArmado = null; pintar(); } }, 3000); return; }
                    cierreArmado = null;
                    await NLT_API.chartsTraderCerrar(cuentaId, ticket); msg = 'Posición cerrada.'; await refrescar();
                }
            } catch (err) { msg = err.message || 'No se pudo completar.'; }
            pintar(); posicionar(); chips.actualizar();
        });
        pop.addEventListener('change', async (e) => {
            if (e.target.matches('[data-tr-cuenta]')) { cuentaId = e.target.value; state.savePrefs({ traderCuenta: cuentaId }); mapa = null; vivo = { summary: null, positions: [], orders: [] }; pintar(); await refrescar(); posicionar(); }
        });
        pop.addEventListener('submit', async (e) => {
            e.preventDefault();
            const f = new FormData(e.target);
            if (e.target.matches('[data-tr-conectar]')) {
                const btnC = e.target.querySelector('button[type=submit]'); btnC.disabled = true; btnC.textContent = 'Conectando…';
                try {
                    const r = await NLT_API.chartsTraderConectar({ login_numero: Number(f.get('login_numero')), password: f.get('password'), broker_server: String(f.get('broker_server')).trim(), mode: f.get('mode') });
                    cuentaId = r.account.id; state.savePrefs({ traderCuenta: cuentaId }); mostrarConexion = false; msg = 'Cuenta conectada.';
                    await cargarEstado(); await refrescar();
                } catch (err) { msg = err.message || 'No se pudo conectar la cuenta.'; }
                pintar(); posicionar(); return;
            }
            if (e.target.matches('[data-tr-mapa]')) {
                const nuevo = {};
                for (const [k, v] of f.entries()) if (String(v).trim()) nuevo[k] = String(v).trim();
                try { const r = await NLT_API.chartsTraderGuardarMapeo(cuentaId, nuevo); mapa.map = r.map; msg = 'Símbolos guardados.'; await cargarEstado(); } catch (err) { msg = err.message || 'No se pudo guardar el mapeo.'; }
                pintar(); posicionar(); return;
            }
            if (e.target.matches('[data-tr-orden]')) {
                const volume = numero(f.get('volume')), sl = numero(f.get('stop_loss')), tp = numero(f.get('take_profit'));
                const tipo = f.get('type') || 'market', precioOrden = numero(f.get('price'));
                const px = ultimoPrecio();
                if (!puedeOperar()) { msg = avisoNoOperar(); pintar(); posicionar(); return; }
                if (!(volume > 0)) { msg = 'Pon un tamaño en lotes mayor que 0.'; pintar(); posicionar(); return; }
                const side = (e.submitter && e.submitter.dataset.side) || 'buy';
                const lado = (e.submitter && e.submitter.dataset.side) || 'buy';
                if (tipo !== 'market') {
                    if (!(precioOrden > 0)) { msg = 'Pon el precio de la orden pendiente.'; pintar(); posicionar(); return; }
                    if (px != null) {
                        if (tipo === 'limit' && ((lado === 'buy' && precioOrden >= px) || (lado === 'sell' && precioOrden <= px))) { msg = lado === 'buy' ? 'Una compra límite va POR DEBAJO del precio actual.' : 'Una venta límite va POR ENCIMA del precio actual.'; pintar(); posicionar(); return; }
                        if (tipo === 'stop' && ((lado === 'buy' && precioOrden <= px) || (lado === 'sell' && precioOrden >= px))) { msg = lado === 'buy' ? 'Una compra stop va POR ENCIMA del precio actual.' : 'Una venta stop va POR DEBAJO del precio actual.'; pintar(); posicionar(); return; }
                    }
                }
                pendiente = { symbol: getSymbol(), side, volume, type: tipo, price: tipo === 'market' ? null : precioOrden, stop_loss: sl, take_profit: tp, client_id: idUnico() };
                msg = ''; pintar(); posicionar();
            }
        });

        const ancla = document.getElementById('chBtnConfig');
        if (ancla) ancla.before(btn);
        cargarEstado().then(() => refrescar());

        const api = {
            cambioSimbolo: () => chips.actualizar(),
            puedeOperar,
            // Long/Short dibujado -> ticket con el lote, SL y TP ya cargados (se confirma a mano).
            desdePosicion(pos) {
                if (!pos) return;
                const px = ultimoPrecio();
                let tipo = 'market';
                if (px != null && pos.entrada && Math.abs(pos.entrada - px) / px > 0.0003) {
                    // Si la entrada dibujada no es el precio de ahora, lo natural es una orden pendiente en ese nivel.
                    tipo = pos.lado === 'BUY' ? (pos.entrada < px ? 'limit' : 'stop') : (pos.entrada > px ? 'limit' : 'stop');
                }
                prefill = { volume: pos.lotes || null, sl: pos.sl, tp: pos.tp, type: tipo, price: tipo === 'market' ? null : pos.entrada };
                pendiente = null; tab = 'operar'; msg = pos.lado === 'BUY' ? 'Compra cargada desde tu posición: revisa y elige COMPRAR.' : 'Venta cargada desde tu posición: revisa y elige VENDER.';
                abrir('operar');
            },
        };
        window.NLTCharts.traderApi = api;   // lo usa trading.js (botón BUY/SELL de una Long/Short dibujada)
        return api;
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.trader = { montar };
})();
