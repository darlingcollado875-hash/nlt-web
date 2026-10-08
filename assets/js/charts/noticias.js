/* NLT News Radar -- avisos de noticias económicas dentro del gráfico.
 *   · Una píldora en la barra con la próxima noticia fuerte y su cuenta regresiva.
 *   · Tarjeta de aviso 5 minutos antes (configurable), al publicarse y con el resultado: anillo de cuenta regresiva,
 *     qué instrumentos puede mover y, si tienes posiciones abiertas expuestas a esa moneda, un aviso de riesgo.
 *   · Panel con las próximas noticias (alto / medio impacto) y los ajustes: sonido, marcas en el gráfico y push con la app cerrada.
 * Los datos salen del calendario económico del servidor (público); aquí nunca se llama al proveedor externo. Es informativo:
 * no da señales ni consejos de operación. Todo va en try/catch: si algo falla, el gráfico sigue igual. */
(function () {
    'use strict';
    const GRUPO = 'nltNews';
    const COLOR_MONEDA = { USD: '61,220,151', EUR: '91,140,255', GBP: '192,132,252', JPY: '255,107,129', AUD: '255,179,71', NZD: '45,212,191', CAD: '255,122,89', CHF: '248,113,113', CNY: '244,63,94' };
    const IMPACTO = { HIGH: { n: 3, clase: 'nr-alto', texto: 'NOTICIA DE ALTO IMPACTO', corto: 'Alto' }, MEDIUM: { n: 2, clase: 'nr-medio', texto: 'NOTICIA DE IMPACTO MEDIO', corto: 'Medio' } };
    const DEFECTO = { pantalla: true, lead: 5, medio: false, sonido: true, marcas: true, soloMios: false };
    const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const CIRC = 2 * Math.PI * 40;

    const pad = (n) => String(n).padStart(2, '0');
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // "2026-10-08 12:15:00+00" (Postgres) o ISO -> Date. Sin zona se asume UTC.
    function fecha(s) {
        if (!s) return null;
        let t = String(s).trim().replace(' ', 'T');
        if (/[+-]\d\d$/.test(t)) t += ':00';
        else if (!/(Z|[+-]\d\d:?\d\d)$/.test(t)) t += 'Z';
        const d = new Date(t);
        return isNaN(d) ? null : d;
    }
    const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    function cuentaCorta(seg) {
        const s = Math.max(0, Math.round(seg)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
        return h ? `${h} h ${pad(m)} min` : m ? `${m} min` : `${s} s`;
    }
    const mmss = (seg) => { const s = Math.max(0, Math.ceil(seg)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

    // Qué monedas mueven un instrumento.
    function monedasDe(sym) {
        const s = String(sym || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (/^(XAU|XAG)USD/.test(s)) return ['USD'];
        if (/^(US100|US30|US500|NAS100|USTEC|SPX500|NQ|ES|YM)/.test(s) || /(OIL|WTI|BRENT|XTI|XBR)/.test(s) || /^(BTC|ETH|LTC|XRP|SOL)/.test(s)) return ['USD'];
        if (/^(GER40|DE40|DAX|FRA40|EU50|ESP35)/.test(s)) return ['EUR'];
        if (/^(UK100|FTSE)/.test(s)) return ['GBP'];
        if (/^(JP225|NIKKEI|JPN225)/.test(s)) return ['JPY'];
        if (/^AUS200/.test(s)) return ['AUD'];
        const m = s.match(/^([A-Z]{3})([A-Z]{3})/);
        return m ? [m[1], m[2]] : [];
    }

    function montar({ chart, getSymbol, simbolos }) {
        const st = () => NLTCharts.state;
        let eventos = [], cargado = false, filtro = 'alto', serverPrefs = { push: false, lead_minutes: 5, impacts: ['HIGH'], disponible: true };
        const tarjetas = new Map();            // id -> { el, fase }
        const cerradas = new Set();            // `${id}|${grupo}` descartadas
        let panelAbierto = false, ultimaMarca = '', masAbierto = false, ultimaCarga = 0;

        const prefs = () => ({ ...DEFECTO, ...((st().prefs() || {}).noticias || {}) });
        const guardarPrefs = (p) => st().savePrefs({ noticias: { ...prefs(), ...p } });
        const sonar = (n) => { try { if (prefs().sonido && NLTCharts.sonidos) NLTCharts.sonidos.reproducir(n); } catch (_) { /* sin audio */ } };

        // ---------- cálculo ----------
        const listaSimbolos = () => (simbolos || []).map((s) => s.symbol || s);
        const mias = () => { const set = new Set(monedasDe(getSymbol())); try { posiciones().forEach((p) => monedasDe(p.symbol).forEach((m) => set.add(m))); } catch (_) {} return set; };
        function posiciones() {
            try { const t = window.NLTCharts && NLTCharts.traderApi; return t && t.posiciones ? (t.posiciones() || []) : []; } catch (_) { return []; }
        }
        function afectaA(ev) {
            const cur = ev.currency;
            const todos = listaSimbolos().filter((s) => monedasDe(s).includes(cur));
            const actual = getSymbol();
            const orden = todos.sort((a, b) => (a === actual ? -1 : b === actual ? 1 : 0));
            return orden.slice(0, 5);
        }
        function expuestas(ev) {
            const por = {};
            posiciones().forEach((p) => { if (monedasDe(p.symbol).includes(ev.currency)) { const k = p.nlt_symbol || p.symbol; por[k] = (por[k] || 0) + 1; } });
            return por;
        }
        function relevante(ev) {
            const p = prefs();
            const imp = ev.impact;
            if (imp !== 'HIGH' && !(imp === 'MEDIUM' && p.medio)) return false;
            const mia = mias().has(ev.currency);
            if (p.soloMios) return mia;
            return imp === 'HIGH' ? true : mia;
        }
        function fase(ev, ahora) {
            const dt = (ev.t - ahora) / 1000, lead = prefs().lead * 60;
            if (ev.actual && -dt < 30 * 60 && dt <= 0) return 'publicada';
            if (dt > lead) return 'lejos';
            if (dt > 0) return 'previo';
            if (dt > -150 && !ev.actual) return 'ahora';
            return 'pasada';
        }

        // ---------- datos ----------
        function normalizar(r) {
            const t = fecha(r.event_time_utc);
            if (!t || !IMPACTO[r.impact]) return null;
            return { id: r.id || `${r.event_name}|${r.event_time_utc}`, nombre: r.event_name || 'Noticia', currency: r.currency || '', impact: r.impact, t: t.getTime(), forecast: r.forecast_value, previous: r.previous_value, actual: r.actual_value };
        }
        async function cargar() {
            ultimaCarga = Date.now();
            try {
                const a = new Date(), d = (n) => { const x = new Date(a.getTime() + n * 864e5); return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`; };
                const filas = await NLT_API.calendarEventos({ from: d(-1), to: d(3) });
                eventos = (filas || []).map(normalizar).filter(Boolean).sort((x, y) => x.t - y.t);
                cargado = true;
            } catch (e) { /* sin calendario: el radar queda en reposo */ }
            tick(); if (panelAbierto) pintarPanel();
        }

        // ---------- píldora ----------
        const pill = document.createElement('button');
        pill.type = 'button'; pill.id = 'chBtnNoticias'; pill.className = 'nr-pill'; pill.title = 'NLT News Radar: noticias económicas'; pill.setAttribute('aria-label', 'Noticias económicas');
        pill.innerHTML = '<i class="nr-pt"></i><span class="nr-pm"></span><span class="nr-pe"></span><span class="nr-pc"></span>';
        const barra = document.getElementById('chToolbar');
        const ancla = document.getElementById('chConexion') || document.getElementById('chBtnRefresh');
        if (barra) barra.insertBefore(pill, ancla ? ancla.nextSibling : (barra.children[3] || null));
        pill.addEventListener('click', () => (panelAbierto ? cerrarPanel() : abrirPanel()));

        function proxima(ahora) {
            return eventos.filter((e) => e.impact === 'HIGH' || (prefs().medio && e.impact === 'MEDIUM')).find((e) => e.t - ahora > -150000 && !(e.actual && e.t < ahora));
        }
        function pintarPildora(ahora) {
            const e = proxima(ahora);
            const $ = (c) => pill.querySelector(c);
            if (!cargado || !e) { pill.dataset.nivel = 'calma'; $('.nr-pm').textContent = ''; $('.nr-pe').textContent = 'Noticias'; $('.nr-pc').textContent = ''; return; }
            const dt = (e.t - ahora) / 1000;
            pill.dataset.nivel = dt <= 60 ? 'ya' : dt <= prefs().lead * 60 ? 'cerca' : 'calma';
            $('.nr-pm').textContent = e.currency; $('.nr-pe').textContent = e.nombre;
            $('.nr-pc').textContent = dt > 0 ? (dt < 3600 ? mmss(dt) : cuentaCorta(dt)) : 'AHORA';
        }

        // ---------- tarjetas ----------
        const pila = document.createElement('div'); pila.id = 'nrPila'; pila.setAttribute('aria-live', 'polite'); document.body.appendChild(pila);
        const barras = (n) => `<span class="nr-barras" aria-hidden="true"><i class="${n >= 1 ? 'on' : ''}"></i><i class="${n >= 2 ? 'on' : ''}"></i><i class="${n >= 3 ? 'on' : ''}"></i></span>`;
        const monedaHTML = (c) => `<span class="nr-mon" style="--m:${COLOR_MONEDA[c] || '148,163,184'}">${esc(c || '—')}</span>`;
        const datos = (ev) => `<div class="nr-datos">${ev.forecast ? `<span>Previsión<b>${esc(ev.forecast)}</b></span>` : ''}${ev.previous ? `<span>Anterior<b>${esc(ev.previous)}</b></span>` : ''}${!ev.forecast && !ev.previous ? '<span>Sin previsión publicada</span>' : ''}</div>`;
        const num = (s) => { const m = String(s == null ? '' : s).replace(/,/g, '').match(/-?\d+(\.\d+)?/); if (!m) return null; let v = parseFloat(m[0]); if (/k/i.test(s)) v *= 1e3; if (/m/i.test(s)) v *= 1e6; if (/b/i.test(s)) v *= 1e9; return v; };
        function veredicto(ev) {
            const a = num(ev.actual), f = num(ev.forecast);
            if (a == null || f == null) return '';
            if (Math.abs(a - f) < 1e-9) return '<span class="nr-veredicto nr-igual">= IGUAL A LA PREVISIÓN</span>';
            return a > f ? '<span class="nr-veredicto nr-mas">▲ SOBRE LO PREVISTO</span>' : '<span class="nr-veredicto nr-menos">▼ BAJO LO PREVISTO</span>';
        }

        function cuerpo(ev, f, ahora) {
            const dt = (ev.t - ahora) / 1000, total = prefs().lead * 60;
            const imp = IMPACTO[ev.impact];
            const afecta = afectaA(ev), exp = expuestas(ev), actual = getSymbol();
            const nExp = Object.values(exp).reduce((s, n) => s + n, 0);
            let msg, centro, central;
            if (f === 'previo') {
                const min = Math.ceil(dt / 60);
                msg = dt <= 60 ? '<b style="color:rgb(var(--c))">Último minuto.</b> Sale en segundos' : `Cuidado: en ${min} minuto${min === 1 ? '' : 's'} sale`;
                central = `<div class="nr-ring"><svg viewBox="0 0 100 100"><circle class="nr-marcas" cx="50" cy="50" r="47"/><circle class="nr-pista" cx="50" cy="50" r="40"/><circle class="nr-prog" cx="50" cy="50" r="40" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC * (1 - Math.max(0, Math.min(1, dt / total)))}"/></svg><div class="nr-barrido"></div><div class="nr-tiempo"><b>${mmss(dt)}</b><small>min</small></div></div>`;
                centro = `${datos(ev)}`;
            } else if (f === 'ahora') {
                msg = 'Publicándose ahora · espera el dato';
                central = `<div class="nr-ring"><svg viewBox="0 0 100 100"><circle class="nr-marcas" cx="50" cy="50" r="47"/><circle class="nr-pista" cx="50" cy="50" r="40"/><circle class="nr-prog" cx="50" cy="50" r="40" stroke-dasharray="${CIRC}" stroke-dashoffset="0"/></svg><div class="nr-barrido"></div><div class="nr-tiempo"><b>AHORA</b><small>en vivo</small></div></div>`;
                centro = `${datos(ev)}`;
            } else {
                msg = 'Resultado publicado';
                central = `<div class="nr-ring"><svg viewBox="0 0 100 100"><circle class="nr-marcas" cx="50" cy="50" r="47"/><circle class="nr-pista" cx="50" cy="50" r="40"/><circle class="nr-prog" cx="50" cy="50" r="40" stroke-dasharray="${CIRC}" stroke-dashoffset="0" style="opacity:.55"/></svg><div class="nr-tiempo"><b style="font-size:26px">${(() => { const a = num(ev.actual), f = num(ev.forecast); return a == null || f == null ? '●' : a > f ? '▲' : a < f ? '▼' : '＝'; })()}</b><small>vs previsión</small></div></div>`;
                centro = `<div class="nr-res"><span class="nr-real">${esc(ev.actual)}</span>${veredicto(ev)}</div>${datos(ev)}`;
            }
            const chips = afecta.length ? `<div class="nr-afecta"><small>Puede mover</small>${afecta.map((s) => `<span class="nr-chip${s === actual || exp[s] ? ' nr-yo' : ''}">${esc(s)}</span>`).join('')}</div>` : '';
            const riesgo = nExp ? `<div class="nr-riesgo"><i class="ph-fill ph-warning"></i><div><b>Tienes ${nExp} posición${nExp === 1 ? '' : 'es'} abierta${nExp === 1 ? '' : 's'} expuesta${nExp === 1 ? '' : 's'}</b> a esta noticia (${Object.entries(exp).map(([s, n]) => `${esc(s)}${n > 1 ? ' ×' + n : ''}`).join(', ')}). El precio puede moverse con fuerza y el spread ensancharse: revisa tu stop y tu riesgo.</div></div>` : '';
            return `<div class="nr-top"><span class="nr-tag">${barras(imp.n)}${imp.texto}</span><button type="button" class="nr-x" data-nr="cerrar" aria-label="Cerrar aviso">×</button></div>
                <div class="nr-main">${central}<div class="nr-body"><div class="nr-msg">${msg}</div><h3>${monedaHTML(ev.currency)}<span class="nr-nom">${esc(ev.nombre)}</span></h3>${centro}</div></div>
                ${chips}${riesgo}
                <div class="nr-acc"><button type="button" class="nr-ok" data-nr="cerrar">Entendido</button><button type="button" data-nr="silenciar" title="No volver a avisar de esta noticia">Silenciar</button><button type="button" data-nr="panel">Calendario</button></div>
                <div class="nr-barra"><i style="width:${f === 'previo' ? Math.max(0, Math.min(100, (dt / total) * 100)) : 100}%"></i></div>`;
        }

        const grupoDe = (f) => (f === 'publicada' ? 'pub' : 'pre');
        function mostrar(ev, f, ahora) {
            let t = tarjetas.get(ev.id);
            if (!t) {
                if (tarjetas.size >= 3) return;
                const el = document.createElement('article');
                el.className = `nr-card ${IMPACTO[ev.impact].clase}`; el.dataset.id = ev.id; el.setAttribute('role', 'alert');
                el.addEventListener('click', (e) => {
                    const b = e.target.closest('[data-nr]'); if (!b) return;
                    const k = b.dataset.nr;
                    if (k === 'cerrar') descartar(ev.id);
                    else if (k === 'silenciar') { cerradas.add(`${ev.id}|pre`); cerradas.add(`${ev.id}|pub`); descartar(ev.id); }
                    else if (k === 'panel') abrirPanel();
                });
                pila.appendChild(el);
                t = { el, fase: null, ev };
                tarjetas.set(ev.id, t);
                sonar(f === 'publicada' ? 'noticiaResultado' : 'noticia');
            }
            t.ev = ev;
            // Se vuelve a pintar entero solo al cambiar de fase, de exposición o de minuto; el resto del tiempo solo se mueve el anillo.
            const dt = (ev.t - ahora) / 1000;
            const clave = `${f}|${Object.keys(expuestas(ev)).join(',')}|${ev.actual || ''}|${f === 'previo' ? Math.ceil(dt / 60) : ''}`;
            if (t.clave !== clave) { t.el.innerHTML = cuerpo(ev, f, ahora); t.clave = clave; if (t.fase && t.fase !== f) sonar(f === 'ahora' ? 'noticiaYa' : f === 'publicada' ? 'noticiaResultado' : 'noticia'); t.fase = f; }
            else if (f === 'previo') {
                const total = prefs().lead * 60, b = t.el.querySelector('.nr-tiempo b'), p = t.el.querySelector('.nr-prog'), r = t.el.querySelector('.nr-barra i');
                if (b) b.textContent = mmss(dt);
                if (p) p.setAttribute('stroke-dashoffset', CIRC * (1 - Math.max(0, Math.min(1, dt / total))));
                if (r) r.style.width = Math.max(0, Math.min(100, (dt / total) * 100)) + '%';
            }
            t.el.classList.toggle('nr-urgente', f === 'previo' && dt <= 60);
            t.el.classList.toggle('nr-ahora', f === 'ahora');
            if (f === 'publicada' && !t.autoCierre) t.autoCierre = setTimeout(() => descartar(ev.id), 60000);
        }
        function descartar(id) {
            const t = tarjetas.get(id); if (!t) return;
            cerradas.add(`${id}|${grupoDe(t.fase)}`);
            clearTimeout(t.autoCierre); tarjetas.delete(id);
            t.el.classList.add('nr-sale'); setTimeout(() => t.el.remove(), 260);
        }

        function tick() {
            const ahora = Date.now();
            pintarPildora(ahora);
            const p = prefs();
            const vivos = new Set();
            if (p.pantalla && cargado) {
                eventos.forEach((ev) => {
                    if (!relevante(ev)) return;
                    const f = fase(ev, ahora);
                    if (f === 'lejos' || f === 'pasada') return;
                    if (cerradas.has(`${ev.id}|${grupoDe(f)}`)) return;
                    vivos.add(ev.id); mostrar(ev, f, ahora);
                });
            }
            tarjetas.forEach((t, id) => { if (!vivos.has(id)) { clearTimeout(t.autoCierre); tarjetas.delete(id); t.el.classList.add('nr-sale'); setTimeout(() => t.el.remove(), 260); } });
            if (p.marcas !== false && ahora % 3000 < 1100) pintarMarcas();
        }

        // ---------- marcas en el gráfico (noticias ya publicadas dentro del rango cargado) ----------
        function registrarOverlay() {
            try {
                klinecharts.registerOverlay({
                    name: 'nltNewsLine', totalStep: 1, lock: true,
                    createPointFigures: ({ coordinates, bounding, overlay }) => {
                        if (!coordinates.length) return [];
                        const x = coordinates[0].x, e = overlay.extendData || {}, c = e.alto ? '#FF4D6A' : '#FFB020';
                        return [
                            { type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x, y: 0 }, { x, y: bounding.height }] }, styles: { style: 'dashed', dashedValue: [3, 5], size: 1, color: c } },
                            { type: 'text', ignoreEvent: true, attrs: { x: x + 4, y: 14, text: e.texto || '', align: 'left', baseline: 'middle' }, styles: { color: '#fff', size: 10, family: 'Inter, system-ui, sans-serif', weight: 700, backgroundColor: e.alto ? 'rgba(255,77,106,.75)' : 'rgba(255,176,32,.7)', borderSize: 0, paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2, borderRadius: 4 } },
                        ];
                    },
                });
            } catch (_) { /* ya registrado */ }
        }
        function pintarMarcas() {
            try {
                const p = prefs();
                const lista = chart.getDataList();
                const clave = `${p.marcas}|${p.medio}|${getSymbol()}|${lista.length}|${lista.length ? lista[0].timestamp : 0}|${eventos.length}`;
                if (clave === ultimaMarca) return;
                ultimaMarca = clave;
                chart.removeOverlay({ groupId: GRUPO });
                if (p.marcas === false || !lista.length) return;
                const primera = lista[0].timestamp, ultima = lista[lista.length - 1];
                const mon = new Set(monedasDe(getSymbol()));
                eventos.filter((e) => (e.impact === 'HIGH' || (p.medio && e.impact === 'MEDIUM')) && mon.has(e.currency) && e.t >= primera && e.t <= ultima.timestamp).slice(-40).forEach((e) => {
                    chart.createOverlay({ name: 'nltNewsLine', groupId: GRUPO, lock: true, points: [{ timestamp: e.t, value: ultima.close }], extendData: { alto: e.impact === 'HIGH', texto: `${e.currency} ${e.nombre}`.slice(0, 26) } });
                });
            } catch (_) { /* el gráfico no admite la marca ahora */ }
        }

        // ---------- panel ----------
        const panel = document.createElement('section');
        panel.id = 'nrPanel'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'NLT News Radar');
        document.body.appendChild(panel);
        function etiquetaDia(d) {
            const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
            const dia = new Date(d); dia.setHours(0, 0, 0, 0);
            const n = Math.round((dia - hoy) / 864e5);
            return (n === 0 ? 'Hoy' : n === 1 ? 'Mañana' : n === -1 ? 'Ayer' : DIAS[dia.getDay()][0].toUpperCase() + DIAS[dia.getDay()].slice(1)) + ` · ${dia.getDate()} ${MESES[dia.getMonth()]}`;
        }
        function pintarPanel() {
            const p = prefs(), ahora = Date.now(), m = mias();
            const lista = eventos.filter((e) => (filtro === 'alto' ? e.impact === 'HIGH' : true) && e.t > ahora - 3 * 3600e3 && e.t < ahora + 60 * 3600e3);
            let dia = '';
            const filas = lista.map((e) => {
                const d = new Date(e.t), etq = etiquetaDia(d);
                const cab = etq !== dia ? `<div class="nrp-dia">${etq}</div>` : ''; dia = etq;
                const dt = (e.t - ahora) / 1000;
                const cuenta = dt > 0 ? `en ${cuentaCorta(dt)}` : (e.actual ? 'publicada' : 'hace ' + cuentaCorta(-dt));
                return `${cab}<div class="nrp-ev ${IMPACTO[e.impact].clase}${dt < 0 ? ' pasado' : ''}${m.has(e.currency) ? ' mio' : ''}"><div class="nrp-hora">${hhmm(d)}<small>${barras(IMPACTO[e.impact].n)}</small></div>
                    <div><div class="nrp-nom">${monedaHTML(e.currency)} ${esc(e.nombre)}</div><div class="nrp-sub">${e.actual ? `<span>Actual <b>${esc(e.actual)}</b></span>` : ''}${e.forecast ? `<span>Prev. <b>${esc(e.forecast)}</b></span>` : ''}${e.previous ? `<span>Ant. <b>${esc(e.previous)}</b></span>` : ''}${m.has(e.currency) ? '<span style="color:#fff;font-weight:700">· afecta tu gráfico</span>' : ''}</div></div>
                    <div class="nrp-cuenta">${cuenta}</div></div>`;
            }).join('');
            const sw = (k, titulo, sub, on, extra) => `<label class="nrp-sw"><span>${titulo}<small>${sub}</small></span><input type="checkbox" data-nrp="${k}" ${on ? 'checked' : ''} ${extra || ''}></label>`;
            panel.innerHTML = `<div class="nrp-cab"><span class="nrp-radar"></span><div><h2>NLT News Radar</h2><p>Noticias que mueven el mercado, antes de que lo muevan</p></div><button type="button" class="nr-x" data-nrp="cerrar" aria-label="Cerrar">×</button></div>
                <div class="nrp-filtros"><button type="button" data-nrp="f-alto" class="${filtro === 'alto' ? 'on' : ''}">Solo alto impacto</button><button type="button" data-nrp="f-todo" class="${filtro === 'todo' ? 'on' : ''}">Alto y medio</button></div>
                <div class="nrp-lista">${filas || `<div class="nrp-vacio">${cargado ? 'No hay noticias de este tipo en las próximas horas.' : 'Cargando el calendario…'}</div>`}</div>
                <div class="nrp-ajustes">
                    ${sw('push', 'Avisarme con la app cerrada', serverPrefs.disponible ? 'Notificación al celular o computador, aunque no tengas NLT abierto' : 'Aún no disponible en el servidor', !!serverPrefs.push, serverPrefs.disponible ? '' : 'disabled')}
                    <div class="nrp-lead" role="group" aria-label="Aviso previo">${[15, 10, 5].map((n) => `<button type="button" data-nrp="lead-${n}" class="${p.lead === n ? 'on' : ''}">${n} min antes</button>`).join('')}</div>
                    <div class="nrp-msg" id="nrpMsg"></div>
                    <button type="button" class="nrp-mas" data-nrp="mas" aria-expanded="${masAbierto}">Más ajustes <i class="ph ph-caret-${masAbierto ? 'up' : 'down'}"></i></button>
                    <div class="nrp-extra" ${masAbierto ? '' : 'hidden'}>
                    ${sw('pantalla', 'Avisos en pantalla', 'Una tarjeta antes, durante y con el resultado', p.pantalla)}
                    ${sw('sonido', 'Sonido', 'Un tono corto de radar', p.sonido)}
                    ${sw('marcas', 'Marcar en el gráfico', 'Líneas donde salió una noticia fuerte', p.marcas !== false)}
                    ${sw('medio', 'Incluir impacto medio', 'Solo las que afectan a tu símbolo o posiciones', p.medio)}
                    </div>
                </div>`;
        }
        function abrirPanel() { panelAbierto = true; panel.hidden = false; pila.style.display = 'none'; pintarPanel(); cargar(); }
        function cerrarPanel() { panelAbierto = false; panel.hidden = true; pila.style.display = ''; }
        const msgPanel = (t) => { const e = panel.querySelector('#nrpMsg'); if (e) e.textContent = t || ''; };

        async function guardarServidor(cambio) {
            const nuevo = { ...serverPrefs, ...cambio };
            try {
                const r = await NLT_API.chartsNoticiasGuardar({ push: !!nuevo.push, lead_minutes: nuevo.lead_minutes, impacts: nuevo.impacts });
                serverPrefs = { ...serverPrefs, ...r, disponible: true };
                return true;
            } catch (e) { msgPanel('No se pudo guardar en tu cuenta: ' + (e.message || 'error')); return false; }
        }
        panel.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-nrp]'); if (!b || b.tagName === 'INPUT') return;
            const k = b.dataset.nrp;
            if (k === 'cerrar') return cerrarPanel();
            if (k === 'f-alto') { filtro = 'alto'; return pintarPanel(); }
            if (k === 'f-todo') { filtro = 'todo'; return pintarPanel(); }
            if (k === 'mas') { masAbierto = !masAbierto; return pintarPanel(); }
            if (k.startsWith('lead-')) {
                const n = Number(k.slice(5)); guardarPrefs({ lead: n });
                if (serverPrefs.push) guardarServidor({ lead_minutes: n });
                pintarPanel(); tick();
            }
        });
        panel.addEventListener('change', async (e) => {
            const i = e.target.closest('input[data-nrp]'); if (!i) return;
            const k = i.dataset.nrp;
            if (k === 'push') {
                msgPanel('');
                if (i.checked) {
                    i.disabled = true;
                    const ok = NLT.pushActivar ? await NLT.pushActivar() : false;
                    if (!ok) { i.checked = false; i.disabled = false; msgPanel('No se pudieron activar las notificaciones (permiso denegado o aún sin configurar en el servidor).'); return; }
                    const g = await guardarServidor({ push: true, lead_minutes: prefs().lead, impacts: prefs().medio ? ['HIGH', 'MEDIUM'] : ['HIGH'] });
                    i.disabled = false; if (!g) { i.checked = false; return; }
                    msgPanel(`Listo: te avisaremos ${prefs().lead} minutos antes de cada noticia de alto impacto.`);
                } else { const g = await guardarServidor({ push: false }); if (!g) i.checked = true; else msgPanel('Avisos con la app cerrada desactivados.'); }
                return;
            }
            guardarPrefs({ [k]: i.checked });
            if (k === 'medio' && serverPrefs.push) guardarServidor({ impacts: i.checked ? ['HIGH', 'MEDIUM'] : ['HIGH'] });
            if (k === 'sonido' && i.checked) sonar('noticia');
            ultimaMarca = ''; tick(); pintarPanel();
        });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelAbierto) cerrarPanel(); });
        document.addEventListener('pointerdown', (e) => { if (panelAbierto && !panel.contains(e.target) && !pill.contains(e.target) && !e.target.closest('.nr-card')) cerrarPanel(); }, true);

        // ---------- arranque ----------
        registrarOverlay();
        (async () => {
            try { const r = await NLT_API.chartsNoticiasPrefs(); serverPrefs = { ...serverPrefs, ...r, disponible: true }; }
            catch (e) { serverPrefs.disponible = !/503|404|no está disponible/i.test(String((e && e.message) || e)); }
        })();
        cargar();
        setInterval(() => { const ahora = Date.now(); const cerca = eventos.some((e) => Math.abs(e.t - ahora) < 12 * 60e3); if (cerca ? ahora - ultimaCarga > 19000 : ahora - ultimaCarga > 85000) cargar(); }, 10000);
        setInterval(tick, 1000);
        return { repintar() { ultimaMarca = ''; tick(); }, abrir: abrirPanel, _estado: () => ({ eventos, tarjetas: tarjetas.size }) };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.noticias = { montar, monedasDe };
})();
