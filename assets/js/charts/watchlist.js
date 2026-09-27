/* NLT Charts -- watchlist / favoritos (etapa 2, bloque D).
 *
 * ⭐ Favoritos arriba (ordenables: arrastrar en escritorio, flechas en
 * celular), todos los instrumentos abajo con buscador. Tocar una fila
 * cambia el símbolo del gráfico. Precio y variación del día vienen de
 * /charts/quotes en UN pedido para todos los favoritos (cada 15 s, solo con
 * el panel abierto y la pestaña visible). Los favoritos y si el panel está
 * abierto se guardan por usuario (state.js). La lista de instrumentos sale
 * del catálogo del backend: agregar símbolos no requiere tocar este archivo.
 * Los que la cuenta de precios no ofrece (con TickerAll real: BTCUSD, DXY)
 * se listan como NOT AVAILABLE: sin precio y sin poder elegirlos. */
(function () {
    const REFRESCO_MS = 15000;
    const DEFAULT_FAVS = ['XAUUSD', 'EURUSD', 'BTCUSD'];

    function montar({ el, catalogo, noDisponibles = [], getSymbol, onSeleccionar, onCambio }) {
        const state = NLTCharts.state;
        const esc = NLTCharts.ui.esc;
        const porSimbolo = Object.fromEntries(catalogo.map((s) => [s.symbol, s]));
        let favs = (state.prefs().favoritos || DEFAULT_FAVS).filter((s) => porSimbolo[s]);
        let quotes = {};
        let filtro = '';
        let timer = null;
        let pedidoEnCurso = 0;
        const tactil = window.matchMedia && window.matchMedia('(hover: none)').matches;

        const guardarFavs = () => { state.savePrefs({ favoritos: favs }); onCambio && onCambio(); };
        const abierta = () => !el.hidden;

        function fmtPrecio(q, s) {
            return q && q.last != null ? Number(q.last).toFixed(s.price_precision) : '—';
        }
        function filaFav(sym, k) {
            const s = porSimbolo[sym], q = quotes[sym];
            const pct = q && q.change_pct != null ? q.change_pct : null;
            const clase = pct === null ? '' : pct >= 0 ? 'up' : 'down';
            return `<div class="wl-fila${sym === getSymbol() ? ' on' : ''}" data-sym="${esc(sym)}" draggable="${tactil ? 'false' : 'true'}" data-k="${k}">
                <i class="ph ph-dots-six-vertical wl-grip" aria-hidden="true"></i>
                <span class="wl-sym"><b>${esc(sym)}</b><small>${esc(s.display_name)}</small></span>
                <span class="wl-num"><b>${esc(fmtPrecio(q, s))}</b><small class="${clase}">${pct === null ? (q && q.error ? 'sin datos' : '') : (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'}</small></span>
                ${tactil ? `<span class="wl-orden"><button type="button" data-mover="-1" aria-label="Subir ${esc(sym)}"${k === 0 ? ' disabled' : ''}><i class="ph ph-caret-up"></i></button><button type="button" data-mover="1" aria-label="Bajar ${esc(sym)}"${k === favs.length - 1 ? ' disabled' : ''}><i class="ph ph-caret-down"></i></button></span>` : ''}
                <button type="button" class="wl-star on" data-fav="${esc(sym)}" title="Quitar de favoritos" aria-label="Quitar ${esc(sym)} de favoritos"><i class="ph-fill ph-star"></i></button>
            </div>`;
        }
        function filaTodos(s) {
            const fav = favs.includes(s.symbol);
            return `<div class="wl-fila${s.symbol === getSymbol() ? ' on' : ''}" data-sym="${esc(s.symbol)}">
                <span class="wl-sym"><b>${esc(s.symbol)}</b><small>${esc(s.display_name)}</small></span>
                <span class="wl-cat">${esc({ forex: 'Forex', metals: 'Metales', crypto: 'Cripto', indices: 'Índices' }[s.category] || s.category)}</span>
                <button type="button" class="wl-star${fav ? ' on' : ''}" data-fav="${esc(s.symbol)}" title="${fav ? 'Quitar de favoritos' : 'Agregar a favoritos'}" aria-label="${fav ? 'Quitar' : 'Agregar'} ${esc(s.symbol)}"><i class="${fav ? 'ph-fill' : 'ph'} ph-star"></i></button>
            </div>`;
        }

        function filaNoDisponible(s) {
            return `<div class="wl-fila wl-nd" aria-disabled="true" title="La cuenta de precios no ofrece este instrumento.">
                <span class="wl-sym"><b>${esc(s.symbol)}</b><small>${esc(s.display_name)}</small></span>
                <span class="wl-cat">NOT AVAILABLE</span>
            </div>`;
        }

        function render() {
            const f = filtro.trim().toUpperCase();
            const coincide = (s) => !f || s.symbol.includes(f) || s.display_name.toUpperCase().includes(f);
            const todos = catalogo.filter(coincide);
            const nd = noDisponibles.filter(coincide);
            el.innerHTML = `
                <div class="wl-head"><span>Watchlist</span><button type="button" class="ch-tool" data-wl="cerrar" aria-label="Cerrar watchlist"><i class="ph ph-x"></i></button></div>
                <p class="wl-sec"><i class="ph-fill ph-star"></i> Favoritos</p>
                <div class="wl-lista" data-lista="favs">${favs.length ? favs.map(filaFav).join('') : '<p class="wl-vacio">Tocá ☆ en un instrumento para agregarlo.</p>'}</div>
                <p class="wl-sec">Instrumentos</p>
                <input type="search" class="wl-buscar" placeholder="Buscar símbolo" value="${esc(filtro)}" aria-label="Buscar símbolo">
                <div class="wl-lista">${todos.map(filaTodos).join('') + nd.map(filaNoDisponible).join('') || '<p class="wl-vacio">Sin resultados.</p>'}</div>`;
        }

        async function pedirQuotes() {
            clearTimeout(timer);
            if (!abierta()) return;
            if (NLTCharts.market.enReplay && NLTCharts.market.enReplay()) {
                el.querySelectorAll('[data-lista="favs"] .wl-num').forEach((n) => { n.innerHTML = '<b>—</b><small>replay</small>'; });
            } else if (document.visibilityState === 'visible' && favs.length) {
                const n = ++pedidoEnCurso;
                try {
                    const r = await NLT_API.chartsQuotes(favs);
                    if (n !== pedidoEnCurso) return;   // llegó tarde: hay un pedido más nuevo
                    r.quotes.forEach((q) => { quotes[q.symbol] = q; });
                    // solo se actualizan los números: no se reconstruye el panel (no pierde foco ni scroll)
                    el.querySelectorAll('[data-lista="favs"] .wl-fila').forEach((fila) => {
                        const sym = fila.dataset.sym, s = porSimbolo[sym], q = quotes[sym];
                        const num = fila.querySelector('.wl-num');
                        if (!num || !s) return;
                        const pct = q && q.change_pct != null ? q.change_pct : null;
                        num.innerHTML = `<b>${esc(fmtPrecio(q, s))}</b><small class="${pct === null ? '' : pct >= 0 ? 'up' : 'down'}">${pct === null ? (q && q.error ? 'sin datos' : '') : (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'}</small>`;
                    });
                } catch (_) { /* se reintenta en el próximo ciclo */ }
            }
            timer = setTimeout(pedirQuotes, REFRESCO_MS);
        }

        function alternarFav(sym) {
            favs = favs.includes(sym) ? favs.filter((x) => x !== sym) : [...favs, sym];
            guardarFavs();
            render();
            pedirQuotes();
        }
        function mover(k, dir) {
            const j = k + dir;
            if (j < 0 || j >= favs.length) return;
            [favs[k], favs[j]] = [favs[j], favs[k]];
            guardarFavs();
            render();
        }

        el.addEventListener('click', (ev) => {
            const cerrar = ev.target.closest('[data-wl="cerrar"]');
            if (cerrar) { api.alternar(false); return; }
            const star = ev.target.closest('[data-fav]');
            if (star) { ev.stopPropagation(); alternarFav(star.dataset.fav); return; }
            const mv = ev.target.closest('[data-mover]');
            if (mv) { ev.stopPropagation(); mover(parseInt(mv.closest('.wl-fila').dataset.k, 10), parseInt(mv.dataset.mover, 10)); return; }
            const fila = ev.target.closest('.wl-fila');
            if (fila && fila.dataset.sym) onSeleccionar(fila.dataset.sym);
        });
        el.addEventListener('input', (ev) => {
            if (!ev.target.classList.contains('wl-buscar')) return;
            filtro = ev.target.value;
            const pos = ev.target.selectionStart;
            render();
            const b = el.querySelector('.wl-buscar'); b.focus(); b.setSelectionRange(pos, pos);
        });
        // Reordenar arrastrando (escritorio)
        let arrastrando = null;
        el.addEventListener('dragstart', (ev) => {
            const f = ev.target.closest('[data-lista="favs"] .wl-fila');
            if (!f) return;
            arrastrando = parseInt(f.dataset.k, 10);
            ev.dataTransfer.effectAllowed = 'move';
            f.classList.add('arrastrando');
        });
        el.addEventListener('dragover', (ev) => { if (arrastrando !== null && ev.target.closest('[data-lista="favs"]')) ev.preventDefault(); });
        el.addEventListener('drop', (ev) => {
            const f = ev.target.closest('[data-lista="favs"] .wl-fila');
            if (arrastrando === null || !f) return;
            ev.preventDefault();
            const destino = parseInt(f.dataset.k, 10);
            const [x] = favs.splice(arrastrando, 1);
            favs.splice(destino, 0, x);
            arrastrando = null;
            guardarFavs();
            render();
        });
        el.addEventListener('dragend', () => { arrastrando = null; });
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pedirQuotes(); });

        const api = {
            alternar(abrir, silencioso) {
                const quiere = abrir === undefined ? el.hidden : abrir;
                el.hidden = !quiere;
                state.savePrefs({ watchlistAbierta: quiere });
                if (quiere) { render(); pedirQuotes(); } else clearTimeout(timer);
                if (!silencioso && onCambio) onCambio();
            },
            esFavorito: (sym) => favs.includes(sym),
            alternarFav,
            // al cambiar de símbolo solo se marca la fila activa
            marcarActual() { if (abierta()) el.querySelectorAll('.wl-fila').forEach((f) => f.classList.toggle('on', f.dataset.sym === getSymbol())); },
            favoritos: () => favs.slice(),
        };
        const pref = state.prefs().watchlistAbierta;
        // al montar no se avisa: quien monta todavía no tiene la api (sincroniza la barra él mismo)
        api.alternar(pref === undefined ? window.innerWidth >= 1100 : pref, true);
        return api;
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.watchlist = { montar };
})();
