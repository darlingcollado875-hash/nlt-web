/* NLT Charts -- navegación por el histórico profundo: IR A FECHA / IR A AÑO.
 *
 * El gráfico deja de estar atado al presente: se puede saltar a cualquier fecha que tenga la fuente de
 * precios (meses o años atrás). El motor (engine.irAFecha) decide cómo:
 *   - la fecha ya está cargada          -> salto inmediato (caché del navegador)
 *   - está a uno o dos bloques          -> completa hacia la izquierda (queda contiguo)
 *   - está lejos                        -> abre una VENTANA alrededor de la fecha (no carga lo intermedio)
 * Las velas salen de la capa histórica compartida del servidor (/charts/history): lo que ya bajó el
 * Backtest o el Replay no se vuelve a pedir, y del proveedor se piden solo los huecos, en tramos.
 *
 * En una ventana del pasado (modo "Histórico"):
 *   - los indicadores piden sus velas de otros timeframes HASTA el final de la ventana (no las del vivo);
 *   - el NLT Zone Engine se calcula en el servidor con el histórico hasta la última vela de la ventana;
 *   - NLT AI queda en pausa (analiza el vivo) y no hay suscripción en vivo;
 *   - la ventana crece hacia la derecha al avanzar y, al llegar al presente, vuelve sola al vivo.
 * Cada cambio es una nueva generación de dataset: nada calculado con otro dataset se dibuja. */
