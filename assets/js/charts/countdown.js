/* NLT Charts -- countdown de la vela actual (tiempo restante hasta su cierre).
 *
 * Reloj: NO la hora del navegador. Cada respuesta de /charts/candles trae `server_time`, estampado al
 * TERMINAR el pedido (después de ir al proveedor, que puede tardar segundos). Por eso la muestra es
 * server_time - (hora local al recibir la respuesta): solo subestima el desfase por el viaje de vuelta
 * (milisegundos), y se toma la MAYOR de las últimas muestras (la de viaje más corto). El punto medio
 * del pedido daba errores de varios segundos (medido: 5.2 s con el servidor en la misma PC).
 * El countdown usa ahoraServidor() = Date.now() + desfase.
 *
 * Cierre de la vela: apertura + duración del timeframe. Las velas llegan en UTC real (el backend
 * convierte la hora del servidor MT5); 4H/1D están alineadas a las 17:00 de Nueva York. La vela
 * diaria cierra a las 17:00 NY del día siguiente (se corrige si un cambio de horario de verano la
 * hiciera de 23/25 h). Al llegar a 00:00:00 empieza la siguiente vela y el contador se reinicia aunque
 * todavía no haya llegado su primer tick.
 *
 * Estados en vez de un contador engañoso: MARKET CLOSED (fin de semana o pausa diaria de metales),
 * DELAYED, DISCONNECTED; en Bar Replay REPLAY y en un backtest HISTÓRICO (no hay "vela actual"). */
(function () {
    const DUR = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000 };
    const fmtNY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });

    // ── reloj del servidor ──
    const muestras = [];
    let desfase = 0;
    function sincronizar(serverMs, t0, t1) {
        if (!Number.isFinite(serverMs) || !(t1 >= t0)) return;
        muestras.push(serverMs - t1);
        if (muestras.length > 9) muestras.shift();
        desfase = Math.max(...muestras);
    }
    const ahoraServidor = () => Date.now() + desfase;

    // ── cálculo (puro) ──
    function duracion(periodo) { return DUR[periodo.type] * periodo.span; }
    function cierre(ts, periodo) {
        const dur = duracion(periodo);
        if (periodo.type !== 'day') return ts + dur;
        // diaria forex: de 17:00 NY a 17:00 NY; si un cambio de horario la hace de 23/25 h, se ajusta
        let fin = ts + dur;
        const p = Object.fromEntries(fmtNY.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
        if (+p.hour === 17 && +p.minute === 0) {
            const q = Object.fromEntries(fmtNY.formatToParts(new Date(fin)).map((x) => [x.type, x.value]));
            if (+q.hour === 18) fin -= 3600000; else if (+q.hour === 16) fin += 3600000;
        }
        return fin;
    }
    function hms(ms) {
        const s = Math.max(0, Math.floor(ms / 1000));
        const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
        const t = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
        return d ? `${d}d ${t}` : t;
    }
    /**
     * calcular({ ultimaTs, periodo, ahora, estado, cerrado }) -> { tipo: 'countdown'|'estado', texto, restanteMs? }
     * estado = estado del mercado (market-data): conectado | retrasado | desconectado | cerrado | conectando | replay | backtest
     * cerrado = el mercado de ESTE instrumento está cerrado ahora (hora del servidor).
     */
    function calcular({ ultimaTs, periodo, ahora, estado, cerrado }) {
        if (estado === 'replay') return { tipo: 'estado', texto: 'REPLAY' };
        if (estado === 'backtest' || estado === 'historico') return { tipo: 'estado', texto: 'HISTÓRICO' };
        if (estado === 'desconectado') return { tipo: 'estado', texto: 'DISCONNECTED' };
        if (cerrado || estado === 'cerrado') return { tipo: 'estado', texto: 'MARKET CLOSED' };
        if (estado === 'retrasado') return { tipo: 'estado', texto: 'DELAYED' };
        if (ultimaTs == null || !periodo || estado === 'conectando') return { tipo: 'estado', texto: '—' };
        const dur = duracion(periodo);
        let fin = cierre(ultimaTs, periodo);
        if (ahora >= fin) {
            // la vela siguiente ya empezó aunque su primer tick no haya llegado; muy atrasado = DELAYED
            if (ahora - fin > 2 * dur) return { tipo: 'estado', texto: 'DELAYED' };
            fin += Math.ceil((ahora - fin + 1) / dur) * dur;
        }
        const restante = fin - ahora;
        return { tipo: 'countdown', texto: hms(restante), restanteMs: restante };
    }

    // ── en el gráfico: debajo de la etiqueta del último precio, sobre la escala de precios ──
    function montar({ chart, stageEl }) {
        const el = document.createElement('div');
        el.className = 'ch-cd';
        el.setAttribute('role', 'timer');
        el.setAttribute('aria-live', 'off');
        stageEl.appendChild(el);
        let texto = '';
        function tick() {
            const dl = chart.getDataList();
            const u = dl[dl.length - 1];
            const market = NLTCharts.market;
            const ahora = ahoraServidor();
            const r = calcular({ ultimaTs: u && u.timestamp, periodo: chart.getPeriod(), ahora, estado: market.estado(),
                cerrado: market.cerradoAhora ? market.cerradoAhora(new Date(ahora)) : false });
            if (r.texto !== texto) { el.textContent = r.texto; texto = r.texto; }
            el.dataset.tipo = r.tipo;
            el.dataset.estado = r.tipo === 'estado' ? r.texto.toLowerCase().replace(/\s+/g, '-') : 'live';
            // posición: bajo la etiqueta del último precio (como TradingView); sin vela, arriba a la derecha
            try {
                if (!u) throw 0;
                const p = chart.convertToPixel({ dataIndex: dl.length - 1, value: u.close }, { paneId: 'candle_pane' });
                const alto = chart.getSize('candle_pane', 'main')?.height || stageEl.clientHeight;
                const y = Math.max(0, Math.min(alto - 18, p.y + 11));
                el.style.transform = `translate3d(0, ${y}px, 0)`;
            } catch (_) { el.style.transform = 'translate3d(0, 4px, 0)'; }
        }
        // cada segundo, alineado al cambio de segundo del reloj del servidor (y un repaso a mitad)
        function programar() {
            tick();
            const resto = 1000 - (ahoraServidor() % 1000);
            setTimeout(programar, Math.min(resto + 5, 500));
        }
        programar();
        return { tick };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.countdown = { sincronizar, ahoraServidor, desfase: () => desfase, calcular, cierre, hms, duracion, montar };
})();
