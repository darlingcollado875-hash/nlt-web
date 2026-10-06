/* NLT Charts -- Simulador (paper trading): practica con dinero virtual, sin riesgo.
 *
 * Cuenta virtual (saldo inicial a tu elección) con órdenes a mercado, límite y stop, stop loss y take profit,
 * posiciones abiertas con ganancia/pérdida en vivo e historial. NO usa tu cuenta real ni envía nada al broker:
 * vive solo en tu navegador/cuenta de NLT (se guarda con tus preferencias).
 *
 * Cómo evalúa: cada 5 s pide las cotizaciones de los símbolos con posiciones u órdenes y revisa entradas, stop loss
 * y take profit con ese precio -- SOLO mientras NLT Charts está abierto (no hay un servidor ejecutando tus órdenes).
 * Sin comisión ni spread; el apalancamiento es 1:100. La conversión a dólares es aproximada en pares sin USD. */
(function () {
    const REFRESCO_MS = 5000;
    const REFRESCO_ACTIVO_MS = 3000;   // con posiciones u órdenes abiertas se revisa más seguido
    const APALANCAMIENTO = 100;
    const MAX_POSICIONES = 20, MAX_ORDENES = 30, MAX_HISTORIAL = 200;
    const SALDO_DEF = 10000;
    const GRUPO = 'nlt-paper';

    // Tamaño del contrato por 1 lote.
    function contrato(sym, categoria) {
        if (categoria === 'forex') return 100000;
        if (sym === 'XAUUSD') return 100;
        if (sym === 'XAGUSD') return 5000;
        if (categoria === 'energy') return 1000;
        return 1;
    }
    const dinero = (n) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const uid = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    // Ganancia/pérdida en dólares de `lotes` entre dos precios (la pura, testeable).
    function pnl(side, entrada, salida, lotes, tam, conv) {
        return (side === 'buy' ? salida - entrada : entrada - salida) * lotes * tam * conv;
    }
    // Factor para pasar la moneda de cotización a USD (aproximado con el precio actual en pares USDxxx).
    function convUSD(sym, precio) {
        if (sym.endsWith('USD')) return 1;
        if (sym.startsWith('USD') && precio) return 1 / precio;
        if (/^[A-Z]{6}$/.test(sym)) return ({ JPY: 0.0066, CAD: 0.73, CHF: 1.13, GBP: 1.27, AUD: 0.65, NZD: 0.60, EUR: 1.08 })[sym.slice(3)] || 1;   // cruces sin USD: aproximado
        return 1;
    }

    // ¿Debe ejecutarse la orden pendiente? Mira el precio actual Y los extremos (alto/bajo) de las velas de 1 minuto desde que
    // se creó la orden: así un pico entre dos revisiones no se pierde. Devuelve el precio de entrada o null.
    function llenaOrden(o, precio, alto, bajo) {
        const techo = Math.max(precio, alto == null ? precio : alto), piso = Math.min(precio, bajo == null ? precio : bajo);
        if (o.side === 'buy') {
            if (o.type === 'limit' && piso <= o.price) return o.price;
            if (o.type === 'stop' && techo >= o.price) return o.price;
        } else {
            if (o.type === 'limit' && techo >= o.price) return o.price;
            if (o.type === 'stop' && piso <= o.price) return o.price;
        }
        return null;
    }
    // ¿Salta SL o TP? Igual: precio actual + extremos de las velas posteriores a la apertura. Si en el mismo minuto se tocan
    // los dos no se sabe cuál fue primero: gana el stop (lo conservador).
    function cierraPosicion(p, precio, alto, bajo) {
        const techo = Math.max(precio, alto == null ? precio : alto), piso = Math.min(precio, bajo == null ? precio : bajo);
        if (p.side === 'buy') {
            if (p.sl != null && piso <= p.sl) return { precio: p.sl, motivo: 'SL' };
            if (p.tp != null && techo >= p.tp) return { precio: p.tp, motivo: 'TP' };
        } else {
            if (p.sl != null && techo >= p.sl) return { precio: p.sl, motivo: 'SL' };
            if (p.tp != null && piso <= p.tp) return { precio: p.tp, motivo: 'TP' };
        }
        return null;
    }
    // Extremos de las velas de 1 min que EMPEZARON después de `desde` (la vela en la que ocurrió el hecho no cuenta: parte de
    // su rango es anterior). Devuelve { alto, bajo } o {}.
    function extremosDesde(velas, desde) {
        let alto = null, bajo = null;
        (velas || []).forEach((v) => {
            if (v.t < desde) return;
            alto = alto == null ? v.h : Math.max(alto, v.h);
            bajo = bajo == null ? v.l : Math.min(bajo, v.l);
        });
        return { alto, bajo };
    }
    /** Tipo de la orden PENDIENTE que deja una posición dibujada exactamente en su entrada: límite si el precio tiene que venir a buscarla, stop si tiene que romperla. */
    function tipoPendiente(lado, entrada, px) {
        if (px == null || !Number.isFinite(px)) return 'limit';
        return lado === 'BUY' ? (entrada <= px ? 'limit' : 'stop') : (entrada >= px ? 'limit' : 'stop');
    }
    function validar(t, precio) {
        const { side, type, lots, price, sl, tp } = t;
        if (!(lots > 0) || lots > 1000) return 'El tamaño debe ser mayor que 0.';
        const ref = type === 'market' ? precio : price;
        if (!(ref > 0)) return 'Falta el precio.';
        if (type === 'limit' && ((side === 'buy' && price > precio) || (side === 'sell' && price < precio))) return side === 'buy' ? 'Una compra límite va POR DEBAJO del precio actual.' : 'Una venta límite va POR ENCIMA del precio actual.';
        if (type === 'stop' && ((side === 'buy' && price < precio) || (side === 'sell' && price > precio))) return side === 'buy' ? 'Una compra stop va POR ENCIMA del precio actual.' : 'Una venta stop va POR DEBAJO del precio actual.';
        if (sl != null && ((side === 'buy' && sl >= ref) || (side === 'sell' && sl <= ref))) return side === 'buy' ? 'El stop loss de una compra va por debajo de la entrada.' : 'El stop loss de una venta va por encima de la entrada.';
        if (tp != null && ((side === 'buy' && tp <= ref) || (side === 'sell' && tp >= ref))) return side === 'buy' ? 'El take profit de una compra va por encima de la entrada.' : 'El take profit de una venta va por debajo de la entrada.';
        return null;
    }

    function montar({ chart, simbolos, getSymbol }) {
        const state = NLTCharts.state, esc = NLTCharts.ui.esc;
        const info = Object.fromEntries(simbolos.map((s) => [s.symbol, s]));
        const guardado = state.prefs().paper;
        let cuenta = guardado && guardado.v === 1 ? guardado : { v: 1, inicial: SALDO_DEF, saldo: SALDO_DEF, posiciones: [], ordenes: [], historial: [] };
        let precios = {};      // sym -> último precio
        let velas1m = {};      // sym -> velas de 1 min recientes ({t,h,l,c}), para no perder los picos entre revisiones
        let ultimoChequeo = 0; // cuándo se revisó por última vez (para pedir de más al volver a la pestaña)
        let tab = 'ticket', mensaje = '', prefill = null, timer = null;

        const guardar = () => state.savePrefs({ paper: cuenta });
        const tam = (sym) => contrato(sym, info[sym] && info[sym].category);
        const pr = (sym) => (info[sym] ? info[sym].price_precision : 5);
        const flotante = (p) => (precios[p.sym] != null ? pnl(p.side, p.entry, precios[p.sym], p.lots, tam(p.sym), convUSD(p.sym, precios[p.sym])) : 0);
        const flotanteTotal = () => cuenta.posiciones.reduce((a, p) => a + flotante(p), 0);
        const margen = (p) => (precios[p.sym] != null ? (p.lots * tam(p.sym) * precios[p.sym] * convUSD(p.sym, precios[p.sym])) / APALANCAMIENTO : 0);
        const equity = () => cuenta.saldo + flotanteTotal();
        const margenUsado = () => cuenta.posiciones.reduce((a, p) => a + margen(p), 0);

        const btn = document.createElement('button');
        btn.type = 'button'; btn.id = 'chBtnPaper'; btn.className = 'ch-btn ch-herr'; btn.title = 'Simulador: practica con dinero virtual'; btn.setAttribute('aria-label', 'Simulador de trading');
        btn.innerHTML = '<i class="ph ph-game-controller"></i><span class="ch-btn-label">Simulador</span>';
        const pop = document.createElement('div');
        pop.className = 'mc-menu pp-pop'; pop.id = 'chPaper'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Simulador de trading');
        document.body.appendChild(pop);

        // ── líneas y controles sobre el gráfico: ver poschips.js (compartido con Operar con cuenta real) ──
        const colorPL = (g) => (g >= 0 ? '#22C55E' : '#EF4444');
        function descripciones() {
            const sym = getSymbol(), out = [];
            cuenta.posiciones.filter((p) => p.sym === sym).forEach((p) => {
                const f = flotante(p), lado = p.side === 'buy' ? 'BUY' : 'SELL';
                out.push({ clave: `e:${p.id}`, tipo: 'entrada', id: p.id, valor: p.entry, color: colorPL(f), texto: `${lado} ${p.lots} · ${f >= 0 ? '+' : ''}${dinero(f)}`, fantasmas: [p.sl == null ? 'sl' : null, p.tp == null ? 'tp' : null].filter(Boolean) });
                if (p.sl != null) out.push({ clave: `s:${p.id}`, tipo: 'sl', id: p.id, valor: p.sl, color: '#EF4444', texto: `SL ${dinero(pnl(p.side, p.entry, p.sl, p.lots, tam(p.sym), convUSD(p.sym, p.sl)))}` });
                if (p.tp != null) out.push({ clave: `t:${p.id}`, tipo: 'tp', id: p.id, valor: p.tp, color: '#22C55E', texto: `TP +${dinero(pnl(p.side, p.entry, p.tp, p.lots, tam(p.sym), convUSD(p.sym, p.tp)))}` });
            });
            cuenta.ordenes.filter((o) => o.sym === sym).forEach((o) => out.push({ clave: `o:${o.id}`, tipo: 'orden', id: o.id, valor: o.price, color: '#F59E0B', texto: `${o.side === 'buy' ? 'BUY' : 'SELL'} ${o.type.toUpperCase()} ${o.lots}` }));
            return out;
        }
        // Valida un SL/TP nuevo contra la entrada Y contra el precio actual (un stop del lado equivocado cerraría la posición al instante).
        function errorSLTP(p, sl, tp) {
            const px = precios[p.sym];
            const err = validar({ side: p.side, type: 'market', lots: p.lots, price: p.entry, sl, tp }, p.entry);
            if (err) return err;
            if (px != null) {
                if (sl != null && ((p.side === 'buy' && sl >= px) || (p.side === 'sell' && sl <= px))) return 'Ese stop loss ya está del lado del precio actual: cerraría la posición al instante.';
                if (tp != null && ((p.side === 'buy' && tp <= px) || (p.side === 'sell' && tp >= px))) return 'Ese take profit ya está del lado del precio actual: cerraría la posición al instante.';
            }
            return null;
        }
        const chips = NLTCharts.poschips.crear({
            chart, grupo: GRUPO, precision: () => pr(getSymbol()),
            fuente: {
                descripciones,
                alCambiar: () => { programar(); if (!pop.hidden) NLTCharts.ui.conservar(pop, pintar); },
                textoArrastre(d, v) {
                    const p = cuenta.posiciones.find((x) => x.id === d.id);
                    if (p && (d.tipo === 'sl' || d.tipo === 'tp')) { const g = pnl(p.side, p.entry, v, p.lots, tam(p.sym), convUSD(p.sym, v)); return `${d.tipo.toUpperCase()} ${g >= 0 ? '+' : ''}${dinero(g)} · ${v.toFixed(pr(p.sym))}`; }
                    return `${d.texto.split(' @')[0]} @ ${v.toFixed(pr(getSymbol()))}`;
                },
                mover(d, nuevo) {
                    const p = cuenta.posiciones.find((x) => x.id === d.id), o = cuenta.ordenes.find((x) => x.id === d.id);
                    let err = null;
                    if (p && d.tipo === 'sl') { err = errorSLTP(p, nuevo, p.tp); if (!err) p.sl = nuevo; }
                    else if (p && d.tipo === 'tp') { err = errorSLTP(p, p.sl, nuevo); if (!err) p.tp = nuevo; }
                    else if (o) { err = validar({ side: o.side, type: o.type, lots: o.lots, price: nuevo, sl: o.sl, tp: o.tp }, precios[o.sym] != null ? precios[o.sym] : nuevo); if (!err) o.price = nuevo; }
                    if (err) return { error: err };
                    guardar(); return {};
                },
                accion(d, a) {
                    const p = cuenta.posiciones.find((x) => x.id === d.id), o = cuenta.ordenes.find((x) => x.id === d.id);
                    if (a === 'cerrar' && p) {
                        const px = precios[p.sym];
                        if (px == null) return { error: 'Todavía no hay precio para cerrar.' };
                        const g = flotante(p); cerrar(p, px, 'Manual'); guardar();
                        return { aviso: `Posición cerrada: ${g >= 0 ? '+' : ''}${dinero(g)}` };
                    }
                    if (a === 'cancelar' && o) { cuenta.ordenes = cuenta.ordenes.filter((x) => x.id !== o.id); guardar(); return {}; }
                    if (p && (a === 'addsl' || a === 'addtp')) {
                        const base = chips.sugerirDistancia(), dist = base > 0 ? base : Math.abs(p.entry) * 0.005;
                        const px = precios[p.sym] != null ? precios[p.sym] : p.entry, signo = p.side === 'buy' ? 1 : -1;
                        const sl = a === 'addsl' ? px - signo * dist : p.sl, tp = a === 'addtp' ? px + signo * dist * 2 : p.tp;
                        const err = errorSLTP(p, sl, tp);
                        if (err) return { error: err };
                        p.sl = sl != null ? Number(sl.toFixed(pr(p.sym))) : null; p.tp = tp != null ? Number(tp.toFixed(pr(p.sym))) : null; guardar();
                        return { aviso: `${a === 'addsl' ? 'Stop loss' : 'Take profit'} agregado: arrastralo para ajustarlo.` };
                    }
                    if (p && a === 'quitar') { if (d.tipo === 'sl') p.sl = null; else p.tp = null; guardar(); return {}; }
                    return {};
                },
            },
        });
        const avisar = chips.avisar;
        const oyentesPanel = new Set();
        const avisarPanel = () => oyentesPanel.forEach((fn) => { try { fn(); } catch (_) { /* un oyente roto no frena al simulador */ } });
        function pintarLineas() { chips.actualizar(); avisarPanel(); }

        // ── motor: se evalúa con cada cotización nueva ──
        function cerrar(p, precio, motivo) {
            const ganancia = pnl(p.side, p.entry, precio, p.lots, tam(p.sym), convUSD(p.sym, precios[p.sym] || precio));
            cuenta.saldo += ganancia;
            cuenta.posiciones = cuenta.posiciones.filter((x) => x.id !== p.id);
            cuenta.historial.unshift({ id: p.id, sym: p.sym, side: p.side, lots: p.lots, entry: p.entry, exit: precio, pnl: ganancia, motivo, abierta: p.abierta, cerrada: Date.now() });
            cuenta.historial = cuenta.historial.slice(0, MAX_HISTORIAL);
        }
        function evaluar() {
            let cambio = false;
            [...cuenta.ordenes].forEach((o) => {
                const px = precios[o.sym]; if (px == null) return;
                const { alto, bajo } = extremosDesde(velas1m[o.sym], o.creada || 0);
                const entrada = llenaOrden(o, px, alto, bajo);
                if (entrada == null) return;
                cuenta.ordenes = cuenta.ordenes.filter((x) => x.id !== o.id);
                if (cuenta.posiciones.length < MAX_POSICIONES) cuenta.posiciones.push({ id: o.id, sym: o.sym, side: o.side, lots: o.lots, entry: entrada, sl: o.sl, tp: o.tp, abierta: Date.now() });
                cambio = true;
            });
            [...cuenta.posiciones].forEach((p) => {
                const px = precios[p.sym]; if (px == null) return;
                const { alto, bajo } = extremosDesde(velas1m[p.sym], p.abierta || 0);
                const c = cierraPosicion(p, px, alto, bajo);
                if (c) { cerrar(p, c.precio, c.motivo); cambio = true; if (!pop.hidden || p.sym === getSymbol()) avisar(`${c.motivo === 'TP' ? '🎯 Take profit' : '🛑 Stop loss'} alcanzado en ${p.sym}: ${dinero(cuenta.historial[0].pnl)}`); }
            });
            if (cambio) guardar();
            return cambio;
        }
        async function actualizar() {
            const syms = new Set([getSymbol(), ...cuenta.posiciones.map((p) => p.sym), ...cuenta.ordenes.map((o) => o.sym)]);
            // Velas de 1 min de cada símbolo con posiciones u órdenes: dan el precio actual Y el alto/bajo desde la última revisión
            // (un pico que toca el SL/TP entre dos revisiones cierra igual). Al volver a la pestaña se piden más para ponerse al día.
            const faltaron = Math.ceil((Date.now() - (ultimoChequeo || Date.now())) / 60000);
            const limite = Math.max(5, Math.min(300, faltaron + 3));
            const desde = cuenta.posiciones.concat(cuenta.ordenes).reduce((m, x) => Math.min(m, x.abierta || x.creada || Date.now()), Date.now());
            const minutosDesdeApertura = Math.ceil((Date.now() - desde) / 60000) + 3;
            const pedir = Math.max(limite, Math.min(300, minutosDesdeApertura));
            const resultados = await Promise.all([...syms].map(async (sym) => {
                try {
                    const necesitaHistoria = cuenta.posiciones.some((p) => p.sym === sym) || cuenta.ordenes.some((o) => o.sym === sym);
                    const r = await NLT_API.chartsVelas(sym, '1m', { limit: necesitaHistoria ? pedir : 3 });
                    return [sym, r.candles || []];
                } catch (_) { return [sym, null]; }
            }));
            let alguno = false;
            resultados.forEach(([sym, cs]) => {
                if (!cs || !cs.length) return;
                velas1m[sym] = cs; precios[sym] = cs[cs.length - 1].c; alguno = true;
            });
            if (!alguno) return;
            ultimoChequeo = Date.now();
            evaluar(); pintarLineas(); if (!pop.hidden) NLTCharts.ui.conservar(pop, pintar);
        }
        let cadenciaActual = 0;
        function programar() {
            const necesita = !pop.hidden || cuenta.posiciones.length || cuenta.ordenes.length;
            const cadencia = cuenta.posiciones.length || cuenta.ordenes.length ? REFRESCO_ACTIVO_MS : REFRESCO_MS;
            if (timer && cadencia !== cadenciaActual) { clearInterval(timer); timer = null; }
            if (necesita && !timer) { cadenciaActual = cadencia; timer = setInterval(() => { if (!document.hidden) actualizar(); }, cadencia); }
            if (!necesita && timer) { clearInterval(timer); timer = null; }
        }

        // ── acciones ──
        function enviar(t) {
            const sym = getSymbol(), px = precios[sym];
            if (px == null) return 'Todavía no hay precio de este símbolo. Prueba en unos segundos.';
            const err = validar(t, px);
            if (err) return err;
            if (t.type === 'market') {
                if (cuenta.posiciones.length >= MAX_POSICIONES) return `Máximo ${MAX_POSICIONES} posiciones abiertas.`;
                const nuevaMargen = (t.lots * tam(sym) * px * convUSD(sym, px)) / APALANCAMIENTO;
                if (nuevaMargen > equity() - margenUsado()) return `Margen insuficiente: necesitas ${dinero(nuevaMargen)} y tienes libre ${dinero(equity() - margenUsado())}.`;
                cuenta.posiciones.push({ id: uid(), sym, side: t.side, lots: t.lots, entry: px, sl: t.sl, tp: t.tp, abierta: Date.now() });
            } else {
                if (cuenta.ordenes.length >= MAX_ORDENES) return `Máximo ${MAX_ORDENES} órdenes pendientes.`;
                cuenta.ordenes.push({ id: uid(), sym, side: t.side, type: t.type, lots: t.lots, price: t.price, sl: t.sl, tp: t.tp, creada: Date.now() });
            }
            guardar(); pintarLineas(); programar();
            return null;
        }
        const numero = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

        // ── interfaz ──
        function pintar() {
            const sym = getSymbol(), px = precios[sym], p = pr(sym);
            const f = flotanteTotal(), eq = equity();
            const cab = `<div class="mc-tit">Simulador · dinero virtual</div>
                <div class="pp-cuenta"><div><small>Saldo</small><b>${dinero(cuenta.saldo)}</b></div><div><small>Equity</small><b>${dinero(eq)}</b></div>
                <div><small>G/P abierta</small><b style="color:${f >= 0 ? '#22C55E' : '#EF4444'}">${f >= 0 ? '+' : ''}${dinero(f)}</b></div><div><small>Margen libre</small><b>${dinero(eq - margenUsado())}</b></div></div>
                <div class="pp-tabs">${[['ticket', 'Operar'], ['pos', `Posiciones (${cuenta.posiciones.length})`], ['ord', `Órdenes (${cuenta.ordenes.length})`], ['hist', 'Historial']].map(([k, t]) => `<button type="button" data-tab="${k}" class="${tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>
                ${mensaje ? `<p class="al-msg">${esc(mensaje)}</p>` : ''}`;
            let cuerpo = '';
            if (tab === 'ticket') {
                const pf = prefill || {};
                cuerpo = `<form data-pp-form class="al-form"><div class="al-fila2"><b>${esc(sym)}</b><span class="pp-px">${px != null ? px.toFixed(p) : 'sin precio'}</span></div>
                    <div class="al-fila2"><select name="type" class="mc-sel"><option value="market">Mercado</option><option value="limit"${pf.type === 'limit' ? ' selected' : ''}>Límite</option><option value="stop"${pf.type === 'stop' ? ' selected' : ''}>Stop</option></select>
                    <input name="lots" class="mc-sel" type="number" step="any" min="0" inputmode="decimal" placeholder="Lotes" value="${pf.lots != null ? esc(pf.lots) : '0.10'}"><input name="price" class="mc-sel" type="number" step="any" inputmode="decimal" placeholder="Precio" title="Precio de la orden pendiente (límite o stop)" value="${pf.price != null ? esc(pf.price) : ''}"></div>
                    <div class="al-fila2"><input name="sl" class="mc-sel" type="number" step="any" inputmode="decimal" placeholder="Stop loss" value="${pf.sl != null ? esc(pf.sl) : ''}"><input name="tp" class="mc-sel" type="number" step="any" inputmode="decimal" placeholder="Take profit" value="${pf.tp != null ? esc(pf.tp) : ''}"></div>
                    <div class="al-fila2"><button type="submit" data-side="buy" class="pp-buy">COMPRAR</button><button type="submit" data-side="sell" class="pp-sell">VENDER</button></div>
                    <p class="mc-nota">1 lote = ${tam(sym).toLocaleString('en-US')} unidades · apalancamiento 1:${APALANCAMIENTO} · sin comisión ni spread.</p></form>`;
            } else if (tab === 'pos') {
                cuerpo = cuenta.posiciones.map((x) => { const g = flotante(x); return `<div class="al-fila"><div class="al-txt"><b>${esc(x.sym)}</b> ${x.side === 'buy' ? 'COMPRA' : 'VENTA'} ${x.lots} @ ${x.entry.toFixed(pr(x.sym))}
                    <br><small>${precios[x.sym] != null ? `ahora ${precios[x.sym].toFixed(pr(x.sym))}` : 'sin precio'}${x.sl != null ? ` · SL ${x.sl}` : ''}${x.tp != null ? ` · TP ${x.tp}` : ''}</small></div>
                    <b style="color:${g >= 0 ? '#22C55E' : '#EF4444'}">${g >= 0 ? '+' : ''}${dinero(g)}</b>
                    <button type="button" data-pp="editar" data-id="${esc(x.id)}" title="Cambiar SL/TP" aria-label="Cambiar SL y TP"><i class="ph ph-pencil-simple"></i></button>
                    <button type="button" data-pp="cerrar" data-id="${esc(x.id)}" title="Cerrar posición" aria-label="Cerrar posición"><i class="ph ph-x-circle"></i></button></div>`; }).join('') || '<p class="mc-nota">No hay posiciones abiertas.</p>';
            } else if (tab === 'ord') {
                cuerpo = cuenta.ordenes.map((o) => `<div class="al-fila"><div class="al-txt"><b>${esc(o.sym)}</b> ${o.side === 'buy' ? 'COMPRA' : 'VENTA'} ${esc(o.type.toUpperCase())} ${o.lots} @ ${o.price.toFixed(pr(o.sym))}<br><small>${o.sl != null ? `SL ${o.sl} ` : ''}${o.tp != null ? `TP ${o.tp}` : ''}</small></div>
                    <button type="button" data-pp="cancelar" data-id="${esc(o.id)}" title="Cancelar orden" aria-label="Cancelar orden"><i class="ph ph-trash"></i></button></div>`).join('') || '<p class="mc-nota">No hay órdenes pendientes.</p>';
            } else {
                const h = cuenta.historial, ganadas = h.filter((x) => x.pnl > 0).length, total = h.reduce((a, x) => a + x.pnl, 0);
                cuerpo = `${h.length ? `<p class="mc-nota">${h.length} operaciones · ${Math.round((ganadas / h.length) * 100)}% ganadoras · resultado ${dinero(total)}</p>` : ''}` +
                    (h.slice(0, 40).map((x) => `<div class="al-fila"><div class="al-txt"><b>${esc(x.sym)}</b> ${x.side === 'buy' ? 'COMPRA' : 'VENTA'} ${x.lots}<br><small>${x.entry.toFixed(pr(x.sym))} → ${x.exit.toFixed(pr(x.sym))} · ${esc(x.motivo)}</small></div>
                    <b style="color:${x.pnl >= 0 ? '#22C55E' : '#EF4444'}">${x.pnl >= 0 ? '+' : ''}${dinero(x.pnl)}</b></div>`).join('') || '<p class="mc-nota">Todavía no cerraste operaciones.</p>');
            }
            pop.innerHTML = `${cab}<div class="pp-cuerpo">${cuerpo}</div><div class="al-fila2" style="margin-top:10px"><button type="button" data-pp="reiniciar" class="mc-d">Reiniciar cuenta…</button></div>
                <p class="mc-nota">Práctica con dinero virtual: no usa tu cuenta real. Se evalúa con el precio cada 5 s mientras NLT Charts está abierto.</p>`;
        }
        const posicionar = () => { const r = btn.getBoundingClientRect(); pop.style.top = `${r.bottom + 6}px`; pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`; };
        async function abrir(tabNueva) {
            document.querySelectorAll('.mc-menu').forEach((m) => { m.hidden = true; });
            if (tabNueva) tab = tabNueva;
            pintar(); pop.hidden = false; posicionar(); programar();
            await actualizar(); posicionar();
        }
        btn.addEventListener('click', (e) => { e.stopPropagation(); if (!pop.hidden) { pop.hidden = true; programar(); return; } mensaje = ''; abrir(); });
        document.addEventListener('click', (e) => { const ruta = e.composedPath(); if (!pop.hidden && !ruta.includes(pop) && !ruta.includes(btn)) { pop.hidden = true; programar(); } });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { pop.hidden = true; programar(); } });
        pop.addEventListener('click', (e) => {
            const t = e.target.closest('[data-tab]');
            if (t) { tab = t.dataset.tab; mensaje = ''; pintar(); posicionar(); return; }
            const a = e.target.closest('[data-pp]'); if (!a) return;
            const id = a.dataset.id, acc = a.dataset.pp;
            if (acc === 'cerrar') { const x = cuenta.posiciones.find((q) => q.id === id); if (x && precios[x.sym] != null) { cerrar(x, precios[x.sym], 'Manual'); guardar(); pintarLineas(); programar(); } else mensaje = 'Sin precio para cerrar todavía.'; }
            if (acc === 'cancelar') { cuenta.ordenes = cuenta.ordenes.filter((o) => o.id !== id); guardar(); pintarLineas(); programar(); }
            if (acc === 'editar') {
                const x = cuenta.posiciones.find((q) => q.id === id); if (!x) return;
                const sl = window.prompt('Stop loss (vacío = sin stop):', x.sl != null ? x.sl : ''); if (sl === null) return;
                const tp = window.prompt('Take profit (vacío = sin take profit):', x.tp != null ? x.tp : ''); if (tp === null) return;
                const nuevo = { ...x, sl: sl.trim() === '' ? null : numero(sl), tp: tp.trim() === '' ? null : numero(tp) };
                const err = validar({ side: x.side, type: 'market', lots: x.lots, price: x.entry, sl: nuevo.sl, tp: nuevo.tp }, x.entry);
                if (err) mensaje = err; else { x.sl = nuevo.sl; x.tp = nuevo.tp; guardar(); pintarLineas(); mensaje = ''; }
            }
            if (acc === 'reiniciar') {
                const v = window.prompt('Reiniciar la cuenta virtual. Se borran posiciones, órdenes e historial. Saldo inicial:', cuenta.inicial);
                const n = v === null ? null : numero(v);
                if (n != null && n >= 100 && n <= 1e9) { cuenta = { v: 1, inicial: n, saldo: n, posiciones: [], ordenes: [], historial: [] }; guardar(); pintarLineas(); programar(); mensaje = 'Cuenta reiniciada.'; } else if (v !== null) mensaje = 'Saldo inválido (mínimo 100).';
            }
            pintar(); posicionar();
        });
        pop.addEventListener('submit', (e) => {
            e.preventDefault();
            const side = (e.submitter && e.submitter.dataset.side) || 'buy';
            const f = new FormData(e.target), type = f.get('type');
            const t = { side, type, lots: numero(f.get('lots')), price: numero(f.get('price')), sl: numero(f.get('sl')), tp: numero(f.get('tp')) };
            const err = enviar(t);
            mensaje = err || (type === 'market' ? 'Orden ejecutada.' : 'Orden pendiente creada.');
            if (!err) { prefill = null; tab = type === 'market' ? 'pos' : 'ord'; }
            pintar(); posicionar();
        });

        document.addEventListener('visibilitychange', () => { if (!document.hidden && (cuenta.posiciones.length || cuenta.ordenes.length)) actualizar(); });
        const ancla = document.getElementById('chBtnConfig');
        if (ancla) ancla.before(btn);
        programar();
        if (cuenta.posiciones.length || cuenta.ordenes.length) actualizar();
        return {
            cambioSimbolo: () => { pintarLineas(); if (!pop.hidden) actualizar(); },
            // Long/Short dibujado -> ticket ya cargado (lotes = unidades de la posición / tamaño del contrato)
            desdePosicion(o) {
                if (!o) return;
                const sym = getSymbol(), dl = chart.getDataList(), px = precios[sym] != null ? precios[sym] : (dl.length ? dl[dl.length - 1].close : null);
                const lots = o.lotes ? o.lotes : (o.cantidad ? Math.max(0.01, Math.round((o.cantidad / tam(sym)) * 100) / 100) : 0.1);
                // Siempre una orden PENDIENTE justo en la entrada dibujada (nunca a mercado): límite si el precio tiene que venir a buscarla, stop si tiene que romperla
                const dec = pr(sym), r = (x) => (x == null ? null : Number(Number(x).toFixed(dec)));
                const tipo = o.tipo === 'market' || o.tipo === 'limit' || o.tipo === 'stop' ? o.tipo : tipoPendiente(o.lado, o.entrada, px);
                prefill = { type: tipo, lots, price: tipo === 'market' ? null : r(o.entrada), sl: r(o.sl), tp: r(o.tp) };
                mensaje = `Posición ${o.lado === 'BUY' ? 'de compra' : 'de venta'} cargada ${tipo === 'market' ? 'a mercado' : `como orden ${tipo === 'limit' ? 'límite' : 'stop'} en tu entrada (${r(o.entrada)})`}: elige ${o.lado === 'BUY' ? 'COMPRAR' : 'VENDER'} para ${tipo === 'market' ? 'ejecutarla' : 'dejarla puesta'}. Puedes cambiar el tipo abajo.`;
                abrir('ticket');
            },
            estado: () => cuenta,
            // Panel «Trade» (estilo MT5): saldo, equity, posiciones con su ganancia/pérdida en vivo y órdenes pendientes
            alCambiar(fn) { oyentesPanel.add(fn); return () => oyentesPanel.delete(fn); },
            datosPanel() {
                const eq = equity(), mu = margenUsado();
                return {
                    fuente: 'sim', etiqueta: 'Simulador', cuenta: { id: 'sim', login: 'Virtual' }, dec: (sym) => pr(sym),
                    summary: { balance: cuenta.saldo, equity: eq, margin: mu, free_margin: eq - mu, margin_level: mu > 0 ? (eq / mu) * 100 : null, profit: flotanteTotal() },
                    positions: cuenta.posiciones.map((p) => ({ id: p.id, sym: p.sym, nlt: p.sym, side: p.side, lots: p.lots, open: p.entry, current: precios[p.sym] != null ? precios[p.sym] : null, sl: p.sl, tp: p.tp, pl: flotante(p) })),
                    orders: cuenta.ordenes.map((o) => ({ id: o.id, sym: o.sym, nlt: o.sym, side: o.side, type: o.type, lots: o.lots, price: o.price, sl: o.sl, tp: o.tp })),
                };
            },
            cerrarPosicion(id) { const x = cuenta.posiciones.find((q) => q.id === id); if (!x || precios[x.sym] == null) return 'Sin precio para cerrar todavía.'; cerrar(x, precios[x.sym], 'Manual'); guardar(); pintarLineas(); programar(); return null; },
            cancelarOrden(id) { cuenta.ordenes = cuenta.ordenes.filter((o) => o.id !== id); guardar(); pintarLineas(); programar(); return null; },
            cambiarSLTP(id, sl, tp) {
                const x = cuenta.posiciones.find((q) => q.id === id); if (!x) return 'Esa posición ya no está abierta.';
                const err = validar({ side: x.side, type: 'market', lots: x.lots, price: x.entry, sl, tp }, x.entry); if (err) return err;
                x.sl = sl; x.tp = tp; guardar(); pintarLineas(); return null;
            },
        };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.paper = { montar, tipoPendiente, pnl, convUSD, llenaOrden, cierraPosicion, extremosDesde, validar, contrato };
})();
