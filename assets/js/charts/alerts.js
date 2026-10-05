/* NLT Charts -- alertas de precio 24/7.
 *
 * Las alertas viven en el SERVIDOR (nlt-api, chart_alerts): se revisan aunque cierres la página y avisan por
 * notificación push al celular/PC. Este módulo solo las crea, lista y muestra en el gráfico como líneas
 * punteadas con campana (las del símbolo que estás viendo). Son avisos: nunca ejecutan operaciones. */
(function () {
    const GRUPO = 'nlt-alerts';
    const CONDICIONES = [
        { v: 'cross_up', t: 'Cruza hacia arriba' }, { v: 'cross_down', t: 'Cruza hacia abajo' }, { v: 'cross', t: 'Cruza (cualquier dirección)' },
        { v: 'gt', t: 'Mayor que (una vez)' }, { v: 'lt', t: 'Menor que (una vez)' },
    ];
    const TEXTO = { cross: 'cruza', cross_up: 'cruza ↑', cross_down: 'cruza ↓', gt: '>', lt: '<' };
    let registrado = false;

    function registrarOverlay() {
        if (registrado) return;
        registrado = true;
        klinecharts.registerOverlay({
            name: 'nltAlertLine', totalStep: 2, lock: true, needDefaultPointFigure: false, needDefaultXAxisFigure: false, needDefaultYAxisFigure: true,
            createPointFigures: ({ overlay, coordinates, bounding }) => {
                if (!coordinates.length) return [];
                const y = coordinates[0].y, ext = overlay.extendData || {};
                const color = ext.activa ? '#F59E0B' : '#6B7280';
                return [
                    { type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x: 0, y }, { x: bounding.width, y }] }, styles: { style: 'dashed', dashedValue: [5, 4], size: 1, color } },
                    { type: 'text', ignoreEvent: true, attrs: { x: 6, y: y - 3, text: `🔔 ${ext.texto || ''}`, align: 'left', baseline: 'bottom' }, styles: { color, size: 11, family: 'Inter, system-ui, sans-serif', weight: 600, backgroundColor: 'transparent', borderSize: 0 } },
                ];
            },
        });
    }

    function montar({ chart, getSymbol, getUltimoPrecio }) {
        registrarOverlay();
        const esc = NLTCharts.ui.esc;
        let alertas = [], max = 30, disponible = true, cargando = false;

        const btn = document.createElement('button');
        btn.type = 'button'; btn.id = 'chBtnAlertas'; btn.className = 'ch-btn ch-herr'; btn.title = 'Alertas de precio (Alt+A)'; btn.setAttribute('aria-label', 'Alertas de precio');
        btn.innerHTML = '<i class="ph ph-bell-ringing"></i><span class="ch-btn-label">Alertas</span>';
        const pop = document.createElement('div');
        pop.className = 'mc-menu al-pop'; pop.id = 'chAlertas'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Alertas de precio');
        document.body.appendChild(pop);

        function pintarLineas() {
            try { chart.removeOverlay({ groupId: GRUPO }); } catch (_) { /* nada que quitar */ }
            const ult = chart.getDataList().slice(-1)[0];
            if (!ult) return;
            alertas.filter((a) => a.symbol === getSymbol() && (a.active || a.triggered_count)).forEach((a) => {
                chart.createOverlay({ name: 'nltAlertLine', groupId: GRUPO, lock: true, points: [{ timestamp: ult.timestamp, value: Number(a.level) }],
                    extendData: { activa: a.active, texto: `${TEXTO[a.condition] || ''} ${a.level}${a.note ? ` · ${a.note}` : ''}` } });
            });
        }
        async function cargar() {
            if (cargando) return;
            cargando = true;
            try {
                const r = await NLT_API.chartsAlertas();
                alertas = r.alerts || []; max = r.max || 30; disponible = true;
            } catch (e) {
                if (/503|todavía no están disponibles/i.test(String(e && (e.message || e)))) disponible = false;
            } finally { cargando = false; }
            pintarLineas();
        }

        const fecha = (t) => { try { return new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
        async function pintar(msg) {
            const sym = getSymbol();
            const precio = getUltimoPrecio ? getUltimoPrecio() : null;
            const push = window.NLT && NLT.pushEstado ? await NLT.pushEstado() : 'sin-soporte';
            const aviso = push === 'suscrito' ? '' : push === 'sin-soporte' ? '<p class="mc-nota">Este navegador no admite notificaciones push: las alertas se guardan pero no podrán avisarte.</p>'
                : push === 'denegado' ? '<p class="mc-nota">Bloqueaste las notificaciones en este navegador: activalas en los ajustes del sitio para recibir las alertas.</p>'
                : '<div class="al-push"><span>Activá los avisos en este dispositivo para recibir las alertas con la página cerrada.</span><button type="button" data-al="push" class="mc-d on">Activar avisos</button></div>';
            const filas = alertas.map((a) => `<div class="al-fila${a.active ? '' : ' off'}">
                <div class="al-txt"><b>${esc(a.symbol)}</b> ${esc(TEXTO[a.condition] || '')} <b>${esc(a.level)}</b>${a.note ? `<br><small>${esc(a.note)}</small>` : ''}
                <br><small>${a.active ? (a.trigger === 'every_time' ? 'Activa · cada vez' : 'Activa · una vez') : a.triggered_count ? `Disparada ${esc(fecha(a.last_triggered_at))}` : 'Pausada'}${a.triggered_count && a.active ? ` · ${a.triggered_count} aviso(s)` : ''}</small></div>
                <button type="button" data-al="${a.active ? 'pausar' : 'reactivar'}" data-id="${esc(a.id)}" title="${a.active ? 'Pausar' : 'Reactivar'}" aria-label="${a.active ? 'Pausar' : 'Reactivar'}"><i class="ph ph-${a.active ? 'pause' : 'play'}"></i></button>
                <button type="button" data-al="borrar" data-id="${esc(a.id)}" title="Borrar" aria-label="Borrar alerta"><i class="ph ph-trash"></i></button></div>`).join('');
            pop.innerHTML = `<div class="mc-tit">Alertas de precio · 24/7</div>${msg ? `<p class="al-msg">${esc(msg)}</p>` : ''}${aviso}
                ${disponible ? `<form class="al-form" data-al-form>
                    <div class="al-fila2"><b>${esc(sym)}</b><select name="condition" class="mc-sel">${CONDICIONES.map((c) => `<option value="${c.v}">${esc(c.t)}</option>`).join('')}</select></div>
                    <div class="al-fila2"><input name="level" class="mc-sel" type="number" step="any" inputmode="decimal" placeholder="Precio" value="${precio != null ? esc(precio) : ''}" required>
                    <select name="trigger" class="mc-sel"><option value="once">Una vez</option><option value="every_time">Cada vez</option></select></div>
                    <input name="note" class="mc-sel al-nota" maxlength="140" placeholder="Nota (opcional)">
                    <button type="submit" class="mc-d on">Crear alerta</button></form>` : '<p class="mc-nota">Las alertas todavía no están disponibles.</p>'}
                <div class="mc-tit" style="margin-top:12px">Mis alertas (${alertas.filter((a) => a.active).length}/${max} activas)</div>${filas || '<p class="mc-nota">Todavía no creaste alertas.</p>'}
                <p class="mc-nota">Se revisan en el servidor cada ~20 s aunque cierres NLT Charts. Son avisos: no ejecutan operaciones.</p>`;
        }
        const posicionar = () => { const r = btn.getBoundingClientRect(); pop.style.top = `${r.bottom + 6}px`; pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`; };
        async function abrir() {
            document.querySelectorAll('.mc-menu').forEach((m) => { m.hidden = true; });
            await pintar(); pop.hidden = false; posicionar();
            await cargar(); await pintar(); posicionar();
        }
        btn.addEventListener('click', (e) => { e.stopPropagation(); if (!pop.hidden) { pop.hidden = true; return; } abrir(); });
        // composedPath: al repintar el panel el botón pulsado ya no está en el DOM y closest() fallaría.
        document.addEventListener('click', (e) => { const ruta = e.composedPath(); if (!pop.hidden && !ruta.includes(pop) && !ruta.includes(btn)) pop.hidden = true; });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') pop.hidden = true;
            if (e.altKey && e.key.toLowerCase() === 'a' && !/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) { e.preventDefault(); pop.hidden ? abrir() : (pop.hidden = true); }
        });
        pop.addEventListener('submit', async (e) => {
            e.preventDefault();
            const f = new FormData(e.target);
            try {
                await NLT_API.chartsCrearAlerta({ symbol: getSymbol(), condition: f.get('condition'), level: Number(f.get('level')), trigger: f.get('trigger'), note: f.get('note') || null });
                await cargar(); await pintar('Alerta creada.');
            } catch (err) { await pintar(err && err.message ? err.message : 'No se pudo crear la alerta.'); }
            posicionar();
        });
        pop.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-al]');
            if (!b) return;
            const acc = b.dataset.al;
            try {
                if (acc === 'push') { const ok = await NLT.pushActivar(); await pintar(ok ? 'Avisos activados en este dispositivo.' : 'No se activaron los avisos.'); posicionar(); return; }
                if (acc === 'borrar') { if (!window.confirm('¿Borrar esta alerta?')) return; await NLT_API.chartsBorrarAlerta(b.dataset.id); }
                if (acc === 'pausar') await NLT_API.chartsCambiarAlerta(b.dataset.id, false);
                if (acc === 'reactivar') await NLT_API.chartsCambiarAlerta(b.dataset.id, true);
                await cargar(); await pintar(); posicionar();
            } catch (err) { await pintar(err && err.message ? err.message : 'No se pudo completar.'); posicionar(); }
        });

        const ancla = document.getElementById('chBtnConfig');
        if (ancla) ancla.before(btn);
        cargar();
        setInterval(() => { if (!document.hidden) cargar(); }, 60000);   // para ver "disparada" sin recargar
        return { cambioSimbolo: pintarLineas, recargar: cargar };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.alerts = { montar, CONDICIONES };
})();
