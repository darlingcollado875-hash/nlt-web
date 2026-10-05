/* NLT Charts -- NLT Script: escribe tus propios indicadores y ponlos en el gráfico (plan NLT Charts Trader).
 *
 * El texto de tus scripts se guarda en tu perfil (servidor). Se EJECUTA solo en tu navegador, en un Web Worker aparte con el
 * intérprete propio de NLT Script (nlts.js: sin eval, sin red, con límite de operaciones y de tiempo). Un script que se cuelga
 * se detiene solo y te dice por qué. El resultado se dibuja como un indicador más del gráfico (líneas, histogramas, puntos,
 * niveles, fondos y marcas) y se recalcula con cada vela nueva. */
(function () {
    // El worker usa el mismo sello de versión (?v=) que el nlts.js de la página, así nunca queda un intérprete viejo en caché.
    const TAG_NLTS = document.querySelector('script[src*="charts/nlts.js"]');
    const URL_WORKER = TAG_NLTS ? TAG_NLTS.src.replace(/nlts\.js(\?.*)?$/, (m, q) => `nlts-worker.js${q || ''}`) : 'assets/js/charts/nlts-worker.js';
    const TIEMPO_MAX_MS = 8000;
    const PALETA = ['#2962FF', '#FF9800', '#E040FB', '#00BCD4', '#F23645', '#4CAF50'];
    const CANDLE_PANE = 'candle_pane';
    const PALABRAS = /\b(if|else|for|to|by|in|while|def|return|and|or|not|true|false|break|continue|var|varip)\b/g;
    const FUNCIONES = /\b(indicator|study|plot|plotshape|plotchar|hline|bgcolor|alertcondition|input|nz|na|ta\.\w+|math\.\w+|color\.\w+|input\.\w+|shape\.\w+|location\.\w+|plot\.style_\w+|str\.\w+)\b/g;
    const SERIES = /\b(open|high|low|close|volume|hl2|hlc3|ohlc4|bar_index|time)\b/g;

    // ── ejecutor: un Worker, una tarea a la vez, con tiempo máximo ──
    function crearEjecutor() {
        let w = null, cola = Promise.resolve(), seq = 0;
        const matar = () => { if (w) { try { w.terminate(); } catch (_) { /* nada */ } w = null; } };
        const vacio = (msg) => ({ ok: false, n: 0, errores: [{ linea: null, mensaje: msg }], meta: {}, inputs: [], plots: [], hlines: [], bgcolors: [], shapes: [], alerts: [] });
        function una(codigo, velas, inputs, ast) {
            return new Promise((resolve) => {
                const id = ++seq;
                let listo = false;
                const fin = (r) => { if (listo) return; listo = true; clearTimeout(t); resolve(r); };
                const t = setTimeout(() => { matar(); fin(vacio(`El script tardó más de ${TIEMPO_MAX_MS / 1000} segundos y se detuvo. Revisa los bucles o baja los períodos.`)); }, TIEMPO_MAX_MS);
                try {
                    if (!w) {
                        w = new Worker(URL_WORKER);
                        w.onerror = (ev) => { matar(); fin(vacio('No se pudo iniciar el motor de scripts en este navegador.' + (ev && ev.message ? ` (${ev.message})` : ''))); };
                    }
                    w.onmessage = (ev) => { if (ev.data && ev.data.id === id) fin(ev.data.r); };
                    w.postMessage({ id, codigo, velas, inputs, ast });
                } catch (e) { matar(); fin(vacio('No se pudo iniciar el motor de scripts: ' + (e.message || e))); }
            });
        }
        return { correr: (codigo, velas, inputs, ast) => { const p = cola.then(() => una(codigo, velas, inputs, ast)); cola = p.catch(() => {}); return p; }, matar };
    }

    function velasDe(lista) {
        const n = lista.length, v = { t: new Array(n), o: new Array(n), h: new Array(n), l: new Array(n), c: new Array(n), v: new Array(n) };
        for (let i = 0; i < n; i++) { const k = lista[i]; v.t[i] = k.timestamp; v.o[i] = k.open; v.h[i] = k.high; v.l[i] = k.low; v.c[i] = k.close; v.v[i] = k.volume || 0; }
        return v;
    }

    function resaltar(codigo, esc) {
        // Se parte el texto en: comentarios, textos y el resto (donde se pintan palabras, funciones y números)
        const partes = [];
        const re = /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g;
        let ult = 0, m;
        while ((m = re.exec(codigo))) {
            if (m.index > ult) partes.push(['r', codigo.slice(ult, m.index)]);
            partes.push([m[1] ? 'c' : 's', m[0]]);
            ult = m.index + m[0].length;
        }
        if (ult < codigo.length) partes.push(['r', codigo.slice(ult)]);
        return partes.map(([t, x]) => {
            const e = esc(x);
            if (t === 'c') return `<i class="sc-c">${e}</i>`;
            if (t === 's') return `<i class="sc-s">${e}</i>`;
            return e.replace(/\b\d+(\.\d+)?\b/g, '<i class="sc-n">$&</i>').replace(FUNCIONES, '<i class="sc-f">$&</i>').replace(PALABRAS, '<i class="sc-k">$&</i>').replace(SERIES, '<i class="sc-v">$&</i>');
        }).join('') + '\n';
    }

    function montar({ chart, getSymbol }) {
        const state = NLTCharts.state, esc = NLTCharts.ui.esc;
        const ejecutor = crearEjecutor();
        const activos = new Map();          // id -> { id, nombre, codigo, inputs, ind (nombre en el gráfico), res, firma, errores }
        let busca = { q: '', sort: 'recent', creator: '', page: 0 }, hayMas = false, tienePlan = false, miUsuario = null, ganancias = null, admin = null, comisionPct = 20, compraEnCurso = null, compartidos = [], tienda = [], accesos = [], vista = 'mis', lista = [], max = 50, acceso = null /* null = sin saber, true/false */, motivo = '';
        let sel = null /* script abierto: { id|null, nombre, codigo } */, sucio = false, mensaje = '', erroresVivos = [], timerValida = null;

        const btn = document.createElement('button');
        btn.type = 'button'; btn.id = 'chBtnScripts'; btn.className = 'ch-btn'; btn.title = 'NLT Script: tus indicadores'; btn.setAttribute('aria-label', 'NLT Script');
        btn.innerHTML = '<i class="ph ph-code"></i><span class="ch-btn-label">Scripts</span>';
        const modal = document.createElement('div');
        modal.className = 'sc-modal'; modal.id = 'chScripts'; modal.hidden = true; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-label', 'NLT Script');
        document.body.appendChild(modal);

        // ───────────── dibujar en el gráfico ─────────────
        const firmaDe = (d) => { const u = d[d.length - 1]; return u ? `${d.length}|${u.timestamp}|${u.open}|${u.high}|${u.low}|${u.close}|${u.volume}` : '0'; };
        function filas(res, n) {
            const out = new Array(n);
            for (let i = 0; i < n; i++) {
                const f = {};
                res.plots.forEach((p, j) => {
                    const v = p.valores[i - (p.desfase || 0)];
                    f['p' + j] = typeof v === 'number' && Number.isFinite(v) ? v : undefined;
                    const c = p.colores[i - (p.desfase || 0)];
                    if (typeof c === 'string') f['c' + j] = c;
                });
                out[i] = f;
            }
            return out;
        }
        function figuras(res) {
            return res.plots.map((p, j) => {
                const base = PALETA[j % PALETA.length];
                const color = (data) => (data.current && data.current['c' + j]) || p.color || base;
                const tit = `${p.titulo}: `;
                if (p.estilo === 'histogram' || p.estilo === 'columns') return { key: 'p' + j, title: tit, type: 'bar', baseValue: 0, styles: ({ data }) => ({ color: color(data), style: 'fill' }) };
                if (p.estilo === 'circles' || p.estilo === 'cross') return { key: 'p' + j, title: tit, type: 'circle', styles: ({ data }) => ({ color: color(data), style: 'fill' }) };
                return { key: 'p' + j, title: tit, type: 'line', styles: ({ data }) => ({ color: color(data), size: Math.max(1, Math.min(6, Number(p.grosor) || 1)) }) };
            });
        }
        function dibujarExtras(a, { ctx, chart: ch, indicator, xAxis, yAxis, bounding }) {
            const res = a.res;
            if (!res) return false;
            const { from, to } = ch.getVisibleRange();
            const ancho = Math.max(1, (ch.getBarSpace && ch.getBarSpace().bar) || 6);
            const datos = ch.getDataList();
            ctx.save();
            res.bgcolors.forEach((b) => {
                for (let i = Math.max(0, from); i < Math.min(b.colores.length, to); i++) {
                    if (typeof b.colores[i] !== 'string') continue;
                    ctx.fillStyle = b.colores[i];
                    const x = xAxis.convertToPixel(i);
                    ctx.fillRect(x - ancho / 2, 0, ancho, bounding.height);
                }
            });
            res.hlines.forEach((h) => {
                if (!Number.isFinite(h.precio)) return;
                const y = yAxis.convertToPixel(h.precio);
                ctx.strokeStyle = h.color || '#787B86'; ctx.lineWidth = 1;
                ctx.setLineDash(h.estilo === 'solid' ? [] : h.estilo === 'dotted' ? [2, 3] : [5, 4]);
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(bounding.width, y); ctx.stroke();
            });
            ctx.setLineDash([]);
            ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
            res.shapes.forEach((s) => {
                if (s.barra < from || s.barra >= to || !datos[s.barra]) return;
                const k = datos[s.barra], x = xAxis.convertToPixel(s.barra);
                const arriba = s.ubicacion === 'abovebar', abajo = s.ubicacion === 'belowbar';
                const yBase = arriba ? yAxis.convertToPixel(k.high) - 8 : abajo ? yAxis.convertToPixel(k.low) + 8 : yAxis.convertToPixel(k.close);
                const dir = arriba ? -1 : 1, r = Math.max(3, Math.min(6, ancho / 2));
                ctx.fillStyle = s.color || '#2962FF'; ctx.strokeStyle = ctx.fillStyle;
                ctx.beginPath();
                const est = String(s.estilo);
                if (/triangleup/.test(est)) { ctx.moveTo(x, yBase - r); ctx.lineTo(x - r, yBase + r); ctx.lineTo(x + r, yBase + r); ctx.closePath(); ctx.fill(); }
                else if (/triangledown/.test(est)) { ctx.moveTo(x, yBase + r); ctx.lineTo(x - r, yBase - r); ctx.lineTo(x + r, yBase - r); ctx.closePath(); ctx.fill(); }
                else if (/square|diamond/.test(est)) { ctx.fillRect(x - r, yBase - r, r * 2, r * 2); }
                else if (/cross|xcross/.test(est)) { ctx.moveTo(x - r, yBase); ctx.lineTo(x + r, yBase); ctx.moveTo(x, yBase - r); ctx.lineTo(x, yBase + r); ctx.stroke(); }
                else if (/arrowup/.test(est)) { ctx.moveTo(x, yBase - r * 1.4); ctx.lineTo(x - r, yBase + r * .2); ctx.lineTo(x + r, yBase + r * .2); ctx.closePath(); ctx.fill(); }
                else if (/arrowdown/.test(est)) { ctx.moveTo(x, yBase + r * 1.4); ctx.lineTo(x - r, yBase - r * .2); ctx.lineTo(x + r, yBase - r * .2); ctx.closePath(); ctx.fill(); }
                else { ctx.arc(x, yBase, r * .8, 0, Math.PI * 2); ctx.fill(); }
                if (s.texto) ctx.fillText(s.texto, x, yBase + dir * (r + 11));
            });
            ctx.restore();
            return false;
        }

        let avisados = new Set();
        function revisarAlertas(a) {
            if (!a.res || !a.res.alerts) return;
            const n = a.res.n;
            a.res.alerts.forEach((al) => {
                if (!al.barras.includes(n - 1)) return;
                const clave = `${a.id}|${al.titulo}|${chart.getDataList()[n - 1] && chart.getDataList()[n - 1].timestamp}`;
                if (avisados.has(clave)) return;
                avisados.add(clave);
                if (avisados.size > 500) avisados = new Set([...avisados].slice(-100));
                mensaje = `🔔 ${a.nombre}: ${al.titulo}${al.mensaje ? ' — ' + al.mensaje : ''}`;
                if (!modal.hidden) pintar();
                try { if (window.Notification && Notification.permission === 'granted') new Notification(`NLT Script · ${a.nombre}`, { body: `${getSymbol()}: ${al.titulo}` }); } catch (_) { /* sin permiso */ }
            });
        }

        function nombreIndicador(a) { return `NLT_S_${a.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}_${a.version}`; }
        async function ponerEnGrafico(a) {
            const velas = chart.getDataList();
            const res = await ejecutor.correr(a.codigo, velasDe(velas), a.inputs, a.ast);
            a.errores = res.ok ? [] : res.errores;
            if (!res.ok) { quitarDelGrafico(a); a.res = null; return false; }
            a.res = res; a.firma = firmaDe(velas);
            a.nombreCorto = (res.meta && res.meta.titulo) || a.nombre;
            // cada cambio de forma (otra cantidad de plots, otro panel) pide registrar un indicador nuevo
            const forma = `${res.plots.map((p) => p.estilo + p.titulo).join('|')}#${res.meta.overlay ? 1 : 0}`;
            quitarDelGrafico(a);
            a.version = (a.version || 0) + 1; a.forma = forma;
            a.ind = nombreIndicador(a);
            const overlay = !!res.meta.overlay;
            klinecharts.registerIndicator({
                name: a.ind, shortName: a.nombreCorto, series: overlay ? 'price' : 'normal', calcParams: [], precision: res.meta.precision != null ? res.meta.precision : (overlay ? 5 : 2),
                figures: figuras(res),
                calc: async (datos) => {
                    const f = firmaDe(datos);
                    if (a.res && a.firma === f) return filas(a.res, datos.length);
                    const r = await ejecutor.correr(a.codigo, velasDe(datos), a.inputs, a.ast);
                    if (!r.ok) { a.errores = r.errores; if (!modal.hidden) pintar(); return new Array(datos.length).fill({}); }
                    a.errores = []; a.res = r; a.firma = f; revisarAlertas(a);
                    return filas(r, datos.length);
                },
                draw: (args) => dibujarExtras(a, args),
            });
            const crear = { name: a.ind };
            if (overlay) { crear.paneId = CANDLE_PANE; chart.createIndicator(crear, true); } else chart.createIndicator(crear, false, { height: 130, minHeight: 60 });
            return true;
        }
        function quitarDelGrafico(a) {
            if (!a.ind) return;
            try { chart.removeIndicator({ name: a.ind }); } catch (_) { /* ya no estaba */ }
            a.ind = null; a.forma = null;
        }
        function guardarActivos() {
            const o = {};
            activos.forEach((a, id) => { o[id] = { inputs: a.inputs }; });
            state.savePrefs({ scriptsActivos: o });
        }
        async function activar(id, nombre, codigo, inputs, ast) {
            const a = activos.get(id) || { id, version: 0 };
            // protegido: llega solo el árbol compilado (sin texto); abierto o propio: el texto
            Object.assign(a, { nombre, codigo: codigo || '', ast: ast || null, inputs: inputs || a.inputs || {} });
            activos.set(id, a);
            const ok = await ponerEnGrafico(a);
            guardarActivos();
            return ok;
        }
        function desactivar(id) {
            const a = activos.get(id);
            if (a) { quitarDelGrafico(a); activos.delete(id); guardarActivos(); }
        }

        // ───────────── API del servidor ─────────────
        async function cargarLista() {
            try {
                const r = await NLT_API.chartsScripts();
                lista = r.scripts || []; max = r.max || 10; tienePlan = !!r.plan; acceso = true; motivo = '';
            } catch (e) {
                if (e.status === 403 || e.status === 401) { acceso = false; motivo = e.message || ''; } else { acceso = acceso === null ? null : acceso; motivo = e.message || 'No se pudieron cargar tus scripts.'; if (e.status === 503) acceso = 'pronto'; }
            }
            if (!miUsuario) { try { miUsuario = (await NLT_API.communityMiPerfil()).username; } catch (_) { /* sin perfil todavía */ } }
            // Los que te compartieron (o sacaste de la tienda) se usan SIN necesidad del plan
            try { compartidos = (await NLT_API.chartsScriptsCompartidos()).scripts || []; } catch (_) { compartidos = []; }
        }
        async function cargarTienda() {
            try { const r = await NLT_API.chartsScriptsTienda(busca); tienda = (busca.page ? tienda : []).concat(r.scripts || []); hayMas = !!r.more; if (r.commission_pct != null) comisionPct = r.commission_pct; } catch (e) { tienda = []; mensaje = e.message || 'No se pudo cargar la tienda.'; }
            if (tienePlan) { try { ganancias = await NLT_API.chartsScriptGanancias(); } catch (_) { ganancias = null; } }
            try { admin = await NLT_API.chartsScriptAdmin(); } catch (_) { admin = null; }   // 403 = no eres admin: el panel simplemente no aparece
        }
        async function cargarAccesos() {
            accesos = [];
            if (!sel || !sel.id || sel.ajeno) return;
            try { accesos = (await NLT_API.chartsScriptAccesos(sel.id)).grants || []; } catch (_) { accesos = []; }
        }
        async function abrirAjeno(id) {
            try {
                const r = await NLT_API.chartsScriptCompartido(id);
                const s = r.script;
                sel = { id: s.id, nombre: s.name, codigo: s.code || '', ast: s.ast || null, protegido: !!s.protected, ajeno: true, creador: s.creator, descripcion: s.description, abierto: !s.protected }; sucio = false; mensaje = ''; vista = 'mis';
            } catch (e) { mensaje = e.message || 'No se pudo abrir el script.'; }
            pintar();
        }
        async function abrirScript(id) {
            try {
                const r = await NLT_API.chartsScript(id);
                const s = r.script;
                const meta = lista.find((x) => x.id === s.id) || {};
                sel = { id: s.id, nombre: s.name, codigo: s.code, publicado: meta.visibility === 'listed', descripcion: meta.description || '', precio: meta.price_usd || '', facturacion: meta.billing || 'monthly', bloqueado: !!meta.blocked }; sucio = false; mensaje = ''; vista = 'mis';
            } catch (e) { mensaje = e.message || 'No se pudo abrir el script.'; }
            validarVivo(); await cargarAccesos(); pintar();
        }
        function nuevo(ejemplo) {
            const base = ejemplo || NLTCharts.nltsEjemplos[0];
            let nombre = ejemplo ? ejemplo.nombre : 'Mi script', k = 2;
            while (lista.some((s) => s.name === nombre)) nombre = `${ejemplo ? ejemplo.nombre : 'Mi script'} ${k++}`;
            sel = { id: null, nombre, codigo: base.codigo }; sucio = true; mensaje = ''; vista = 'mis'; accesos = [];
            validarVivo(); pintar();
        }
        async function guardar() {
            if (!sel) return;
            const nombre = sel.nombre.trim();
            if (!nombre) { mensaje = 'Ponle un nombre al script.'; pintar(); return; }
            try {
                let ast = null;
                try { ast = window.NLTS.compilar(sel.codigo); } catch (_) { ast = null; }   // el compilado viaja con el script: es lo único que recibe quien lo use protegido
                const r = sel.id ? await NLT_API.chartsScriptGuardar(sel.id, nombre, sel.codigo, ast) : await NLT_API.chartsScriptCrear(nombre, sel.codigo, ast);
                sel.id = r.script.id; sel.nombre = r.script.name; sucio = false; mensaje = 'Guardado.';
                await cargarLista();
                if (activos.has(sel.id)) await activar(sel.id, sel.nombre, sel.codigo);   // ya está en el gráfico: se actualiza
            } catch (e) { mensaje = e.message || 'No se pudo guardar.'; }
            pintar();
        }
        async function borrar() {
            if (!sel || !sel.id) { sel = null; pintar(); return; }
            if (!window.confirm(`¿Borrar el script “${sel.nombre}”? No se puede deshacer.`)) return;
            try { await NLT_API.chartsScriptBorrar(sel.id); desactivar(sel.id); sel = null; mensaje = 'Script borrado.'; await cargarLista(); } catch (e) { mensaje = e.message || 'No se pudo borrar.'; }
            pintar();
        }
        async function alternarEnGrafico() {
            if (!sel) return;
            if (!sel.id || sucio) { await guardar(); if (!sel.id || sucio) return; }
            if (activos.has(sel.id)) { desactivar(sel.id); mensaje = 'Quitado del gráfico.'; }
            else {
                const ok = await activar(sel.id, sel.nombre, sel.codigo);
                const a = activos.get(sel.id);
                if (ok) { mensaje = 'Añadido al gráfico.'; sel.errorCorrida = null; } else { mensaje = ''; sel.errorCorrida = a ? a.errores : []; activos.delete(sel.id); guardarActivos(); }
            }
            pintar();
        }
        function validarVivo() {
            erroresVivos = sel ? NLTS.validar(sel.codigo) : [];
        }

        // ───────────── pantalla ─────────────
        function htmlAjustes() {
            const a = sel && sel.id && activos.get(sel.id);
            if (!a || !a.res || !a.res.inputs.length) return '';
            const filasIn = a.res.inputs.map((inp, i) => {
                const val = Object.prototype.hasOwnProperty.call(a.inputs, inp.id) ? a.inputs[inp.id] : inp.def;
                let campo;
                if (inp.tipo === 'bool') campo = `<input type="checkbox" data-in="${i}" ${val ? 'checked' : ''}>`;
                else if (Array.isArray(inp.opciones) && inp.opciones.length) campo = `<select data-in="${i}">${inp.opciones.map((o) => `<option ${String(o) === String(val) ? 'selected' : ''}>${esc(String(o))}</option>`).join('')}</select>`;
                else if (inp.tipo === 'int' || inp.tipo === 'float') campo = `<input type="number" data-in="${i}" value="${esc(String(val))}" ${inp.min != null ? `min="${inp.min}"` : ''} ${inp.max != null ? `max="${inp.max}"` : ''} step="${inp.step || (inp.tipo === 'int' ? 1 : 'any')}">`;
                else campo = `<input type="text" data-in="${i}" value="${esc(String(val == null ? '' : val))}">`;
                return `<label class="sc-in"><span>${esc(inp.titulo)}</span>${campo}</label>`;
            }).join('');
            return `<div class="sc-ajustes"><div class="sc-sub">Ajustes del script</div>${filasIn}</div>`;
        }
        // errores de sintaxis (al escribir) primero; si no hay, los que dio la última corrida en el gráfico
        const erroresMostrados = () => (erroresVivos.length ? erroresVivos : (sel && sel.id && activos.get(sel.id) && activos.get(sel.id).errores) || (sel && sel.errorCorrida) || []);
        function htmlAjeno() {
            const enGrafico = activos.has(sel.id);
            return `<div class="sc-barra"><div class="sc-nombre sc-fijo">${esc(sel.nombre)}</div>
                    <button class="sc-b ${enGrafico ? '' : 'on'}" data-a="grafico-ajeno">${enGrafico ? 'Quitar del gráfico' : 'Añadir al gráfico'}</button></div>
                <div class="sc-ficha"><p class="sc-peq">Indicador de <b>${esc(sel.creador || 'un creador')}</b></p>${sel.descripcion ? `<p>${esc(sel.descripcion)}</p>` : ''}
                    <p class="sc-peq">${sel.abierto ? 'Código abierto: puedes leerlo, probarlo y copiarlo a tus scripts.' : '🔒 Indicador protegido: su creador no muestra el código. Aquí lo usas y ajustas.'}</p></div>
                ${sel.abierto && sel.codigo ? `<div class="sc-cod sc-lectura"><pre class="sc-gut" aria-hidden="true">${Array.from({ length: Math.max(1, sel.codigo.split('\n').length) }, (_, i) => i + 1).join('\n')}</pre><div class="sc-edwrap"><pre class="sc-hl sc-hl-lectura"><code>${resaltar(sel.codigo, esc)}</code></pre></div></div>
                    <div class="sc-barra"><button class="sc-b" data-a="copiar-ajeno">Copiar a mis scripts</button></div>` : ''}
                ${erroresMostrados().length ? `<div class="sc-estado mal">${erroresMostrados().map((e) => `<div>${esc(e.mensaje)}</div>`).join('')}</div>` : ''}
                ${mensaje ? `<div class="sc-estado"><div class="sc-msg">${esc(mensaje)}</div></div>` : ''}
                ${htmlAjustes()}`;
        }
        function htmlCompartir() {
            if (!sel || !sel.id || sel.ajeno || sucio) return '';
            const gratisPublicado = sel.publicado && !sel.precio, ventaPublicada = sel.publicado && !!sel.precio;
            const filas = accesos.map((g) => `<div class="sc-acc"><span>${esc(g.email)}</span><button class="sc-b mal" data-a="revocar" data-gid="${esc(g.id)}">Quitar</button></div>`).join('');
            if (sel.bloqueado) return '<div class="sc-comp"><p class="sc-peq" style="color:#F87171">NLT bloqueó este indicador: no se puede publicar ni compartir.</p></div>';
            const abierto = `<div class="sc-sub">Publicar gratis · código abierto</div>
                <form class="sc-form" data-a="publicar"><input type="text" name="descripcion" maxlength="500" placeholder="¿Qué hace tu indicador? (mínimo 10 caracteres)" value="${esc(sel.descripcion || '')}">
                    <button class="sc-b ${gratisPublicado ? '' : 'on'}" type="submit" data-modo="abierto">${gratisPublicado ? 'Actualizar' : 'Publicar gratis'}</button>
                    ${gratisPublicado ? '<button class="sc-b mal" type="submit" data-modo="quitar">Quitar de la tienda</button>' : ''}</form>
                <p class="sc-peq">${gratisPublicado ? 'Publicado: ' : ''}Cualquier usuario de NLT podrá usarlo, leer el código y copiarlo. Es gratis y no necesita ningún plan. Eres responsable de lo que publicas.</p>`;
            const privado = tienePlan ? `<div class="sc-sub" style="margin-top:14px">Compartir en privado · el código no se ve</div>
                <form class="sc-form" data-a="compartir"><input type="email" name="email" placeholder="correo de la persona (con cuenta en NLT)" required maxlength="200"><button class="sc-b on" type="submit">Dar acceso</button></form>
                ${filas || '<p class="sc-peq">Nadie más tiene acceso todavía.</p>'}
                <div class="sc-sub" style="margin-top:14px">Vender en la tienda · el código no se ve</div>
                <form class="sc-form" data-a="publicar"><input type="text" name="descripcion" maxlength="500" placeholder="¿Qué hace tu indicador? (mínimo 10 caracteres)" value="${esc(sel.descripcion || '')}">
                    <input type="number" name="precio" min="2" max="200" step="0.01" placeholder="Precio US$ (2 a 200)" value="${esc(String(sel.precio || ''))}" style="max-width:170px" required>
                    <select name="facturacion" class="sc-ej" aria-label="Tipo de cobro"><option value="monthly" ${sel.facturacion === 'one_time' ? '' : 'selected'}>Cobro mensual</option><option value="one_time" ${sel.facturacion === 'one_time' ? 'selected' : ''}>Pago único</option></select>
                    <button class="sc-b ${ventaPublicada ? '' : 'on'}" type="submit" data-modo="venta">${ventaPublicada ? 'Actualizar precio' : 'Poner a la venta'}</button>
                    ${ventaPublicada ? '<button class="sc-b mal" type="submit" data-modo="quitar">Quitar de la tienda</button>' : ''}</form>
                <p class="sc-peq">El pago lo cobra NLT por Whop y te corresponde el ${100 - comisionPct}% de cada cobro (NLT se queda el ${comisionPct}%); tus ganancias aparecen en la Tienda y NLT te las paga aparte. Quien lo use recibe el indicador protegido: no ve tu código. Si dejas de tener el plan, tu indicador de pago deja de mostrarse y nadie nuevo puede comprarlo (quienes ya pagaron lo conservan).</p>`
                : `<div class="sc-lockbox"><i class="ph ph-lock-key"></i><div><b>Compartir en privado y vender con el código oculto</b>
                    <p class="sc-peq">Se desbloquea con el plan NLT Charts Trader (el mismo que conecta tus cuentas MT5 reales). Publicar gratis con código abierto no lo necesita.</p>
                    <a class="sc-b on" href="charts-trader.html">Ver el plan</a></div></div>`;
            return `<div class="sc-comp">${abierto}${privado}</div>`;
        }
        function precioTxt(t) { return t.price_usd ? `US$${Number(t.price_usd).toFixed(2)}${t.billing === 'one_time' ? ' · pago único' : ' / mes'}` : 'Gratis'; }
        function htmlTienda() {
            const gan = ganancias && (ganancias.sales || ganancias.pending_usd || ganancias.paid_usd)
                ? `<div class="sc-ficha"><b>Tus ventas</b><p>Por pagarte: <b>US$${Number(ganancias.pending_usd).toFixed(2)}</b> · Ya pagado: US$${Number(ganancias.paid_usd).toFixed(2)} · Cobros: ${ganancias.sales}</p><p class="sc-peq">NLT se queda el ${comisionPct}% de cada cobro y te paga tu parte aparte.</p></div>` : '';
            const panelAdmin = admin ? `<div class="sc-ficha"><b>Administración</b>
                ${(admin.payouts || []).length ? admin.payouts.map((x) => `<div class="sc-acc"><span>${esc(x.email)} — debe US$${Number(x.owed_usd).toFixed(2)} (${x.sales} cobros)</span><button class="sc-b on" data-a="adm-pagado" data-v="${esc(x.seller_user_id)}">Marcar pagado</button></div>`).join('') : '<p class="sc-peq">Sin pagos pendientes a creadores.</p>'}
                ${(admin.reports || []).length ? `<div class="sc-sub" style="margin-top:8px">Reportes</div>` + admin.reports.map((r) => `<div class="sc-acc"><span>${esc(r.name)}: ${esc(r.reason)}</span><button class="sc-b ${r.blocked ? '' : 'mal'}" data-a="adm-bloquear" data-id="${esc(r.script_id)}" data-b="${r.blocked ? '0' : '1'}">${r.blocked ? 'Desbloquear' : 'Bloquear'}</button></div>`).join('') : ''}</div>` : '';
            const barra = `<form class="sc-form" data-a="buscar-tienda" role="search"><input class="sc-bq" type="search" name="q" maxlength="40" placeholder="Buscar indicadores o creadores…" aria-label="Buscar indicadores" value="${esc(busca.q)}">
                    <select class="sc-ej" name="sort" aria-label="Ordenar"><option value="recent" ${busca.sort === 'recent' ? 'selected' : ''}>Más recientes</option><option value="name" ${busca.sort === 'name' ? 'selected' : ''}>Nombre A–Z</option><option value="price_asc" ${busca.sort === 'price_asc' ? 'selected' : ''}>Precio: menor a mayor</option><option value="price_desc" ${busca.sort === 'price_desc' ? 'selected' : ''}>Precio: mayor a menor</option></select></form>
                ${busca.creator ? `<p class="sc-peq">Mostrando los de <b>@${esc(busca.creator)}</b> <button class="sc-link" data-a="quitar-creador">Ver todos</button></p>` : ''}`;
            return `<div class="sc-sub">Tienda de indicadores</div>${barra}${mensaje ? `<div class="sc-estado"><div class="sc-msg">${esc(mensaje)}</div></div>` : ''}${gan}${panelAdmin}
                ${tienda.length ? tienda.map((t) => {
                    const enGrafico = activos.has(t.id);
                    const accion = t.owned
                        ? `<button class="sc-b ${enGrafico ? '' : 'on'}" data-a="usar" data-id="${esc(t.id)}">${enGrafico ? 'Quitar' : 'Usar'}</button>`
                        : `<button class="sc-b on" data-a="comprar" data-id="${esc(t.id)}" ${compraEnCurso ? 'disabled' : ''}>Comprar ${esc(precioTxt(t))}</button>`;
                    return `<div class="sc-tienda"><div><b>${esc(t.name)}</b><span class="sc-peq"> · ${t.creator_username ? `<a class="sc-link" href="community.html?u=${encodeURIComponent(t.creator_username)}" title="Ver perfil">${esc(t.creator)}${t.creator_verified ? ' ✔' : ''} @${esc(t.creator_username)}</a> <button class="sc-link" data-a="por-creador" data-u="${esc(t.creator_username)}">sus indicadores</button>` : esc(t.creator)} · ${esc(precioTxt(t))} · ${t.open_source ? 'código abierto' : '🔒 protegido'}</span><p>${esc(t.description)}</p>
                        ${t.mine ? '<span class="sc-peq">Es tuyo</span>' : `<button class="sc-link" data-a="reportar" data-id="${esc(t.id)}">Reportar</button>`}</div>${t.mine ? '' : accion}</div>`;
                }).join('') : `<p class="sc-peq">${busca.q || busca.creator ? 'No encontramos indicadores con esa búsqueda.' : 'Todavía no hay indicadores publicados.'}</p>`}
                ${hayMas ? '<button class="sc-b" data-a="mas-tienda">Ver más</button>' : ''}
                <p class="sc-peq">Los indicadores de la tienda los publican otros usuarios y salen sin revisión previa. Úsalos bajo tu criterio; NLT no los garantiza ni son recomendación de inversión. Los de pago se cobran con tarjeta por Whop; el acceso se activa al confirmarse el pago y dura mientras la suscripción esté vigente (o para siempre si fue pago único). Si algo está mal, usa Reportar.</p>`;
        }
        function htmlEditor() {
            if (vista === 'tienda') return htmlTienda();
            if (sel && sel.ajeno) return htmlAjeno();
            return htmlEditorPropio();
        }
        function htmlEditorPropio() {
            if (!sel) {
                return `<div class="sc-vacio"><i class="ph ph-code"></i><p>Elige un script de la lista o crea uno nuevo.</p>
                    <p class="sc-peq">NLT Script se escribe parecido a Pine Script v5 (indentación en vez de llaves). Un indicador es un texto que calcula números con las velas y los dibuja en tu gráfico.</p>
                    <button class="sc-b on" data-a="nuevo">Nuevo script</button></div>`;
            }
            const enGrafico = !!(sel.id && activos.has(sel.id));
            const n = Math.max(1, sel.codigo.split('\n').length);
            const errs = erroresMostrados();
            return `<div class="sc-barra">
                    <input class="sc-nombre" maxlength="60" value="${esc(sel.nombre)}" aria-label="Nombre del script" data-a="nombre">
                    <button class="sc-b" data-a="guardar" ${sucio ? '' : 'disabled'}>Guardar</button>
                    <button class="sc-b ${enGrafico ? '' : 'on'}" data-a="grafico">${enGrafico ? 'Quitar del gráfico' : 'Añadir al gráfico'}</button>
                    <button class="sc-b mal" data-a="borrar" title="Borrar">${sel.id ? 'Borrar' : 'Descartar'}</button>
                </div>
                <div class="sc-cod"><pre class="sc-gut" aria-hidden="true">${Array.from({ length: n }, (_, i) => i + 1).join('\n')}</pre>
                    <div class="sc-edwrap"><pre class="sc-hl" aria-hidden="true"><code>${resaltar(sel.codigo, esc)}</code></pre>
                    <textarea class="sc-ta" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Código del script" data-a="codigo">${esc(sel.codigo)}</textarea></div></div>
                <div class="sc-estado ${errs.length ? 'mal' : 'ok'}" role="status">${errs.length
                    ? errs.map((e) => `<div class="sc-err"${e.linea ? ` data-linea="${e.linea}"` : ''}>${e.linea ? `<b>Línea ${e.linea}:</b> ` : ''}${esc(e.mensaje)}</div>`).join('')
                    : '<span>Sin errores de sintaxis.</span>'}${mensaje ? `<div class="sc-msg">${esc(mensaje)}</div>` : ''}</div>
                ${htmlAjustes()}${htmlCompartir()}`;
        }
        function pintar() {
            if (modal.hidden) return;
            const foco = document.activeElement, enTA = foco && foco.classList && foco.classList.contains('sc-ta');
            const ini = enTA ? foco.selectionStart : 0, fin = enTA ? foco.selectionEnd : 0, st = enTA ? foco.scrollTop : 0, sl = enTA ? foco.scrollLeft : 0;
            const enBq = foco && foco.classList && foco.classList.contains('sc-bq'), posBq = enBq ? foco.selectionStart : 0;
            let cuerpo;
            if (acceso === 'pronto') {
                cuerpo = '<div class="sc-lock"><i class="ph ph-hourglass"></i><h3>Casi listo</h3><p>Los scripts se están activando. Vuelve en unos minutos.</p></div>';
            } else if (acceso === null) {
                cuerpo = `<div class="sc-lock"><p>${esc(motivo || 'Cargando tus scripts…')}</p></div>`;
            } else {
                const puedeCrear = true;
                const ej = NLTCharts.nltsEjemplos.map((e, i) => `<option value="${i}">${esc(e.nombre)}</option>`).join('');
                const item = (s, ajeno) => `<button class="sc-item${vista === 'mis' && sel && sel.id === s.id && !!sel.ajeno === ajeno ? ' sel' : ''}" data-id="${esc(s.id)}" ${ajeno ? 'data-ajeno="1"' : ''}><span>${esc(s.name)}</span>${activos.has(s.id) ? '<em>en gráfico</em>' : ''}</button>`;
                cuerpo = `<div class="sc-cols"><aside class="sc-lista">
                        ${puedeCrear ? `<button class="sc-b on" data-a="nuevo" ${lista.length >= max ? 'disabled' : ''}>+ Nuevo script</button>
                        <select class="sc-ej" data-a="ejemplo" aria-label="Empezar desde un ejemplo"><option value="">Empezar desde un ejemplo…</option>${ej}</select>
                        <div class="sc-sub">Mis scripts</div><div class="sc-items">${lista.length ? lista.map((s) => item(s, false)).join('') : '<p class="sc-peq">Todavía no tienes scripts guardados.</p>'}</div>
                        <p class="sc-peq">${lista.length}/${max} scripts${tienePlan ? '' : ' · gratis'}</p>` : ''}
                        ${miUsuario ? `<a class="sc-link" href="community.html?u=${encodeURIComponent(miUsuario)}">Ver mi perfil público (@${esc(miUsuario)})</a>` : ''}
                        ${compartidos.length ? `<div class="sc-sub">Compartidos conmigo</div><div class="sc-items">${compartidos.map((s) => item(s, true)).join('')}</div>` : ''}
                        <button class="sc-b${vista === 'tienda' ? ' on' : ''}" data-a="tienda"><i class="ph ph-storefront"></i> Tienda de indicadores</button>
                        <details class="sc-ayuda"><summary>Guía rápida</summary><p class="sc-peq">Empieza con <code>indicator("Nombre", overlay=true)</code> (overlay = sobre las velas). Usa <code>close</code>, <code>high</code>, <code>low</code>, <code>open</code>, <code>volume</code>; funciones como <code>ta.sma</code>, <code>ta.ema</code>, <code>ta.rsi</code>, <code>ta.atr</code>, <code>ta.crossover</code>; dibuja con <code>plot</code>, <code>hline</code>, <code>bgcolor</code>, <code>plotshape</code>; los ajustes con <code>input.int</code>/<code>input.float</code>. Los bloques (<code>if</code>, <code>for</code>) se indentan con 4 espacios. <code>x[1]</code> es el valor de la vela anterior.</p></details>
                    </aside><section class="sc-ed">${htmlEditor()}</section></div>`;
            }
            modal.innerHTML = `<div class="sc-card"><header><h2><i class="ph ph-code"></i> NLT Script</h2><button class="sc-x" data-a="cerrar" aria-label="Cerrar">×</button></header>${cuerpo}
                <footer>Tus scripts corren solo en tu navegador, aislados. Informativos: no son recomendación de inversión.</footer></div>`;
            if (enBq) { const bq = modal.querySelector('.sc-bq'); if (bq) { bq.focus(); bq.setSelectionRange(posBq, posBq); } }
            const ta = modal.querySelector('.sc-ta');
            if (ta && enTA) { ta.focus(); ta.setSelectionRange(ini, fin); ta.scrollTop = st; ta.scrollLeft = sl; sincronizar(ta); }
        }
        function sincronizar(ta) {
            const hl = modal.querySelector('.sc-hl'), gut = modal.querySelector('.sc-gut');
            if (hl) { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; }
            if (gut) gut.scrollTop = ta.scrollTop;
        }
        function actualizarEditorLigero(ta) {
            // al teclear NO se repinta todo (perdería el cursor): solo resaltado, números de línea y estado
            const hl = modal.querySelector('.sc-hl code'), gut = modal.querySelector('.sc-gut');
            if (hl) hl.innerHTML = resaltar(sel.codigo, esc);
            if (gut) gut.textContent = Array.from({ length: Math.max(1, sel.codigo.split('\n').length) }, (_, i) => i + 1).join('\n');
            const g = modal.querySelector('[data-a="guardar"]'); if (g) g.disabled = !sucio;
            sincronizar(ta);
            clearTimeout(timerValida);
            timerValida = setTimeout(() => {
                validarVivo();
                const est = modal.querySelector('.sc-estado');
                if (est) {
                    const errs = erroresMostrados();
                    est.className = `sc-estado ${errs.length ? 'mal' : 'ok'}`;
                    est.innerHTML = errs.length ? errs.map((e) => `<div class="sc-err"${e.linea ? ` data-linea="${e.linea}"` : ''}>${e.linea ? `<b>Línea ${e.linea}:</b> ` : ''}${esc(e.mensaje)}</div>`).join('') : '<span>Sin errores de sintaxis.</span>';
                }
            }, 350);
        }

        modal.addEventListener('input', (e) => {
            const t = e.target;
            if (t.matches('.sc-ta')) { sel.codigo = t.value; sucio = true; mensaje = ''; sel.errorCorrida = null; actualizarEditorLigero(t); }
            else if (t.matches('.sc-nombre')) { sel.nombre = t.value; sucio = true; const g = modal.querySelector('[data-a="guardar"]'); if (g) g.disabled = false; }
        });
        modal.addEventListener('scroll', (e) => { if (e.target.matches && e.target.matches('.sc-ta')) sincronizar(e.target); }, true);
        modal.addEventListener('keydown', (e) => {
            const t = e.target;
            if (t.matches && t.matches('.sc-ta')) {
                if (e.key === 'Tab') {
                    e.preventDefault();
                    const a = t.selectionStart, b = t.selectionEnd;
                    t.setRangeText('    ', a, b, 'end'); sel.codigo = t.value; sucio = true; actualizarEditorLigero(t);
                } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); guardar(); }
            }
        });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) cerrar(); });
        modal.addEventListener('change', async (e) => {
            const t = e.target;
            if (t.matches('[data-a="ejemplo"]')) { const i = Number(t.value); if (Number.isInteger(i) && NLTCharts.nltsEjemplos[i]) nuevo(NLTCharts.nltsEjemplos[i]); return; }
            if (t.matches('[data-in]')) {
                const a = sel && sel.id && activos.get(sel.id);
                if (!a || !a.res) return;
                const inp = a.res.inputs[Number(t.dataset.in)];
                a.inputs = { ...a.inputs, [inp.id]: t.type === 'checkbox' ? t.checked : (inp.tipo === 'int' || inp.tipo === 'float') ? Number(t.value) : t.value };
                guardarActivos();
                await ponerEnGrafico(a);
                pintar();
            }
        });
        let timerBusca = null;
        modal.addEventListener('input', (e) => {
            if (!e.target.matches('.sc-bq')) return;
            clearTimeout(timerBusca);
            timerBusca = setTimeout(() => { busca.q = e.target.value.trim(); busca.creator = ''; recargarTienda(); }, 300);
        });
        modal.addEventListener('change', (e) => { if (e.target.matches('[data-a="buscar-tienda"] select')) { busca.sort = e.target.value; recargarTienda(); } });
        modal.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (e.target.dataset.a === 'buscar-tienda') { clearTimeout(timerBusca); busca.q = e.target.elements.q.value.trim(); busca.creator = ''; recargarTienda(); return; }
            const f = e.target;
            if (f.dataset.a === 'compartir') {
                const email = f.elements.email.value.trim();
                try { await NLT_API.chartsScriptDarAcceso(sel.id, email); mensaje = `Acceso dado a ${email}.`; await cargarAccesos(); } catch (er) { mensaje = er.message || 'No se pudo dar acceso.'; }
                pintar();
            } else if (f.dataset.a === 'publicar') {
                const modo = (e.submitter && e.submitter.dataset.modo) || 'abierto';
                const listar = modo !== 'quitar';
                const descripcion = f.elements.descripcion.value;
                const precio = modo === 'venta' && f.elements.precio.value ? Number(f.elements.precio.value) : null;
                if (modo === 'abierto' && sel.precio && !window.confirm('Al publicarlo gratis, su código quedará visible para todos (también para quienes ya lo compraron). ¿Continuar?')) return;
                try {
                    await NLT_API.chartsScriptPublicar(sel.id, listar, descripcion, precio, modo === 'venta' ? f.elements.facturacion.value : 'monthly');
                    sel.publicado = listar; sel.descripcion = descripcion; sel.precio = precio || ''; sel.facturacion = modo === 'venta' ? f.elements.facturacion.value : 'monthly';
                    mensaje = !listar ? 'Quitado de la tienda.' : precio ? 'A la venta en la tienda.' : 'Publicado gratis en la tienda.';
                    await cargarLista();
                } catch (er) { mensaje = er.message || 'No se pudo cambiar la publicación.'; }
                pintar();
            }
        });
        function copiarAjeno() {
            if (!sel || !sel.ajeno || !sel.codigo) return;
            let nombre = `${sel.nombre} (copia)`, k = 2;
            while (lista.some((x) => x.name === nombre)) nombre = `${sel.nombre} (copia ${k++})`;
            sel = { id: null, nombre, codigo: sel.codigo }; sucio = true; mensaje = 'Copia lista: guárdala para tenerla en tus scripts.'; vista = 'mis'; accesos = [];
            validarVivo(); pintar();
        }
        async function recargarTienda() { busca.page = 0; await cargarTienda(); pintar(); }
        async function comprar(id) {
            if (compraEnCurso) return;
            compraEnCurso = id; mensaje = 'Abriendo el pago…'; pintar();
            try { const r = await NLT_API.chartsScriptComprar(id); window.location.assign(r.checkout_url); return; }
            catch (er) { mensaje = er.message || 'No se pudo abrir el pago.'; compraEnCurso = null; }
            pintar();
        }
        async function reportar(id) {
            const motivo = window.prompt('¿Qué pasa con este indicador? (se envía al equipo de NLT)');
            if (!motivo || motivo.trim().length < 3) return;
            try { await NLT_API.chartsScriptReportar(id, motivo.trim()); mensaje = 'Gracias, lo revisaremos.'; } catch (er) { mensaje = er.message || 'No se pudo enviar el reporte.'; }
            pintar();
        }
        async function admPagado(v) {
            if (!window.confirm('¿Marcar como pagadas todas las ventas pendientes de este creador?')) return;
            try { const r = await NLT_API.chartsScriptAdminPagado(v); mensaje = `Marcadas ${r.marked} ventas como pagadas.`; admin = await NLT_API.chartsScriptAdmin(); } catch (er) { mensaje = er.message || 'No se pudo marcar.'; }
            pintar();
        }
        async function admBloquear(id, b) {
            try { await NLT_API.chartsScriptAdminBloquear(id, b); mensaje = b ? 'Indicador bloqueado.' : 'Indicador desbloqueado.'; admin = await NLT_API.chartsScriptAdmin(); await cargarTienda(); } catch (er) { mensaje = er.message || 'No se pudo cambiar.'; }
            pintar();
        }
        async function revocar(gid) {
            try { await NLT_API.chartsScriptQuitarAcceso(sel.id, gid); mensaje = 'Acceso quitado.'; await cargarAccesos(); } catch (er) { mensaje = er.message || 'No se pudo quitar.'; }
            pintar();
        }
        async function usarDeTienda(id) {
            if (activos.has(id)) { desactivar(id); pintar(); return; }
            try {
                const r = await NLT_API.chartsScriptCompartido(id);
                const ok = await activar(id, r.script.name, r.script.code, undefined, r.script.ast);
                const a = activos.get(id);
                if (!ok) { mensaje = (a && a.errores && a.errores[0] && a.errores[0].mensaje) || 'Ese indicador no se pudo calcular.'; activos.delete(id); guardarActivos(); } else mensaje = '';
            } catch (er) { mensaje = er.message || 'No se pudo usar este indicador.'; }
            pintar();
        }
        async function alternarAjeno() {
            if (!sel || !sel.ajeno) return;
            if (activos.has(sel.id)) { desactivar(sel.id); mensaje = 'Quitado del gráfico.'; }
            else {
                const ok = await activar(sel.id, sel.nombre, sel.codigo, undefined, sel.ast);
                const a = activos.get(sel.id);
                if (ok) mensaje = 'Añadido al gráfico.'; else { sel.errorCorrida = a ? a.errores : []; activos.delete(sel.id); guardarActivos(); mensaje = ''; }
            }
            pintar();
        }
        modal.addEventListener('click', (e) => {
            if (e.target === modal) { cerrar(); return; }
            const err = e.target.closest('.sc-err[data-linea]');
            if (err) {
                const ta = modal.querySelector('.sc-ta'); if (!ta) return;
                const ln = Number(err.dataset.linea), lineas = ta.value.split('\n');
                const ini = lineas.slice(0, ln - 1).reduce((s, x) => s + x.length + 1, 0);
                ta.focus(); ta.setSelectionRange(ini, ini + (lineas[ln - 1] || '').length); ta.scrollTop = Math.max(0, (ln - 3) * 19); sincronizar(ta);
                return;
            }
            const item = e.target.closest('.sc-item');
            if (item) { if (item.dataset.ajeno) abrirAjeno(item.dataset.id); else abrirScript(item.dataset.id); return; }
            const acc = e.target.closest('[data-a]');
            if (!acc) return;
            const a = acc.dataset.a;
            if (a === 'cerrar') cerrar();
            else if (a === 'nuevo') nuevo();
            else if (a === 'guardar') guardar();
            else if (a === 'grafico') alternarEnGrafico();
            else if (a === 'borrar') borrar();
            else if (a === 'tienda') { vista = 'tienda'; mensaje = ''; pintar(); cargarTienda().then(pintar); }
            else if (a === 'usar') usarDeTienda(acc.dataset.id);
            else if (a === 'comprar') comprar(acc.dataset.id);
            else if (a === 'copiar-ajeno') copiarAjeno();
            else if (a === 'por-creador') { busca = { q: '', sort: busca.sort, creator: acc.dataset.u, page: 0 }; recargarTienda(); }
            else if (a === 'quitar-creador') { busca.creator = ''; busca.page = 0; recargarTienda(); }
            else if (a === 'mas-tienda') { busca.page += 1; cargarTienda().then(pintar); }
            else if (a === 'reportar') reportar(acc.dataset.id);
            else if (a === 'adm-pagado') admPagado(acc.dataset.v);
            else if (a === 'adm-bloquear') admBloquear(acc.dataset.id, acc.dataset.b === '1');
            else if (a === 'grafico-ajeno') alternarAjeno();
            else if (a === 'revocar') revocar(acc.dataset.gid);
        });

        async function abrir() {
            document.querySelectorAll('.mc-menu').forEach((m) => { m.hidden = true; });
            modal.hidden = false; document.body.classList.add('sc-abierto');
            pintar();
            await cargarLista(); pintar();
        }
        function cerrar() {
            if (sucio && !window.confirm('Tienes cambios sin guardar. ¿Cerrar de todos modos?')) return;
            modal.hidden = true; document.body.classList.remove('sc-abierto');
        }
        btn.addEventListener('click', (e) => { e.stopPropagation(); if (modal.hidden) abrir(); else cerrar(); });
        const ancla = document.getElementById('chBtnConfig');
        if (ancla) ancla.before(btn);

        // Enlace directo a la tienda (?tienda=@creador o ?tienda=texto): lo usan los perfiles de Community
        (async function irATienda() {
            const q = new URLSearchParams(window.location.search), t = q.get('tienda');
            if (!t) return;
            try { q.delete('tienda'); history.replaceState(null, '', window.location.pathname + (q.toString() ? '?' + q : '')); } catch (_) { /* nada */ }
            if (t.startsWith('@')) busca = { q: '', sort: 'recent', creator: t.slice(1).toLowerCase(), page: 0 }; else busca = { q: t.slice(0, 40), sort: 'recent', creator: '', page: 0 };
            await abrir(); vista = 'tienda'; await cargarTienda(); pintar();
        })();

        // Volviendo del pago: abrir la tienda y esperar a que el aviso de Whop active el acceso (puede tardar unos segundos)
        (async function volverDelPago() {
            const q = new URLSearchParams(window.location.search), id = q.get('script_compra');
            if (!id) return;
            try { q.delete('script_compra'); history.replaceState(null, '', window.location.pathname + (q.toString() ? '?' + q : '')); } catch (_) { /* nada */ }
            await abrir(); vista = 'tienda'; mensaje = 'Confirmando tu pago…'; pintar();
            for (let i = 0; i < 12; i++) {
                await cargarLista(); await cargarTienda();
                if (tienda.some((t) => t.id === id && t.owned)) { mensaje = '¡Listo! Ya tienes el indicador: pulsa Usar.'; pintar(); return; }
                pintar(); await new Promise((r) => setTimeout(r, 4000));
            }
            mensaje = 'El pago aún no se confirma. Si ya pagaste, en unos minutos aparecerá aquí.'; pintar();
        })();

        // Al volver a abrir el gráfico, los scripts que dejaste puestos se vuelven a poner (si el plan sigue activo).
        (async function restaurar() {
            const guardados = state.prefs().scriptsActivos;
            if (!guardados || !Object.keys(guardados).length) return;
            await cargarLista();
            for (const id of Object.keys(guardados)) {
                try {
                    // propio (si el plan sigue activo) o compartido / de la tienda (no exige plan)
                    const propio = lista.some((x) => x.id === id);
                    const r = propio ? await NLT_API.chartsScript(id) : await NLT_API.chartsScriptCompartido(id);
                    await activar(id, r.script.name, r.script.code, (guardados[id] && guardados[id].inputs) || {}, r.script.ast);
                } catch (_) { /* si falla uno (ya no tiene acceso, lo borraron), los demás siguen */ }
            }
        })();

        return { abrir, activos: () => [...activos.keys()], correr: (cod, velas, inp, ast) => ejecutor.correr(cod, velas, inp, ast) };
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.scripts = { montar, resaltar, velasDe };
})();
