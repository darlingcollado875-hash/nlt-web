/* NLT Charts -- barra superior (símbolo, timeframe, indicadores, DEMO).
 * Solo arma la interfaz y avisa por callbacks; no conoce el motor. */
(function () {
    function esc(t) {
        return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /**
     * montarToolbar(el, { simbolos, timeframes, symbol, timeframe, onSymbol, onTimeframe, onIndicadores })
     * -> { setDemo(bool), setSymbol(s), setTimeframe(tf) }
     */
    // Recarga COMPLETA (el equivalente a Ctrl+Shift+R, para el celular, donde no existe ese atajo): vuelve a pedir
    // al servidor la página y todos sus scripts y estilos propios sin usar la copia guardada (cache:'reload' también
    // actualiza esa copia), borra la caché del navegador y recarga. NO desregistra el service worker: eso borraría
    // la suscripción a las notificaciones push. Pase lo que pase (sin red, lento), la página termina recargándose.
    async function recargaCompleta(boton) {
        const replay = window.NLTCharts && NLTCharts.replayApi && NLTCharts.replayApi.activo && NLTCharts.replayApi.activo();
        if (replay && !window.confirm('Estás en NLT Bar Replay. Al refrescar se sale del replay. ¿Continuar?')) return;
        if (boton) { boton.disabled = true; boton.classList.add('girando'); }
        const tarea = (async () => {
            if (window.caches && caches.keys) { const claves = await caches.keys(); await Promise.all(claves.map((k) => caches.delete(k))); }
            const propias = new Set([location.href]);
            document.querySelectorAll('script[src], link[rel="stylesheet"][href]').forEach((n) => {
                try { const u = new URL(n.src || n.href, location.href); if (u.origin === location.origin) propias.add(u.href); } catch (_) { /* url rara: se ignora */ }
            });
            await Promise.all([...propias].map((u) => fetch(u, { cache: 'reload' }).catch(() => null)));
            try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration('/sw.js'); if (reg) await reg.update(); } catch (_) { /* sin service worker */ }
        })();
        try { await Promise.race([tarea, new Promise((r) => setTimeout(r, 8000))]); } catch (_) { /* aun así se recarga */ }
        location.reload();
    }

    function montarToolbar(el, o) {
        const porCategoria = {};
        o.simbolos.forEach((s) => { (porCategoria[s.category] ||= []).push(s); });
        const NOMBRE_CATEGORIA = { forex: 'Forex', metals: 'Metales', energy: 'Energía', indices: 'Índices', crypto: 'Cripto' };

        el.innerHTML = `
            <label class="sr-only" for="chSymbol">Símbolo</label>
            <select id="chSymbol" class="ch-select">
                ${Object.entries(porCategoria).map(([cat, lista]) => `<optgroup label="${esc(NOMBRE_CATEGORIA[cat] || cat)}">${lista.map((s) =>
                    `<option value="${esc(s.symbol)}">${esc(s.symbol)}</option>`).join('')}</optgroup>`).join('')}
            </select>
            <button type="button" id="chFav" class="ch-btn ch-fav" title="Agregar a favoritos" aria-label="Agregar a favoritos"><i class="ph ph-star"></i></button>
            <button type="button" id="chBtnRefresh" class="ch-btn" title="Refrescar la página por completo (como Ctrl+Shift+R)" aria-label="Refrescar la página por completo"><i class="ph ph-arrow-clockwise"></i></button>
            <span id="chDemo" class="ch-demo hidden" title="Precios simulados para probar el gráfico. No son precios reales de mercado.">DEMO<span class="ch-btn-label"> · precios simulados</span></span>
            <span id="chConexion" class="ch-conn" data-estado="conectando" role="status" aria-live="polite" title="Conectando con los precios…"><i></i><span class="ch-btn-label">Conectando…</span></span>
            <div class="ch-tfs" role="group" aria-label="Timeframe">
                ${o.timeframes.map((tf) => `<button type="button" class="ch-tf" data-tf="${esc(tf)}">${esc(tf)}</button>`).join('')}
            </div>
            <button type="button" id="chBtnInd" class="ch-btn"><i class="ph ph-function"></i><span class="ch-btn-label">Indicadores</span></button>
            <button type="button" id="chBtnWatch" class="ch-btn" title="Watchlist" aria-label="Watchlist"><i class="ph ph-list-star"></i><span class="ch-btn-label">Watchlist</span></button>
            <button type="button" id="chBtnHistoria" class="ch-herr ch-btn" title="Ir a fecha / año (Alt+G)" aria-label="Ir a fecha"><i class="ph ph-calendar-blank"></i><span class="ch-btn-label">Ir a fecha</span></button>
            <button type="button" id="chBtnReplay" class="ch-herr ch-btn ch-lab-btn" title="NLT Bar Replay" aria-label="NLT Bar Replay"><i class="ph ph-clock-counter-clockwise"></i><span class="ch-btn-label">Replay</span></button>
            <button type="button" id="chBtnLab" class="ch-herr ch-btn ch-lab-btn" title="NLT Backtest Lab" aria-label="NLT Backtest Lab"><i class="ph ph-flask"></i><span class="ch-btn-label">Backtest Lab</span></button>
            <button type="button" id="chBtnConfig" class="ch-btn" title="Configuración del gráfico" aria-label="Configuración del gráfico"><i class="ph ph-gear-six"></i></button>`;

        const sel = el.querySelector('#chSymbol');
        sel.addEventListener('change', () => o.onSymbol(sel.value));
        el.querySelectorAll('.ch-tf').forEach((b) => b.addEventListener('click', () => o.onTimeframe(b.dataset.tf)));
        el.querySelector('#chBtnInd').addEventListener('click', () => o.onIndicadores());
        el.querySelector('#chBtnConfig').addEventListener('click', () => o.onConfig && o.onConfig());
        el.querySelector('#chBtnWatch').addEventListener('click', () => o.onWatchlist && o.onWatchlist());
        el.querySelector('#chFav').addEventListener('click', () => o.onFavorito && o.onFavorito());
        el.querySelector('#chBtnRefresh').addEventListener('click', (e) => recargaCompleta(e.currentTarget));

        // Píldora que se desliza hasta la temporalidad activa (animación en vez de saltar)
        const grupoTf = el.querySelector('.ch-tfs');
        function moverPill() {
            if (!grupoTf) return;
            const on = grupoTf.querySelector('.ch-tf.on');
            if (!on || !on.offsetWidth) { grupoTf.style.setProperty('--tf-o', '0'); return; }
            grupoTf.style.setProperty('--tf-x', on.offsetLeft + 'px');
            grupoTf.style.setProperty('--tf-w', on.offsetWidth + 'px');
            grupoTf.style.setProperty('--tf-o', '1');
        }
        if (grupoTf) {
            try { new ResizeObserver(() => moverPill()).observe(grupoTf); } catch (_) { grupoTf.classList.add('sin-slide'); }
            if (document.fonts && document.fonts.ready) document.fonts.ready.then(moverPill);
        }
        const api = {
            setSymbol(s) { sel.value = s; },
            setTimeframe(tf) {
                el.querySelectorAll('.ch-tf').forEach((b) => b.classList.toggle('on', b.dataset.tf === tf));
                moverPill();
            },
            setDemo(demo) { el.querySelector('#chDemo').classList.toggle('hidden', !demo); },
            // Estado de los precios: conectado / retrasado / desconectado / cerrado / conectando.
            // `desde`: hora del último dato recibido; se muestra siempre (salvo mercado cerrado) para
            // que nadie confunda las velas en pantalla con precios actuales.
            setConexion(estado, detalle, desde) {
                const TXT = { conectado: 'Conectado', retrasado: 'Retrasado', desconectado: 'Desconectado', cerrado: 'Mercado cerrado', conectando: 'Conectando…', backtest: 'Histórico · Backtest', replay: 'Bar Replay', historico: 'Histórico' };
                const AYUDA = {
                    conectado: 'Precios en vivo desde NLT.', retrasado: 'Los precios llegan con demora; se reintenta solo.',
                    desconectado: 'Sin conexión con los precios. Se reconecta solo y completa las velas que falten.',
                    cerrado: 'El mercado de este instrumento está cerrado (fin de semana).', conectando: 'Conectando con los precios…',
                    backtest: 'El gráfico muestra las velas históricas de un backtest, no precios en vivo.',
                    replay: 'Bar Replay: el gráfico muestra el mercado histórico hasta la vela actual del replay; lo posterior no existe en el navegador.',
                    historico: 'Histórico: el gráfico muestra un tramo del pasado (Ir a fecha). No son precios en vivo; "Volver al presente" retoma el vivo.',
                };
                const b = el.querySelector('#chConexion');
                b.dataset.estado = estado;
                const viejo = (estado === 'desconectado' || estado === 'retrasado') && desde;
                const conHora = desde && (viejo || estado === 'conectado');
                b.querySelector('.ch-btn-label').textContent = (TXT[estado] || estado) + (conHora ? ` · datos ${desde}` : '');
                b.title = AYUDA[estado] + (estado === 'conectado' && desde ? ` Último dato: ${desde}.` : '')
                    + (viejo ? ` Lo que ves en el gráfico llega hasta ${desde}: no es precio actual.` : '')
                    + (detalle && estado !== 'conectado' ? ` (${detalle})` : '');
            },
            setFavorito(fav) {
                const b = el.querySelector('#chFav');
                b.classList.toggle('on', fav);
                b.innerHTML = `<i class="${fav ? 'ph-fill' : 'ph'} ph-star"></i>`;
                b.title = fav ? 'Quitar de favoritos' : 'Agregar a favoritos';
            },
            setWatchlist(abierta) { el.querySelector('#chBtnWatch').classList.toggle('on', abierta); },
        };
        api.setSymbol(o.symbol);
        api.setTimeframe(o.timeframe);
        return api;
    }

    // Tableros (las tablas que los indicadores de TradingView dibujan con table.new) sobre el
    // panel de velas, en cuatro esquinas. Cada indicador escribe SOLO en su espacio (slot):
    // dos tablas en la misma esquina se apilan en vez de taparse.
    const POSICIONES = ['Top Left', 'Top Center', 'Top Right', 'Middle Left', 'Middle Center', 'Middle Right', 'Bottom Left', 'Bottom Center', 'Bottom Right'];
    let host = null, cajaActual = '';
    function hostTableros() {
        if (host && document.body.contains(host)) return host;
        const stage = document.querySelector('.ch-stage');
        if (!stage) return null;
        host = document.createElement('div');
        host.className = 'ud-host';
        host.innerHTML = POSICIONES.map((p) => `<div class="ud-esq" data-pos="${p}"></div>`).join('');
        stage.appendChild(host);
        cajaActual = '';
        return host;
    }
    const tablero = {
        /** slot(pos, id) -> elemento de ese indicador en esa esquina (lo mueve si cambió de esquina). */
        slot(pos, id) {
            const h = hostTableros();
            if (!h) return null;
            const esq = h.querySelector(`.ud-esq[data-pos="${POSICIONES.includes(pos) ? pos : 'Top Right'}"]`);
            let el = h.querySelector(`[data-slot="${id}"]`);
            if (!el) { el = document.createElement('div'); el.className = 'ud-slot'; el.dataset.slot = id; }
            if (el.parentElement !== esq) esq.appendChild(el);
            return el;
        },
        quitar(id) { if (host) { const el = host.querySelector(`[data-slot="${id}"]`); if (el) el.remove(); } },
        // Dentro del área de velas (sin tapar ejes ni sub-paneles); solo toca el DOM si cambió.
        ajustar(chart) {
            const h = hostTableros();
            const main = h && chart.getSize('candle_pane', 'main');
            if (!main) return;
            const k = `${main.left}|${main.top}|${main.width}|${main.height}`;
            if (k === cajaActual) return;
            cajaActual = k;
            Object.assign(h.style, { left: `${main.left}px`, top: `${main.top}px`, width: `${main.width}px`, height: `${main.height}px` });
        },
    };

    window.NLTCharts = window.NLTCharts || {};
    /** Vuelve a dibujar una ventana (cada pocos segundos con precios nuevos) SIN borrar lo que la persona está escribiendo:
     *  guarda lo que cambió en cada campo, redibuja, lo devuelve y deja el cursor donde estaba. */
    function conservar(cont, redibujar) {
        const editado = new Map();
        cont.querySelectorAll('input[name], select[name], textarea[name]').forEach((e) => {
            if (e.type === 'password' || e.type === 'file') return;
            if (e.type === 'checkbox' || e.type === 'radio') { if (e.checked !== e.defaultChecked) editado.set(e.name + (e.type === 'radio' ? '=' + e.value : ''), { e: e.type, v: e.checked, val: e.value }); }
            else if (e.tagName === 'SELECT') { const d = [...e.options].findIndex((o) => o.defaultSelected); if (e.selectedIndex !== Math.max(0, d)) editado.set(e.name, { e: 'select', v: e.value }); }
            else if (e.value !== e.defaultValue) editado.set(e.name, { e: 'text', v: e.value });
        });
        const fo = document.activeElement, nombreFoco = fo && cont.contains(fo) ? fo.getAttribute('name') : null;
        let ini = null, fin = null; try { ini = fo.selectionStart; fin = fo.selectionEnd; } catch (_) { /* no es un campo de texto */ }
        const alto = cont.scrollTop;
        redibujar();
        const buscar = (n) => cont.querySelector(`[name="${String(n).replace(/"/g, '\\"')}"]`);
        editado.forEach((d, clave) => {
            if (d.e === 'radio') { const r = cont.querySelector(`[name="${clave.split('=')[0]}"][value="${d.val}"]`); if (r) r.checked = d.v; return; }
            const e = buscar(clave); if (!e) return;
            if (d.e === 'checkbox') e.checked = d.v; else e.value = d.v;
        });
        cont.scrollTop = alto;
        if (nombreFoco) { const e = buscar(nombreFoco); if (e) { e.focus(); try { if (ini != null) e.setSelectionRange(ini, fin); } catch (_) { /* number/select */ } } }
    }
    /** Aviso breve abajo en el centro (no tapa el gráfico, se va solo). tipo: 'ok' | 'error' | undefined */
    let toastEl = null, toastTimer = null;
    function toast(texto, tipo) {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.className = 'nlt-toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite');
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = String(texto || '');
        toastEl.dataset.tipo = tipo || '';
        toastEl.classList.remove('visible'); void toastEl.offsetWidth; toastEl.classList.add('visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl && toastEl.classList.remove('visible'), tipo === 'error' ? 6500 : 4200);
    }
    window.NLTCharts.ui = { montarToolbar, esc, tablero, conservar, toast };
})();
