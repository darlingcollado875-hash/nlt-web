/* NLT Charts -- Simulador (paper trading): practicá con dinero virtual, sin riesgo.
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
    const APALANCAMIENTO = 100;
    const MAX_POSICIONES = 20, MAX_ORDENES = 30, MAX_HISTORIAL = 200;
    const SALDO_DEF = 10000;
    const GRUPO = 'nlt-paper';

    // Tamaño del contrato por 1 lote.
    function contrato(sym, categoria) {
        if (categoria === 'forex') return 100000;
        if (sym === 'XAUUSD') return 100;
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
        return 1;
    }

    // ¿Debe ejecutarse la orden pendiente con este precio? Devuelve el precio de entrada o null.
    function llenaOrden(o, precio) {
        if (o.side === 'buy') {
            if (o.type === 'limit' && precio <= o.price) return o.price;
            if (o.type === 'stop' && precio >= o.price) return precio;
        } else {
            if (o.type === 'limit' && precio >= o.price) return o.price;
            if (o.type === 'stop' && precio <= o.price) return precio;
        }
        return null;
    }
    // ¿Salta SL o TP con este precio? Devuelve { precio, motivo } o null (si ambos, gana el stop: lo conservador).
    function cierraPosicion(p, precio) {
        if (p.side === 'buy') {
            if (p.sl != null && precio <= p.sl) return { precio: p.sl, motivo: 'SL' };
            if (p.tp != null && precio >= p.tp) return { precio: p.tp, motivo: 'TP' };
        } else {
            if (p.sl != null && precio >= p.sl) return { precio: p.sl, motivo: 'SL' };
            if (p.tp != null && precio <= p.tp) return { precio: p.tp, motivo: 'TP' };
        }
        return null;
    }
    function validar(t, precio) {
        const { side, type, lots, price, sl, tp } = t;
        if (!(lots > 0) || lots > 1000) return 'El tamaño debe ser mayor que 0.';
        const ref = type === 'market' ? precio : price;
        if (!(ref > 0)) return 'Falta el precio.';
        if (type === 'limit' && ((side === 'buy' && price >= precio) || (side === 'sell' && price <= precio))) return side === 'buy' ? 'Una compra límite va POR DEBAJO del precio actual.' : 'Una venta límite va POR ENCIMA del precio actual.';
        if (type === 'stop' && ((side === 'buy' && price <= precio) || (side === 'sell' && price >= precio))) return side === 'buy' ? 'Una compra stop va POR ENCIMA del precio actual.' : 'Una venta stop va POR DEBAJO del precio actual.';
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
        btn.type = 'button'; btn.id = 'chBtnPaper'; btn.className = 'ch-btn'; btn.title = 'Simulador: practicá con dinero virtual'; btn.setAttribute('aria-label', 'Simulador de trading');
        btn.innerHTML = '<i class="ph ph-game-controller"></i><span class="ch-btn-label">Simulador</span>';
        const pop = document.createElement('div');
        pop.className = 'mc-menu pp-pop'; pop.id = 'chPaper'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Simulador de trading');
        document.body.appendChild(pop);

        // ── líneas en el gráfico (entrada, SL, TP de las posiciones del símbolo que se ve) ──
        let registrado = false;
        function registrarOverlay() {
            if (registrado) return; registrado = true;
            klinecharts.registerOverlay({
                name: 'nltPaperLine', totalStep: 2, lock: true, needDefaultPointFigure: false, needDefaultXAxisFigure: false, needDefaultYAxisFigure: true,
                createPointFigures: ({ overlay, coordinates, bounding }) => {
                    if (!coordinates.length) return [];
                    const y = coordinates[0].y, e = overlay.extendData || {};
                    return [{ type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x: 0, y }, { x: bounding.width, y }] }, styles: { style: 'dashed', dashedValue: [3, 3], size: 1, color: e.color } },
                        { type: 'text', ignoreEvent: true, attrs: { x: bounding.width - 6, y: y - 3, text: e.texto || '', align: 'right', baseline: 'bottom' }, styles: { color: e.color, size: 11, family: 'Inter, system-ui, sans-serif', weight: 600, backgroundColor: 'transparent', borderSize: 0 } }];
                },
            });
        }
        // ── líneas + controles sobre el gráfico ──
        // Las líneas (entrada, SL, TP, órdenes) las dibuja KLineChart; los controles (cerrar, quitar, arrastrar SL/TP) son
        // fichas HTML pegadas a cada línea: así responden bien al tacto y se pueden arrastrar sin pelear con el gráfico.
        const dom = chart.getDom();
        const stage = (dom && (dom.closest('.ch-stage') || dom.parentElement)) || document.body;
        const capa = document.createElement('div');
        capa.className = 'pp-capa';
        stage.appendChild(capa);
        const aviso = document.createElement('div');
        aviso.className = 'pp-aviso'; aviso.hidden = true; capa.appendChild(aviso);
        let tAviso = null;
        function avisar(txt) { aviso.textContent = txt; aviso.hidden = false; clearTimeout(tAviso); tAviso = setTimeout(() => { aviso.hidden = true; }, 3500); }
        const fichas = new Map();     // clave -> { el, desc }
        let arrastre = null;          // ficha que se está arrastrando: no se repinta ni se mueve sola
        let armadoCierre = null;      // { clave, t } primer toque en ✕ de cerrar (el segundo confirma)
        const yDe = (valor) => {
            try { const c = chart.convertToPixel({ value: valor }, { paneId: 'candle_pane' }); return c && Number.isFinite(c.y) ? c.y : null; } catch (_) { return null; }
        };
        const valorDe = (y) => {
            try { const r = chart.convertFromPixel([{ y }], { paneId: 'candle_pane' }); const v = Array.isArray(r) ? r[0] : r; return v && Number.isFinite(v.value) ? v.value : null; } catch (_) { return null; }
        };
        const desplazamientoY = () => (dom ? dom.getBoundingClientRect().top - stage.getBoundingClientRect().top : 0);
        const colorPL = (g) => (g >= 0 ? '#22C55E' : '#EF4444');

        // Descripción de las fichas que corresponden al estado actual (solo del símbolo que se ve).
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
        function htmlFicha(d) {
            const grip = d.tipo === 'entrada' ? '' : '<i class="pp-grip" title="Arrastrá para mover" aria-hidden="true"></i>';
            const fant = (d.fantasmas || []).map((k) => `<button type="button" class="pp-fant" data-a="add${k}" title="Agregar ${k === 'sl' ? 'stop loss' : 'take profit'}">+ ${k.toUpperCase()}</button>`).join('');
            const armado = armadoCierre && armadoCierre.clave === d.clave && Date.now() - armadoCierre.t < 3000;
            const x = d.tipo === 'entrada' ? `<button type="button" class="pp-x${armado ? ' listo' : ''}" data-a="cerrar" title="Cerrar la posición" aria-label="Cerrar la posición">${armado ? 'Cerrar' : '✕'}</button>`
                : d.tipo === 'orden' ? '<button type="button" class="pp-x" data-a="cancelar" title="Cancelar la orden" aria-label="Cancelar la orden">✕</button>'
                    : `<button type="button" class="pp-x" data-a="quitar" title="Quitar ${d.tipo === 'sl' ? 'el stop loss' : 'el take profit'}" aria-label="Quitar">✕</button>`;
            return `${fant}<span class="pp-ficha" style="--c:${d.color}">${grip}<span class="pp-t">${esc(d.texto)}</span>${x}</span>`;
        }
        function colocar(f) {
            const alto = dom ? dom.clientHeight : 0;
            let y = f.yFija != null ? f.yFija : yDe(f.desc.valor);
            if (y == null) { f.el.style.display = 'none'; return; }
            f.el.style.display = '';
            // Fuera de la pantalla: la ficha queda pegada al borde (con su flecha) para no perder el SL/TP; se puede arrastrar desde ahí.
            const fuera = alto ? (y < 14 ? 'arriba' : y > alto - 14 ? 'abajo' : '') : '';
            if (fuera && alto) y = fuera === 'arriba' ? 14 : alto - 14;
            if (f.fuera !== fuera) { f.el.classList.toggle('fuera', !!fuera); f.el.dataset.fuera = fuera; f.fuera = fuera; }
            const ty = Math.round(y + desplazamientoY());
            if (f.ty !== ty) { f.el.style.transform = `translateY(${ty}px) translateY(-50%)`; f.ty = ty; }
        }
        function sincronizarFichas() {
            const lista = descripciones(), vistas = new Set();
            lista.forEach((d) => {
                vistas.add(d.clave);
                let f = fichas.get(d.clave);
                if (!f) {
                    const el = document.createElement('div');
                    el.className = `pp-chip pp-${d.tipo}`; el.dataset.clave = d.clave;
                    capa.appendChild(el);
                    f = { el, desc: d, ty: null, html: '' };
                    fichas.set(d.clave, f);
                }
                if (arrastre && arrastre.clave === d.clave) return;   // la que se arrastra la maneja el arrastre
                f.desc = d;
                const h = htmlFicha(d);
                if (h !== f.html) { f.el.innerHTML = h; f.html = h; }
                f.yFija = null;
            });
            [...fichas.keys()].forEach((k) => { if (!vistas.has(k)) { fichas.get(k).el.remove(); fichas.delete(k); } });
            fichas.forEach(colocar);
            if (fichas.size) bucleY(); 
        }
        let rafY = null;
        function bucleY() {
            if (rafY) return;
            const paso = () => {
                rafY = null;
                if (!fichas.size) return;
                if (!document.hidden) fichas.forEach(colocar);
                rafY = requestAnimationFrame(paso);
            };
            rafY = requestAnimationFrame(paso);
        }

        function pintarLineas() {
            registrarOverlay();
            if (!arrastre) {
                try { chart.removeOverlay({ groupId: GRUPO }); } catch (_) { /* nada */ }
                const ult = chart.getDataList().slice(-1)[0];
                if (ult) {
                    const linea = (clave, valor, color) => chart.createOverlay({ id: `pp-${clave}`, name: 'nltPaperLine', groupId: GRUPO, lock: true, points: [{ timestamp: ult.timestamp, value: valor }], extendData: { texto: '', color } });
                    descripciones().forEach((d) => linea(d.clave, d.valor, d.tipo === 'entrada' ? '#9CA3AF' : d.color));
                }
            }
            sincronizarFichas();
        }

        // ── acciones de las fichas ──
        function sugerirDistancia(p) {
            const ult = chart.getDataList().slice(-14);
            const rango = ult.length ? ult.reduce((a, k) => a + (k.high - k.low), 0) / ult.length : 0;
            return rango > 0 ? rango * 1.5 : Math.abs(p.entry) * 0.005;
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
        function accionFicha(clave, a) {
            const f = fichas.get(clave); if (!f) return;
            const d = f.desc, p = cuenta.posiciones.find((x) => x.id === d.id), o = cuenta.ordenes.find((x) => x.id === d.id);
            if (a === 'cerrar' && p) {
                if (!armadoCierre || armadoCierre.clave !== clave || Date.now() - armadoCierre.t > 3000) {
                    armadoCierre = { clave, t: Date.now() };
                    const x = f.el.querySelector('.pp-x'); if (x) { x.textContent = 'Cerrar'; x.classList.add('listo'); }
                    setTimeout(() => { if (armadoCierre && armadoCierre.clave === clave) { armadoCierre = null; const x2 = f.el.querySelector('.pp-x'); if (x2) { x2.textContent = '✕'; x2.classList.remove('listo'); } } }, 3000);
                    return;
                }
                armadoCierre = null;
                const px = precios[p.sym];
                if (px == null) { avisar('Todavía no hay precio para cerrar.'); return; }
                const g = flotante(p); cerrar(p, px, 'Manual'); guardar(); avisar(`Posición cerrada: ${g >= 0 ? '+' : ''}${dinero(g)}`);
            } else if (a === 'cancelar' && o) {
                cuenta.ordenes = cuenta.ordenes.filter((x) => x.id !== o.id); guardar();
            } else if (p && (a === 'addsl' || a === 'addtp')) {
                const dist = sugerirDistancia(p), px = precios[p.sym] != null ? precios[p.sym] : p.entry, signo = p.side === 'buy' ? 1 : -1;
                const sl = a === 'addsl' ? px - signo * dist : p.sl, tp = a === 'addtp' ? px + signo * dist * 2 : p.tp;
                const err = errorSLTP(p, sl, tp);
                if (err) { avisar(err); return; }
                p.sl = sl != null ? Number(sl.toFixed(pr(p.sym))) : null; p.tp = tp != null ? Number(tp.toFixed(pr(p.sym))) : null; guardar();
                avisar(`${a === 'addsl' ? 'Stop loss' : 'Take profit'} agregado: arrastralo para ajustarlo.`);
            } else if (p && a === 'quitar') {
                if (d.tipo === 'sl') p.sl = null; else p.tp = null;
                guardar();
            }
            pintarLineas(); programar(); if (!pop.hidden) pintar();
        }
        capa.addEventListener('click', (e) => {
            const b = e.target.closest('button[data-a]'); if (!b) return;
            const ficha = b.closest('.pp-chip'); if (ficha) accionFicha(ficha.dataset.clave, b.dataset.a);
        });

        // ── arrastrar SL / TP / órdenes pendientes ──
        capa.addEventListener('pointerdown', (e) => {
            const grip = e.target.closest('.pp-grip, .pp-t'); const ficha = e.target.closest('.pp-chip');
            if (!grip || !ficha || e.target.closest('button')) return;
            const f = fichas.get(ficha.dataset.clave);
            if (!f || f.desc.tipo === 'entrada') return;
            e.preventDefault();
            try { e.target.closest('.pp-ficha').setPointerCapture(e.pointerId); } catch (_) { /* sin captura: el arrastre igual funciona con el ratón */ }
            arrastre = { clave: f.desc.clave, f, id: e.pointerId, valor: f.desc.valor };
            ficha.classList.add('arrastrando');
            if (window.NLTCharts && NLTCharts.motor) { /* el gráfico no se mueve: el evento no le llega a la capa */ }
        });
        capa.addEventListener('pointermove', (e) => {
            if (!arrastre || e.pointerId !== arrastre.id) return;
            const r = stage.getBoundingClientRect();
            const y = e.clientY - r.top - desplazamientoY();
            const v = valorDe(y); if (v == null) return;
            const f = arrastre.f, d = f.desc;
            arrastre.valor = v; f.yFija = Math.max(0, Math.min(dom.clientHeight, y));
            const p = cuenta.posiciones.find((x) => x.id === d.id);
            let t = d.texto;
            if (p && (d.tipo === 'sl' || d.tipo === 'tp')) { const g = pnl(p.side, p.entry, v, p.lots, tam(p.sym), convUSD(p.sym, v)); t = `${d.tipo.toUpperCase()} ${g >= 0 ? '+' : ''}${dinero(g)} · ${v.toFixed(pr(p.sym))}`; }
            else t = `${d.texto.split(' @')[0]} @ ${v.toFixed(pr(getSymbol()))}`;
            const tt = f.el.querySelector('.pp-t'); if (tt) tt.textContent = t;
            try { chart.overrideOverlay({ id: `pp-${d.clave}`, points: [{ timestamp: chart.getDataList().slice(-1)[0].timestamp, value: v }] }); } catch (_) { /* sin línea */ }
            colocar(f);
        });
        function terminarArrastre(e, confirmar) {
            if (!arrastre || (e && e.pointerId !== arrastre.id)) return;
            const { f, valor } = arrastre, d = f.desc;
            arrastre.f.el.classList.remove('arrastrando');
            arrastre = null;
            if (confirmar) {
                const dec = pr(getSymbol()), nuevo = Number(valor.toFixed(dec));
                const p = cuenta.posiciones.find((x) => x.id === d.id), o = cuenta.ordenes.find((x) => x.id === d.id);
                let err = null;
                if (p && d.tipo === 'sl') { err = errorSLTP(p, nuevo, p.tp); if (!err) p.sl = nuevo; }
                else if (p && d.tipo === 'tp') { err = errorSLTP(p, p.sl, nuevo); if (!err) p.tp = nuevo; }
                else if (o) { err = validar({ side: o.side, type: o.type, lots: o.lots, price: nuevo, sl: o.sl, tp: o.tp }, precios[o.sym] != null ? precios[o.sym] : nuevo); if (!err) o.price = nuevo; }
                if (err) avisar(err); else guardar();
            }
            f.html = ''; pintarLineas(); if (!pop.hidden) pintar();
        }
        capa.addEventListener('pointerup', (e) => terminarArrastre(e, true));
        capa.addEventListener('pointercancel', (e) => terminarArrastre(e, false));

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
                const entrada = llenaOrden(o, px);
                if (entrada == null) return;
                cuenta.ordenes = cuenta.ordenes.filter((x) => x.id !== o.id);
                if (cuenta.posiciones.length < MAX_POSICIONES) cuenta.posiciones.push({ id: o.id, sym: o.sym, side: o.side, lots: o.lots, entry: entrada, sl: o.sl, tp: o.tp, abierta: Date.now() });
                cambio = true;
            });
            [...cuenta.posiciones].forEach((p) => {
                const px = precios[p.sym]; if (px == null) return;
                const c = cierraPosicion(p, px);
                if (c) { cerrar(p, c.precio, c.motivo); cambio = true; }
            });
            if (cambio) guardar();
            return cambio;
        }
        async function actualizar() {
            const syms = new Set([getSymbol(), ...cuenta.posiciones.map((p) => p.sym), ...cuenta.ordenes.map((o) => o.sym)]);
            // para convertir a dólares los pares sin USD alcanza con el precio de cada par (aproximado)
            try {
                const r = await NLT_API.chartsQuotes([...syms]);
                (r.quotes || []).forEach((q) => { if (q.last != null) precios[q.symbol] = q.last; });
            } catch (_) { return; }
            evaluar(); pintarLineas(); if (!pop.hidden) pintar();
        }
        function programar() {
            const necesita = !pop.hidden || cuenta.posiciones.length || cuenta.ordenes.length;
            if (necesita && !timer) timer = setInterval(() => { if (!document.hidden) actualizar(); }, REFRESCO_MS);
            if (!necesita && timer) { clearInterval(timer); timer = null; }
        }

        // ── acciones ──
        function enviar(t) {
            const sym = getSymbol(), px = precios[sym];
            if (px == null) return 'Todavía no hay precio de este símbolo. Probá en unos segundos.';
            const err = validar(t, px);
            if (err) return err;
            if (t.type === 'market') {
                if (cuenta.posiciones.length >= MAX_POSICIONES) return `Máximo ${MAX_POSICIONES} posiciones abiertas.`;
                const nuevaMargen = (t.lots * tam(sym) * px * convUSD(sym, px)) / APALANCAMIENTO;
                if (nuevaMargen > equity() - margenUsado()) return `Margen insuficiente: necesitás ${dinero(nuevaMargen)} y tenés libre ${dinero(equity() - margenUsado())}.`;
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
                    <input name="lots" class="mc-sel" type="number" step="any" min="0" inputmode="decimal" placeholder="Lotes" value="${pf.lots != null ? esc(pf.lots) : '0.10'}"><input name="price" class="mc-sel" type="number" step="any" inputmode="decimal" placeholder="Precio (límite/stop)" value="${pf.price != null ? esc(pf.price) : ''}"></div>
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

        const ancla = document.getElementById('chBtnConfig');
        if (ancla) ancla.before(btn);
        programar();
        if (cuenta.posiciones.length || cuenta.ordenes.length) actualizar();
        return {
            cambioSimbolo: () => { pintarLineas(); if (!pop.hidden) actualizar(); },
            // Long/Short dibujado -> ticket ya cargado (lotes = unidades de la posición / tamaño del contrato)
            desdePosicion(o) {
                if (!o) return;
                const sym = getSymbol(), px = precios[sym];
                const lots = o.cantidad ? Math.max(0.01, Math.round((o.cantidad / tam(sym)) * 100) / 100) : 0.1;
                const cerca = px != null && Math.abs(o.entrada - px) / px < 0.0003;
                prefill = { type: cerca ? 'market' : (o.lado === 'BUY' ? (o.entrada < (px || o.entrada) ? 'limit' : 'stop') : (o.entrada > (px || o.entrada) ? 'limit' : 'stop')), lots, price: cerca ? null : o.entrada, sl: o.sl, tp: o.tp };
                mensaje = `Posición ${o.lado === 'BUY' ? 'de compra' : 'de venta'} cargada: elegí COMPRAR o VENDER para confirmar.`;
                abrir('ticket');
            },
            estado: () => cuenta,
        };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.paper = { montar, pnl, convUSD, llenaOrden, cierraPosicion, validar, contrato };
})();