(function () {
    const DUR = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1H': 3600000, '4H': 14400000, '1D': 86400000 };
    const esc = (t) => NLTCharts.ui.esc(t);
    const dos = (n) => String(n).padStart(2, '0');
    const fechaLocal = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`; };
    const fmt = (ms) => new Date(ms).toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const seg = (ms) => `${(ms / 1000).toFixed(1)} s`;

    function montar({ el, boton }) {
        if (!el || !boton) return null;
        const app = NLTCharts.app, motor = app.motor, market = NLTCharts.market;
        const st = { abierto: false, cargando: false, prog: null, error: '', fecha: fechaLocal(Date.now() - 365 * 86400000), hora: '10:00',
            disp: null, ventana: null, ultimo: null };
        let fuenteActiva = false;

        function limpiarCaches() {
            if (NLTCharts.unified && NLTCharts.unified.limpiarCache) NLTCharts.unified.limpiarCache();
            if (NLTCharts.freeIndicators && NLTCharts.freeIndicators.limpiarCache) NLTCharts.freeIndicators.limpiarCache();
        }
        // velas de otros timeframes para los indicadores: hasta el final de la ventana, del histórico compartido
        async function fuenteHTF(symbol, tf, { limit } = {}) {
            const v = motor.enVentana();
            const durChart = DUR[app.timeframe()] || 900000, durTf = DUR[tf] || durChart;
            const fin = ((v && (v.fin || v.centro)) || Date.now()) + durChart;       // cierre de la última vela de la ventana
            const hasta = fin + durTf;                                              // incluye la vela del otro timeframe que la contiene
            const desde = hasta - Math.min(limit || 500, 1500) * durTf * 1.45;
            const r = await market.historia(symbol, tf, desde, hasta);
            return { demo: false, provider: 'historico', velas: r.velas };
        }
        // NLT Zone Engine calculado con el histórico hasta la última vela de la ventana
        // (la última vela de la VENTANA, no la del gráfico: mientras la ventana carga, el gráfico todavía tiene
        // las velas del vivo y su última está abierta)
        function zoneEngineHistorico(entradas) {
            const v = motor.enVentana();
            if (!v || !v.fin) return Promise.reject(new Error('Cargando el histórico…'));
            return NLT_API.chartsHistoriaZE(app.simbolo(), app.timeframe(), v.fin, entradas);
        }
        motor.alCambiarVentana((v) => {
            if (v && !fuenteActiva) {
                fuenteActiva = true;
                market.fijarFuenteHistorica(fuenteHTF, 'historico');
                limpiarCaches();
                app.pro.fijarFuente(zoneEngineHistorico);
            } else if (v && st.ventana && v.centro !== st.ventana.centro) {
                market.fijarFuenteHistorica(fuenteHTF, 'historico');   // OTRA fecha: otro dataset (nueva generación)
                limpiarCaches();
                app.pro.fijarFuente(zoneEngineHistorico);          // descarta el dibujo de la ventana anterior
            } else if (v) {
                limpiarCaches();                                   // la ventana creció: velas HTF hasta el nuevo final
                if (app.pro.velaNueva) app.pro.velaNueva();
            } else if (fuenteActiva) {
                fuenteActiva = false;
                market.fijarFuenteHistorica(null);
                limpiarCaches();
                app.pro.fijarFuente(null);
            }
            st.ventana = v;
            pintar();
        });

        async function cargarDisponibilidad() {
            try { st.disp = await NLT_API.chartsHistoriaDisponibilidad(app.simbolo(), app.timeframe()); } catch (_) { st.disp = null; }
            pintar();
        }
        function anios() {
            const hoy = new Date().getFullYear();
            const desde = st.disp && st.disp.earliest_status === 'AVAILABLE' && st.disp.earliest ? new Date(st.disp.earliest).getFullYear() : hoy - 6;
            const out = [];
            for (let a = hoy; a >= Math.max(desde, hoy - 12); a--) out.push(a);
            return out;
        }

        // ── Aviso tipo notificación de iOS: "Estás en tal fecha" ──
        const host = el.parentElement;
        let aviso = null, avisoTimer = null, carga = null;
        const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        const DIAS_SEM = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
        function haceTanto(ms) {
            const dias = Math.max(0, Math.round((Date.now() - ms) / 86400000));
            if (dias < 1) return 'hoy';
            if (dias < 31) return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
            const m = Math.round(dias / 30.44);
            if (m < 12) return `hace ${m} ${m === 1 ? 'mes' : 'meses'}`;
            const a = Math.floor(m / 12), r = m % 12;
            return `hace ${a} ${a === 1 ? 'año' : 'años'}${r ? ` y ${r} ${r === 1 ? 'mes' : 'meses'}` : ''}`;
        }
        function cerrarAviso() {
            clearTimeout(avisoTimer);
            if (!aviso) return;
            const a = aviso; aviso = null;
            el.classList.remove('nlt-bajo-aviso');
            a.classList.remove('on'); a.classList.add('sale');
            setTimeout(() => a.remove(), 450);
        }
        function mostrarAviso(ms) {
            if (!host) return;
            cerrarAviso();
            const d = new Date(ms);
            const hora = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const a = document.createElement('div');
            a.className = 'nlt-ios'; a.setAttribute('role', 'status'); a.setAttribute('aria-live', 'polite');
            a.innerHTML = `
                <span class="nlt-ios-ico"><i class="ph-fill ph-calendar-check"></i></span>
                <div class="nlt-ios-txt">
                    <div class="nlt-ios-app"><b>NLT CHARTS</b><span>ahora</span></div>
                    <div class="nlt-ios-t">Estás en el ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}</div>
                    <div class="nlt-ios-s">${esc(DIAS_SEM[d.getDay()])} · ${esc(hora)} · ${esc(app.simbolo())} ${esc(app.timeframe())} · ${esc(haceTanto(ms))}</div>
                </div>
                <button type="button" class="nlt-ios-b" data-ios="presente">Volver al presente</button>`;
            a.addEventListener('click', (ev) => {
                if (ev.target.closest('[data-ios="presente"]')) { motor.volverAlPresente(); cerrarAviso(); return; }
                cerrarAviso();
            });
            // deslizar hacia arriba para descartarla (como en iOS)
            let y0 = null;
            a.addEventListener('pointerdown', (ev) => { y0 = ev.clientY; });
            a.addEventListener('pointerup', (ev) => { if (y0 != null && y0 - ev.clientY > 18) cerrarAviso(); y0 = null; });
            host.appendChild(a);
            aviso = a;
            el.classList.add('nlt-bajo-aviso');         // el panel de fecha se aparta mientras dura el aviso (ocupan el mismo lugar)
            requestAnimationFrame(() => requestAnimationFrame(() => a.classList.add('on')));
            avisoTimer = setTimeout(cerrarAviso, 6500);
            try { if (navigator.vibrate) navigator.vibrate(8); } catch (_) { /* sin vibración */ }
        }
        // Mientras llegan las velas el gráfico no se queda en blanco sin explicación
        function mostrarCarga(ms) {
            if (!host) return;
            if (!carga) { carga = document.createElement('div'); carga.className = 'nlt-fcarga'; carga.setAttribute('role', 'status'); host.appendChild(carga); }
            const d = new Date(ms);
            carga.innerHTML = `<i class="ph ph-spinner"></i><div><b>Yendo al ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}</b><span>Cargando las velas…</span></div>`;
            requestAnimationFrame(() => carga && carga.classList.add('on'));
        }
        function quitarCarga() { if (carga) { const c = carga; carga = null; c.classList.remove('on'); setTimeout(() => c.remove(), 250); } }

        async function ir(ms) {
            if (motor.enModoExterno()) { st.error = 'En Bar Replay / Backtest la fecha se elige desde su propio panel.'; pintar(); return null; }
            if (st.cargando) return null;
            st.cargando = true; st.error = ''; st.prog = null; pintar();
            cerrarAviso(); mostrarCarga(ms);
            const t0 = performance.now();
            const antes = motor.metricasHistorico().pedidos.length;
            try {
                const r = await motor.irAFecha(ms, { onProgreso: (p) => { st.prog = p; pintar(); } });
                const pedidos = motor.metricasHistorico().pedidos.slice(antes);
                st.ultimo = { ...r, destino: ms, total_ms: Math.round(performance.now() - t0), pedidos: pedidos.length,
                    velas_servidor_pedidas: pedidos.reduce((a, x) => a + (x.prov || 0), 0), hit: pedidos.every((x) => x.hit) };
                quitarCarga(); mostrarAviso(ms);
                return st.ultimo;
            } catch (err) {
                st.reintento = ms;
                st.error = /tard[óo] demasiado/i.test(err.message || '')
                    ? 'El servidor de precios tardó demasiado con esa fecha. Volviste al gráfico en vivo; pulsa Reintentar (a veces el servidor ya lo tiene listo en el segundo intento).'
                    : err.message;
                return null;
            } finally {
                quitarCarga();
                st.cargando = false; st.prog = null;
                pintar();
            }
        }

        function pintar() {
            boton.classList.toggle('on', st.abierto || !!st.ventana);
            el.hidden = !(st.abierto || st.ventana || st.cargando);
            if (el.hidden) return;
            const v = st.ventana, u = st.ultimo;
            el.innerHTML = `
                <b class="rp-t"><i class="ph ph-calendar-blank"></i> IR A FECHA</b>
                <input type="date" data-k="fecha" value="${esc(st.fecha)}" aria-label="Fecha">
                <input type="time" data-k="hora" value="${esc(st.hora)}" step="60" aria-label="Hora">
                <button type="button" class="rp-b rp-play" data-a="ir" ${st.cargando ? 'disabled' : ''}><i class="ph ph-arrow-bend-up-left"></i><span>Ir</span></button>
                ${anios().map((a) => `<button type="button" class="rp-b" data-anio="${a}" ${st.cargando ? 'disabled' : ''}>${a}</button>`).join('')}
                ${v ? '<button type="button" class="rp-b" data-a="presente" title="Volver al vivo"><i class="ph ph-skip-forward"></i><span>Presente</span></button>' : ''}
                <button type="button" class="rp-b rp-x" data-a="cerrar" aria-label="Cerrar"><i class="ph ph-x"></i></button>
                ${st.cargando ? `<span class="rp-cur rp-load"><i class="ph ph-spinner"></i> Cargando histórico…${st.prog ? ` ${st.prog.hechos}/${st.prog.total} tramos · ${seg(st.prog.ms)}` : ''}</span>` : ''}
                ${v && !st.cargando ? `<span class="rp-cur" title="Tramo del pasado: no son precios en vivo">Histórico · hasta ${esc(v.fin ? fmt(v.fin) : '…')}</span>` : ''}
                ${u && !st.cargando ? `<span class="rp-cur" title="Último salto">${esc(u.modo === 'cache' ? 'ya cargada' : u.modo === 'contiguo' ? 'completado' : 'ventana')} · ${seg(u.total_ms)}${u.pedidos ? ` · ${u.pedidos} pedidos${u.hit ? ' (caché)' : ''}` : ''}</span>` : ''}
                ${st.disp && st.disp.earliest_status !== 'AVAILABLE' ? '<span class="rp-cur" title="La fuente no informó dónde empieza su historia: los años más viejos pueden no tener datos">inicio de la historia: sin comprobar</span>' : ''}
                ${st.error ? `<span class="rp-err">${esc(st.error)}${st.reintento ? ' <button type="button" class="rp-b" data-a="reintentar" style="margin-left:6px"><i class="ph ph-arrow-clockwise"></i><span>Reintentar</span></button>' : ''}</span>` : ''}`;
        }
        el.addEventListener('click', (ev) => {
            const anio = ev.target.closest('[data-anio]');
            if (anio) { const a = +anio.dataset.anio; st.fecha = `${a}-01-02`; ir(new Date(a, 0, 2, 12, 0).getTime()); return; }
            const a = ev.target.closest('[data-a]');
            if (!a) return;
            ({
                ir: () => ir(new Date(`${st.fecha}T${st.hora || '00:00'}`).getTime()),
                reintentar: () => { if (st.reintento) ir(st.reintento); },
                presente: () => { motor.volverAlPresente(); },
                cerrar: () => { st.abierto = false; pintar(); },
            }[a.dataset.a] || (() => {}))();
        });
        el.addEventListener('change', (ev) => { const k = ev.target.dataset.k; if (k) st[k] = ev.target.value; });
        boton.addEventListener('click', () => { st.abierto = !st.abierto; if (st.abierto) cargarDisponibilidad(); pintar(); });
        // Alt+G: ir a fecha (como en TradingView)
        document.addEventListener('keydown', (ev) => {
            if (ev.altKey && (ev.key === 'g' || ev.key === 'G') && !/input|select|textarea/i.test(ev.target.tagName)) {
                ev.preventDefault(); st.abierto = true; cargarDisponibilidad(); pintar();
            }
        });

        const api = { ir, volver: () => motor.volverAlPresente(), estado: () => ({ ...st, prog: st.prog && { ...st.prog } }) };
        window.NLTCharts.historiaApi = api;
        return api;
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.historia = { montar };
})();
