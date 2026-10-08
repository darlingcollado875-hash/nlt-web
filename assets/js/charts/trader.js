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
        let hist = null, histDias = 30, cargandoHist = false, errorHist = '';
        let tab = 'operar', msg = '', mostrarConexion = false, pendiente = null, prefill = null, cargando = false, timer = null, errorVivo = '';

        const btn = document.createElement('button');
        btn.type = 'button'; btn.id = 'chBtnTrader'; btn.className = 'ch-btn ch-herr'; btn.title = 'Operar con tu cuenta MT5'; btn.setAttribute('aria-label', 'Operar con tu cuenta MT5');
        btn.innerHTML = '<i class="ph ph-currency-circle-dollar"></i><span class="ch-btn-label">Operar</span>';
        const saldoEl = document.createElement('span'); saldoEl.className = 'tr-saldo'; saldoEl.hidden = true; btn.appendChild(saldoEl);
        /** Saldo de la cuenta conectada, siempre visible arriba en el botón Operar. */
        const oyentesPanel = new Set();
        const avisarPanel = () => oyentesPanel.forEach((fn) => { try { fn(); } catch (_) { /* un oyente roto no frena la cuenta */ } });
        const gpAbierta = () => (vivo.summary && vivo.summary.profit != null ? Number(vivo.summary.profit) : (vivo.positions || []).reduce((a, p) => a + (Number(p.profit) || 0), 0));
        function pintarSaldo() {
            const c = cuentaActual();
            btn.classList.toggle('con-saldo', !!c);
            saldoEl.hidden = !c;
            if (!c) { btn.title = 'Operar con tu cuenta MT5'; return; }
            const b = vivo.summary && vivo.summary.balance != null ? vivo.summary.balance : c.balance;
            saldoEl.classList.toggle('aviso', b == null && !!errorVivo);
            saldoEl.textContent = b != null ? dinero(b) : (errorVivo ? 'Revisar' : '…');
            btn.title = b != null ? `Cuenta #${c.login} · saldo ${dinero(b)}${vivo.summary && vivo.summary.equity != null ? ' · equity ' + dinero(vivo.summary.equity) : ''}` : `Cuenta #${c.login}${errorVivo ? ' · ' + errorVivo : ' · leyendo el saldo…'}`;
        }
        const pop = document.createElement('div');
        pop.className = 'mc-menu pp-pop tr-pop'; pop.id = 'chTrader'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Operar con tu cuenta MT5');
        document.body.appendChild(pop);

        /** Tipo con el que sale una posición dibujada: el que elegiste en la barra, o (auto) pendiente en tu entrada. */
        function tipoDeOrden(pos, px) {
            if (pos.tipo === 'market' || pos.tipo === 'limit' || pos.tipo === 'stop') return pos.tipo;
            return px == null ? 'limit' : (pos.lado === 'BUY' ? (pos.entrada < px ? 'limit' : 'stop') : (pos.entrada > px ? 'limit' : 'stop'));
        }
        function tipoInvalido(tipo, lado, entrada, px) {
            if (px == null) return null;
            const compra = lado === 'BUY';
            if (tipo === 'limit' && (compra ? entrada > px : entrada < px)) return compra ? 'Una compra límite va POR DEBAJO del precio actual: elige Stop o A mercado.' : 'Una venta límite va POR ENCIMA del precio actual: elige Stop o A mercado.';
            if (tipo === 'stop' && (compra ? entrada < px : entrada > px)) return compra ? 'Una compra stop va POR ENCIMA del precio actual: elige Límite o A mercado.' : 'Una venta stop va POR DEBAJO del precio actual: elige Límite o A mercado.';
            return null;
        }
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
                    // Optimista: el cambio se ve YA en el gráfico; el broker lo confirma en segundo plano y, si lo rechaza, vuelve al valor anterior.
                    if (d.tipo === 'orden') {
                        const o = (vivo.orders || []).find((x) => String(x.ticket) === d.id), antes = o ? o.price : null;
                        if (o) { o.price = nuevo; chips.actualizar(); }
                        try { await NLT_API.chartsTraderModificarOrden(cuentaId, d.id, { price: nuevo }); } catch (e) { if (o) { o.price = antes; chips.actualizar(); } sonido('error'); return { error: e.message || 'El broker rechazó el cambio.' }; }
                        sonido('sltp'); confirmarEnSegundoPlano(); return { aviso: `Orden movida a ${nuevo.toFixed(decimales(getSymbol()))}.` };
                    }
                    const campo = d.tipo === 'sl' ? 'stop_loss' : 'take_profit';
                    const pos = vivo.positions.find((x) => String(x.ticket) === d.id), previo = pos ? pos[campo] : null;
                    if (pos) { pos[campo] = nuevo; chips.actualizar(); }
                    try { await NLT_API.chartsTraderModificar(cuentaId, d.id, { [campo]: nuevo }); } catch (e) { if (pos) { pos[campo] = previo; chips.actualizar(); } sonido('error'); return { error: e.message || 'El broker rechazó el cambio.' }; }
                    sonido('sltp'); confirmarEnSegundoPlano(); return { aviso: `${d.tipo === 'sl' ? 'Stop loss' : 'Take profit'} actualizado en ${nuevo.toFixed(decimales(getSymbol()))}.` };
                },
                async accion(d, a) {
                    if (!puedeOperar()) return { error: avisoNoOperar() };
                    if (a === 'cancelar' && d.tipo === 'orden') {
                        try { await NLT_API.chartsTraderCancelarOrden(cuentaId, d.id); } catch (e) { sonido('error'); return { error: e.message || 'El broker rechazó la cancelación.' }; }
                        sonido('cancelar'); vivo.orders = (vivo.orders || []).filter((o) => String(o.ticket) !== String(d.id)); chips.actualizar(); confirmarEnSegundoPlano(); return { aviso: 'Orden cancelada.' };
                    }
                    const p = vivo.positions.find((x) => String(x.ticket) === d.id);
                    if (!p) return { error: 'Esa posición ya no está abierta.' };
                    try {
                        if (a === 'cerrar') {
                            const g = Number(p.profit) || 0;
                            await NLT_API.chartsTraderCerrar(cuentaId, p.ticket);
                            propios.set(String(p.ticket), Date.now() + 10000); sonido(g > 0.005 ? 'ganancia' : g < -0.005 ? 'perdida' : 'cerrar');
                            vivo.positions = vivo.positions.filter((x) => String(x.ticket) !== String(p.ticket)); chips.actualizar(); pintarSaldo(); confirmarEnSegundoPlano();
                            return { aviso: `Posición cerrada (${g >= 0 ? '+' : ''}${dinero(g)} aprox.)` };
                        }
                        if (a === 'quitar') {
                            const campoQ = d.tipo === 'sl' ? 'stop_loss' : 'take_profit', previoQ = p[campoQ];
                            p[campoQ] = null; chips.actualizar();
                            try { await NLT_API.chartsTraderModificar(cuentaId, p.ticket, { [campoQ]: null }); } catch (e) { p[campoQ] = previoQ; chips.actualizar(); throw e; }
                            sonido('sltp'); confirmarEnSegundoPlano(); return {};
                        }
                        if (a === 'addsl' || a === 'addtp') {
                            const base = chips.sugerirDistancia(), dist = base > 0 ? base : Math.abs(p.open_price) * 0.005, signo = p.side === 'buy' ? 1 : -1;
                            const px = Number(p.current_price) || p.open_price, dec = decimales(getSymbol());
                            const nivel = a === 'addsl' ? px - signo * dist : px + signo * dist * 2;
                            const campoA = a === 'addsl' ? 'stop_loss' : 'take_profit', valorA = Number(nivel.toFixed(dec));
                            p[campoA] = valorA; chips.actualizar();
                            try { await NLT_API.chartsTraderModificar(cuentaId, p.ticket, { [campoA]: valorA }); } catch (e) { p[campoA] = null; chips.actualizar(); throw e; }
                            sonido('sltp'); confirmarEnSegundoPlano(); return { aviso: `${a === 'addsl' ? 'Stop loss' : 'Take profit'} agregado: arrastralo para ajustarlo.` };
                        }
                    } catch (e) { sonido('error'); return { error: e.message || 'El broker rechazó la operación.' }; }
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
            pintarSaldo(); avisarPanel();
        }
        // ── respuesta inmediata: lo que el usuario acaba de hacer se pinta YA (y suena); la lectura real lo confirma después ──
        const sonido = (n) => { if (NLTCharts.sonidos) NLTCharts.sonidos.reproducir(n); };
        const optimistas = [];                 // { tipo: 'pos'|'ord', dato, hasta }: entradas locales hasta que la lectura real las incluya
        const propios = new Map();             // ticket -> hasta: cambios que hizo el usuario aquí (no suenan dos veces al confirmarse)
        const esPropio = (t) => { const h = propios.get(String(t)); if (h && h > Date.now()) return true; propios.delete(String(t)); return false; };
        let primeraLectura = true;
        function mezclarOptimistas() {
            const ahora = Date.now();
            for (let i = optimistas.length - 1; i >= 0; i--) {
                const o = optimistas[i];
                const lista = o.tipo === 'pos' ? vivo.positions : (vivo.orders = vivo.orders || []);
                if (o.hasta < ahora || lista.some((x) => String(x.ticket) === String(o.dato.ticket))) { optimistas.splice(i, 1); continue; }
                lista.push(o.dato);
            }
        }
        // Compara la lectura anterior con la nueva: una posición que aparece o desaparece SIN que el usuario la haya tocado aquí
        // (se llenó una pendiente, saltó el SL/TP, la cerró otra plataforma) también avisa con su sonido.
        function sonidosPorCambios(antes, ahora) {
            if (primeraLectura) { primeraLectura = false; return; }
            const nuevos = new Set(ahora.positions.map((p) => String(p.ticket)));
            antes.positions.forEach((p) => {
                if (nuevos.has(String(p.ticket)) || esPropio(p.ticket)) return;
                const g = Number(p.profit) || 0;
                sonido(Math.abs(g) < 0.005 ? 'cerrar' : g > 0 ? 'ganancia' : 'perdida');
            });
            const previos = new Set(antes.positions.map((p) => String(p.ticket)));
            ahora.positions.forEach((p) => { if (!previos.has(String(p.ticket)) && !esPropio(p.ticket)) sonido('abrir'); });
        }
        async function refrescar() {
            if (!est || !est.has_access || !cuentaId || cargando) return;
            cargando = true;
            const antes = vivo;
            try { vivo = await NLT_API.chartsTraderEnVivo(cuentaId); errorVivo = ''; sonidosPorCambios(antes, vivo); mezclarOptimistas(); } catch (e) { errorVivo = e.message || 'No se pudo leer la cuenta.'; }
            cargando = false;
            pintarSaldo(); chips.actualizar(); if (!pop.hidden) NLTCharts.ui.conservar(pop, pintar); programar();
        }
        const confirmarEnSegundoPlano = () => { setTimeout(refrescar, 1100); };
        // Pinta ya la operación que el broker acaba de aceptar (con el ticket real que devolvió) y suena.
        function aperturaLocal(orden, resp) {
            if (!resp || resp.status === 'duplicate') return;
            const res = resp.result || {}, ticket = res.ticket;
            if (ticket == null) {          // el broker no devolvió el número de la operación: no se inventa una entrada local (saldría repetida); suena y se lee ya
                sonido(orden.type === 'market' ? 'abrir' : 'pendiente'); setTimeout(refrescar, 300); return;
            }
            const px = Number(res.price) || ultimoPrecio() || 0, sim = getSymbol();
            vivo.orders = vivo.orders || [];
            if (orden.type === 'market') {
                const dato = { ticket, symbol: orden.symbol || sim, nlt_symbol: orden.symbol || sim, side: orden.side, volume: orden.volume, open_price: px, current_price: px, stop_loss: orden.stop_loss || null, take_profit: orden.take_profit || null, profit: 0 };
                vivo.positions.push(dato); optimistas.push({ tipo: 'pos', dato, hasta: Date.now() + 6000 }); propios.set(String(ticket), Date.now() + 8000);
                sonido('abrir');
            } else {
                const dato = { ticket, symbol: orden.symbol || sim, nlt_symbol: orden.symbol || sim, side: orden.side, type: orden.type, volume: orden.volume, price: orden.price, stop_loss: orden.stop_loss || null, take_profit: orden.take_profit || null };
                vivo.orders.push(dato); optimistas.push({ tipo: 'ord', dato, hasta: Date.now() + 6000 });
                sonido('pendiente');
            }
            chips.actualizar(); pintarSaldo(); if (!pop.hidden) { pintar(); posicionar(); }
            confirmarEnSegundoPlano();
        }
        function programar() {
            const necesita = est && est.has_access && cuentaId && (!pop.hidden || vivo.positions.length || (vivo.orders || []).length || cuentaActual());
            if (necesita && !timer) timer = setInterval(() => { if (!document.hidden) refrescar(); }, REFRESCO_MS);
            if (!necesita && timer) { clearInterval(timer); timer = null; }
        }

        async function cargarHistorial() {
            if (!cuentaId || cargandoHist) return;
            cargandoHist = true; errorHist = '';
            try { hist = await NLT_API.chartsTraderHistorial(cuentaId, histDias); } catch (e) { errorHist = e.message || 'No se pudo cargar el historial.'; }
            cargandoHist = false;
            if (!pop.hidden) { pintar(); posicionar(); }
        }
        const fechaCorta = (iso) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
        const diaDe = (iso) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Sin fecha'; };
        function htmlHistorial(c) {
            const rangos = [[7, '7 días'], [30, '30 días'], [90, '90 días']];
            const barra = `<div class="tr-rango">${rangos.map(([d, t]) => `<button type="button" data-tr="rango" data-dias="${d}" class="${histDias === d ? 'on' : ''}">${t}</button>`).join('')}<button type="button" data-tr="hist-recargar" title="Actualizar" aria-label="Actualizar historial"><i class="ph ph-arrows-clockwise"></i></button></div>`;
            if (errorHist) return `${barra}<p class="al-msg">${esc(errorHist)}</p>`;
            if (!hist) return `${barra}<p class="mc-nota">Cargando el historial de tu cuenta…</p>`;
            const r = hist.summary || {}, ops = hist.trades || [];
            const pct = r.count ? Math.round((r.wins / r.count) * 100) : 0, fp = r.gross_loss > 0 ? (r.gross_win / r.gross_loss).toFixed(2) : (r.gross_win > 0 ? '∞' : '—');
            const resumen = `<div class="pp-cuenta tr-hist-res"><div><small>Resultado neto</small><b style="color:${(r.net || 0) >= 0 ? '#22C55E' : '#EF4444'}">${(r.net || 0) >= 0 ? '+' : ''}${dinero(r.net || 0)}</b></div><div><small>Operaciones</small><b>${r.count || 0}</b></div>
                <div><small>Ganadas</small><b>${pct}%</b></div><div><small>Factor de beneficio</small><b>${fp}</b></div></div>`;
            if (!ops.length) return `${barra}${resumen}<p class="mc-nota">${esc(hist.note || 'No hay operaciones cerradas en este periodo. Cuando cierres operaciones en esta cuenta aparecerán aquí.')}</p>`;
            let dia = '', filas = '';
            ops.forEach((o) => {
                const d = diaDe(o.close_time);
                if (d !== dia) { dia = d; filas += `<div class="tr-dia">${esc(d)}</div>`; }
                const g = Number(o.net) || 0, nom = o.nlt_symbol || o.symbol, dec = decimales(o.nlt_symbol || getSymbol());
                const px = (v) => (v == null ? '—' : Number(v).toFixed(Math.min(6, dec)));
                filas += `<div class="tr-op"><span class="tr-lado ${o.side === 'buy' ? 'compra' : 'venta'}"><i class="ph-fill ${o.side === 'buy' ? 'ph-arrow-up-right' : 'ph-arrow-down-right'}"></i></span>
                    <div class="tr-op-txt"><b>${esc(nom)}</b> <span>${o.side === 'buy' ? 'Compra' : 'Venta'} · ${esc(o.volume)} lotes</span><small>${px(o.open_price)} → ${px(o.close_price)}${o.close_time ? ' · ' + esc(fechaCorta(o.close_time)) : ''}</small></div>
                    <div class="tr-op-pl" style="color:${g >= 0 ? '#22C55E' : '#EF4444'}"><b>${g >= 0 ? '+' : ''}${dinero(g)}</b>${o.commission || o.swap ? `<small>com. ${dinero((o.commission || 0) + (o.swap || 0))}</small>` : ''}</div></div>`;
            });
            return `${barra}${resumen}<div class="tr-hist">${filas}</div>`;
        }

        async function cargarMapa() {
            if (!cuentaId) return;
            try { mapa = await NLT_API.chartsTraderSimbolos(cuentaId); } catch (e) { msg = e.message || 'No se pudieron leer los símbolos de la cuenta.'; }
            if (!pop.hidden) { NLTCharts.ui.conservar(pop, pintar); posicionar(); }
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
                    <input type="hidden" name="mode" value="trade">
                    <p class="mc-nota">La contraseña se envía una vez al proveedor para conectar la cuenta; NLT la guarda cifrada solo para reconectar la sesión sola cuando el proveedor la enfría; puedes quitarla desconectando la cuenta. ${est.max_accounts === 1 ? 'Tu plan incluye 1 cuenta conectada.' : `Hasta ${est.max_accounts} cuentas.`} Empieza con una cuenta DEMO.</p>
                    <button type="submit" class="mc-d on">Conectar</button></form>` : '';
                const sel = cuentas.length ? `<div class="al-fila2"><select data-tr-cuenta class="mc-sel">${cuentas.map((x) => `<option value="${esc(x.id)}"${x.id === cuentaId ? ' selected' : ''}>#${esc(x.login)} · ${esc(x.server || '')}</option>`).join('')}</select>
                    <button type="button" data-tr="mas" class="mc-d" title="Conectar otra cuenta">+</button><button type="button" data-tr="desconectar" class="mc-d" title="Desconectar esta cuenta">Quitar</button></div>` : '';
                const resumen = c ? `<div class="pp-cuenta"><div><small>Balance</small><b>${s.balance != null ? dinero(s.balance) : dinero(c.balance)}</b></div><div><small>Equity</small><b>${s.equity != null ? dinero(s.equity) : '—'}</b></div>
                    <div><small>G/P abierta</small><b style="color:${gpAbierta() >= 0 ? '#22C55E' : '#EF4444'}">${dinero(gpAbierta())}</b></div><div><small>Posiciones</small><b>${vivo.positions.length}</b></div></div>` : '';
                const tabs = c ? `<div class="pp-tabs"><button type="button" data-tab="operar" class="${tab === 'operar' ? 'on' : ''}">Operar</button><button type="button" data-tab="pos" class="${tab === 'pos' ? 'on' : ''}">Posiciones (${vivo.positions.length})</button><button type="button" data-tab="ord" class="${tab === 'ord' ? 'on' : ''}">Órdenes (${(vivo.orders || []).length})</button><button type="button" data-tab="hist" class="${tab === 'hist' ? 'on' : ''}">Historial</button><button type="button" data-tab="sym" class="${tab === 'sym' ? 'on' : ''}">Símbolos</button></div>` : '';
                let panel = '';
                if (c && tab === 'operar') {
                    const pf = prefill || {};
                    panel = pendiente ? `<div class="tr-conf"><b>${pendiente.side === 'buy' ? 'COMPRAR' : 'VENDER'} ${pendiente.volume} lotes de ${esc(pendiente.symbol)}${pendiente.type === 'market' ? ' a mercado' : ` · ${pendiente.type === 'limit' ? 'LÍMITE' : 'STOP'} en ${pendiente.price}`}</b>
                        <p>Cuenta #${esc(c.login)} · ${esc(c.server || '')}<br>${pendiente.stop_loss ? `SL ${pendiente.stop_loss}` : 'Sin stop loss'} · ${pendiente.take_profit ? `TP ${pendiente.take_profit}` : 'Sin take profit'}</p>
                        <p class="mc-nota">${pendiente.type === 'market' ? 'Es una orden REAL a mercado.' : 'Es una orden pendiente REAL: se ejecuta sola cuando el precio llegue.'} Revisa la cuenta antes de confirmar.</p>
                        <div class="al-fila2"><button type="button" data-tr="confirmar" class="mc-d on">Confirmar</button><button type="button" data-tr="cancelar" class="mc-d">Cancelar</button></div></div>`
                        : `<form data-tr-orden class="al-form"><div class="al-fila2"><b>${esc(sym)}</b><span class="pp-px">${ultimoPrecio() != null ? ultimoPrecio().toFixed(decimales(sym)) : ''}</span></div>
                        <div class="al-fila2"><select name="type" class="mc-sel" data-tr-tipo><option value="market">A mercado</option><option value="limit"${pf.type === 'limit' ? ' selected' : ''}>Límite</option><option value="stop"${pf.type === 'stop' ? ' selected' : ''}>Stop</option></select>
                        <input name="price" class="mc-sel" type="number" step="any" inputmode="decimal" placeholder="Precio" title="Precio de la orden pendiente (límite o stop)" value="${pf.price != null ? esc(pf.price) : ''}"></div>
                        <div class="al-fila2"><input name="volume" class="mc-sel" type="number" step="any" min="0" inputmode="decimal" placeholder="Lotes" value="${pf.volume != null ? esc(pf.volume) : '0.10'}" required>
                        <input name="stop_loss" class="mc-sel" type="number" step="any" inputmode="decimal" placeholder="Stop loss" value="${pf.sl != null ? esc(pf.sl) : ''}"><input name="take_profit" class="mc-sel" type="number" step="any" inputmode="decimal" placeholder="Take profit" value="${pf.tp != null ? esc(pf.tp) : ''}"></div>
                        <div class="al-fila2"><button type="submit" data-side="buy" class="pp-buy">COMPRAR</button><button type="submit" data-side="sell" class="pp-sell">VENDER</button></div>
                        <p class="mc-nota">Máximo ${est.max_lots} lotes por orden. Tip: dibuja una posición Long/Short y usa su botón BUY/SELL: trae el lote calculado según tu riesgo.</p></form>`;
                } else if (c && tab === 'ord') {
                    panel = (vivo.orders || []).map((o) => `<div class="al-fila"><div class="al-txt"><b>${esc(o.symbol)}</b> ${o.side === 'buy' ? 'COMPRA' : 'VENTA'} ${esc(String(o.type || '').toUpperCase())} ${esc(o.volume)} @ ${esc(o.price)}<br><small>${o.stop_loss ? `SL ${esc(o.stop_loss)}` : 'sin SL'} · ${o.take_profit ? `TP ${esc(o.take_profit)}` : 'sin TP'}</small></div>
                        <button type="button" data-tr="cancelar-orden" data-ticket="${esc(o.ticket)}" title="Cancelar orden" aria-label="Cancelar orden"><i class="ph ph-trash"></i></button></div>`).join('') || '<p class="mc-nota">No hay órdenes pendientes. Crea una desde la pestaña Operar (Límite o Stop).</p>';
                } else if (c && tab === 'hist') {
                    panel = htmlHistorial(c);
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
                const confirmaOn = state.prefs().confirmarOrden !== false;
                const interruptor = c ? `<label class="tr-sw" title="Afecta al botón BUY/SELL de las posiciones que dibujas en el gráfico"><input type="checkbox" data-tr-confirmar ${confirmaOn ? 'checked' : ''}><span class="tr-sw-t"><b>Pedir confirmación</b> en el botón BUY/SELL de mis posiciones<small>${confirmaOn ? 'Activado: un primer toque arma el botón y el segundo envía la orden.' : 'Desactivado: un solo toque envía la orden real al instante.'}</small></span></label>` + `<label class="tr-sw"><input type="checkbox" data-tr-sonido ${NLTCharts.sonidos && NLTCharts.sonidos.activo() ? 'checked' : ''}><span class="tr-sw-t"><b>Sonidos de NLT Charts</b> al abrir, cerrar y mover operaciones<small>Tonos cortos y suaves. Puedes apagarlos aquí cuando quieras.</small></span></label>` : '';
                cuerpo = `${modo}${sel}${errorVivo ? `<p class="al-msg">${esc(errorVivo)}</p>${c ? `<form data-tr-reconectar class="al-fila2"><input name="password" class="mc-sel" type="password" autocomplete="off" placeholder="${c.auto_reconnect ? 'Contraseña (opcional)' : 'Contraseña de trading'}"${c.auto_reconnect ? '' : ' required'}><button type="submit" class="mc-d on">Reconectar</button></form>` : ''}` : ''}${form}${resumen}${tabs}${msg ? `<p class="al-msg">${esc(msg)}</p>` : ''}${panel}
                    ${interruptor}<p class="mc-nota">Operar con dinero real implica riesgo de pérdida. Las posiciones, SL y TP se ven y se mueven también directo en el gráfico.</p>`;
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
            if (t) { tab = t.dataset.tab; msg = ''; pendiente = null; pintar(); posicionar(); if (tab === 'sym' && !mapa) cargarMapa(); if (tab === 'hist') cargarHistorial(); return; }
            const a = e.target.closest('[data-tr]'); if (!a) return;
            const acc = a.dataset.tr;
            if (acc === 'mas') { mostrarConexion = !mostrarConexion; pintar(); posicionar(); return; }
            if (acc === 'cancelar') { pendiente = null; pintar(); posicionar(); return; }
            if (acc === 'rango') { histDias = Number(a.dataset.dias) || 30; hist = null; pintar(); posicionar(); cargarHistorial(); return; }
            if (acc === 'hist-recargar') { hist = null; pintar(); posicionar(); cargarHistorial(); return; }
            try {
                if (acc === 'desconectar') {
                    if (!window.confirm('¿Desconectar esta cuenta de NLT Charts? No cierra tus operaciones en el broker.')) return;
                    await NLT_API.chartsTraderDesconectar(cuentaId); vivo = { summary: null, positions: [], orders: [] }; await cargarEstado(); msg = 'Cuenta desconectada.';
                } else if (acc === 'confirmar' && pendiente) {
                    const orden = pendiente; pendiente = null;
                    try {
                        const r = await NLT_API.chartsTraderOrden(cuentaId, orden);
                        msg = r.status === 'duplicate' ? 'Esa orden ya se había enviado.' : (orden.type === 'market' ? 'Orden ejecutada.' : 'Orden pendiente creada.');
                        prefill = null; tab = orden.type === 'market' ? 'pos' : 'ord'; aperturaLocal(orden, r);
                    } catch (err) { msg = err.message || 'El broker rechazó la orden.'; sonido('error'); }
                } else if (acc === 'cancelar-orden') {
                    const tk = a.dataset.ticket;
                    await NLT_API.chartsTraderCancelarOrden(cuentaId, tk); msg = 'Orden cancelada.'; sonido('cancelar');
                    vivo.orders = (vivo.orders || []).filter((o) => String(o.ticket) !== String(tk)); chips.actualizar(); confirmarEnSegundoPlano();
                } else if (acc === 'sugeridos' && mapa) {
                    mapa.map = { ...mapa.suggested }; msg = 'Sugeridos cargados: pulsa Guardar.';
                } else if (acc === 'cerrar') {
                    const ticket = a.dataset.ticket;
                    if (cierreArmado !== ticket) { cierreArmado = ticket; a.innerHTML = '<span style="font-size:11px;font-weight:700;color:#fff;background:#DC2626;border-radius:6px;padding:4px 6px">Cerrar</span>'; setTimeout(() => { if (cierreArmado === ticket) { cierreArmado = null; pintar(); } }, 3000); return; }
                    cierreArmado = null;
                    const cerrada = vivo.positions.find((x) => String(x.ticket) === String(ticket));
                    await NLT_API.chartsTraderCerrar(cuentaId, ticket); msg = 'Posición cerrada.';
                    propios.set(String(ticket), Date.now() + 10000);
                    const gcierre = cerrada ? Number(cerrada.profit) || 0 : 0; sonido(gcierre > 0.005 ? 'ganancia' : gcierre < -0.005 ? 'perdida' : 'cerrar');
                    vivo.positions = vivo.positions.filter((x) => String(x.ticket) !== String(ticket)); chips.actualizar(); pintarSaldo(); confirmarEnSegundoPlano();
                }
            } catch (err) { msg = err.message || 'No se pudo completar.'; }
            pintar(); posicionar(); chips.actualizar();
        });
        pop.addEventListener('change', async (e) => {
            if (e.target.matches('[data-tr-sonido]')) { if (NLTCharts.sonidos) NLTCharts.sonidos.alternar(e.target.checked); return; }
            if (e.target.matches('[data-tr-confirmar]')) {
                if (!e.target.checked && !window.confirm('Con un solo toque, el botón BUY/SELL enviará la orden REAL al instante. ¿Quieres desactivar la confirmación?')) { e.target.checked = true; return; }
                state.savePrefs({ confirmarOrden: e.target.checked });
                if (NLTCharts.ui.toast) NLTCharts.ui.toast(e.target.checked ? 'Confirmación activada: BUY/SELL pide un segundo toque.' : 'Un solo toque: BUY/SELL envía la orden al instante.', e.target.checked ? 'ok' : '');
                pintar(); posicionar();
                return;
            }
            if (e.target.matches('[data-tr-cuenta]')) { cuentaId = e.target.value; state.savePrefs({ traderCuenta: cuentaId }); mapa = null; hist = null; vivo = { summary: null, positions: [], orders: [] }; pintarSaldo(); pintar(); await refrescar(); posicionar(); }
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
            if (e.target.matches('[data-tr-reconectar]')) {
                const b = e.target.querySelector('button[type=submit]'); b.disabled = true; b.textContent = 'Reconectando…';
                try { await NLT_API.chartsTraderReconectar(cuentaId, String(f.get('password') || '')); msg = 'Cuenta reconectada.'; await cargarEstado(); await refrescar(); }
                catch (err) { msg = err.message || 'No se pudo reconectar.'; }
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
            // Panel «Trade» (estilo MT5): datos en vivo de la cuenta real y sus acciones
            alCambiar(fn) { oyentesPanel.add(fn); return () => oyentesPanel.delete(fn); },
            datosPanel() {
                const c = cuentaActual();
                if (!c) return null;
                const s = vivo.summary || {};
                return {
                    fuente: 'real', etiqueta: 'Real', cuenta: { id: c.id, login: c.login, server: c.server }, error: errorVivo || '', dec: (sym) => decimales(sym),
                    summary: { balance: s.balance != null ? s.balance : c.balance, equity: s.equity, margin: s.margin, free_margin: s.free_margin, margin_level: s.margin_level, profit: gpAbierta() },
                    positions: (vivo.positions || []).map((p) => ({ id: String(p.ticket), sym: p.symbol, nlt: p.nlt_symbol || p.symbol, side: p.side, lots: p.volume, open: p.open_price, current: p.current_price, sl: p.stop_loss, tp: p.take_profit, pl: Number(p.profit) || 0 })),
                    orders: (vivo.orders || []).map((o) => ({ id: String(o.ticket), sym: o.symbol, nlt: o.nlt_symbol || o.symbol, side: o.side, type: o.type, lots: o.volume, price: o.price, sl: o.stop_loss, tp: o.take_profit })),
                };
            },
            async cerrarPosicion(id) { try { await NLT_API.chartsTraderCerrar(cuentaId, id); await refrescar(); return null; } catch (e) { return e.message || 'El broker rechazó el cierre.'; } },
            async cancelarOrden(id) { try { await NLT_API.chartsTraderCancelarOrden(cuentaId, id); await refrescar(); return null; } catch (e) { return e.message || 'El broker rechazó la cancelación.'; } },
            async cambiarSLTP(id, sl, tp) { try { await NLT_API.chartsTraderModificar(cuentaId, id, { stop_loss: sl || 0, take_profit: tp || 0 }); await refrescar(); return null; } catch (e) { return e.message || 'El broker rechazó el cambio.'; } },
            puedeOperar,
            // Long/Short dibujado -> ticket con el lote, SL y TP ya cargados (se confirma a mano).
            /** Long/Short dibujado -> orden real AL INSTANTE (ya confirmada con el segundo toque del botón): lote, entrada, SL y TP salen de la herramienta.
             *  Si no hay plan/cuenta/lote, abre el panel con lo que se pueda para completarlo. */
            async ejecutarPosicion(pos) {
                const avisar = (t, tipo) => (NLTCharts.ui && NLTCharts.ui.toast ? NLTCharts.ui.toast(t, tipo) : null);
                if (!pos) return;
                if (!est || !puedeOperar()) await cargarEstado();     // por si acaba de activarse el plan o de conectar la cuenta
                if (!puedeOperar() || !(pos.lotes > 0)) {
                    api.desdePosicion(pos);
                    avisar(!(est && est.has_access) ? 'Necesitas el plan Charts Trader para operar con tu cuenta.' : !cuentaActual() ? 'Conecta una cuenta MT5 para operar (empieza con una DEMO).' : !est.execution_enabled ? 'La ejecución de órdenes todavía no está activada.' : 'No pude calcular el lote: pon el tamaño de tu cuenta y el riesgo en la herramienta, o elige los lotes aquí.');
                    return;
                }
                const sym = pos.simbolo || getSymbol(), dec = decimales(sym), r = (x) => (x == null ? null : Number(Number(x).toFixed(dec)));
                const px = ultimoPrecio();
                // Auto: PENDIENTE en la entrada exacta que dibujaste (límite si el precio debe venir a buscarla, stop si debe romperla). También puedes forzar mercado, límite o stop.
                const tipo = tipoDeOrden(pos, px);
                const malo = tipo !== 'market' ? tipoInvalido(tipo, pos.lado, pos.entrada, px) : null;
                if (malo) { avisar(malo, 'error'); return; }
                const orden = { symbol: sym, side: pos.lado === 'BUY' ? 'buy' : 'sell', volume: pos.lotes, type: tipo, ...(tipo === 'market' ? {} : { price: r(pos.entrada) }), stop_loss: r(pos.sl), take_profit: r(pos.tp), client_id: idUnico() };
                avisar(`Enviando ${pos.lado === 'BUY' ? 'compra' : 'venta'} de ${pos.lotes} lotes de ${sym}…`);
                try {
                    const resp = await NLT_API.chartsTraderOrden(cuentaId, orden);
                    avisar(resp.status === 'duplicate' ? 'Esa orden ya se había enviado.' : `✓ ${orden.side === 'buy' ? 'Compra' : 'Venta'} ${tipo === 'market' ? 'a mercado ejecutada' : (tipo === 'limit' ? 'límite' : 'stop') + ' puesta en ' + orden.price}: ${pos.lotes} lotes de ${sym}${orden.stop_loss ? ' · SL ' + orden.stop_loss : ''}${orden.take_profit ? ' · TP ' + orden.take_profit : ''}`, 'ok');
                    aperturaLocal(orden, resp);
                } catch (err) { avisar(err.message || 'El broker rechazó la orden.', 'error'); sonido('error'); }
            },
            // Posiciones abiertas de la cuenta conectada (solo lectura): News Radar avisa si una noticia puede afectarlas.
            posiciones() { return (vivo.positions || []).map((p) => ({ symbol: p.symbol, nlt_symbol: p.nlt_symbol, side: p.side, volume: p.volume, profit: p.profit })); },
            desdePosicion(pos) {
                if (!pos) return;
                const px = ultimoPrecio();
                const tipo = tipoDeOrden(pos, px);
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
