/* NLT Charts -- diálogo de configuración al estilo TradingView.
 *
 * Lo usan los indicadores (Entradas / Estilo / Visibilidad), los dibujos
 * (Estilo / Texto / Coordenadas) y la apariencia del gráfico. Cada entrada
 * declara: tipo, título, grupo, inline, tab, valor por defecto, mín/máx,
 * opciones, tooltip y `recalc` (false = cambio solo visual: quien llama
 * redibuja sin volver a calcular el indicador).
 *
 * Vista previa en vivo, "Valores por defecto", Cancelar (revierte) y
 * Aceptar (guarda). Los valores son preferencias de dibujo por usuario,
 * nunca permisos: el acceso PRO lo decide siempre el backend.
 *
 * Tipos: bool, int, float, string (opciones), color, session, timeframe,
 * texto. `etapa2: true` = entrada que existe en el producto de
 * TradingView pero todavía no en NLT Charts (se muestra deshabilitada). */
(function () {
    const CLAVE = 'nlt_charts_ind_settings_v1';
    const ORDEN_TABS = ['Entradas', 'Velas', 'Estilo', 'Texto', 'Coordenadas', 'Lienzo', 'Visibilidad'];
    const esquemas = new Map();   // id -> { titulo, inputs }
    const vistaPrevia = new Map(); // id -> valores mientras el diálogo está abierto (sin guardar)
    const oyentes = new Set();     // cambios guardados (persistencia en servidor, ver layout.js)
    let userId = 'anon';
    // valores() se consulta en cada frame de dibujo: memo en memoria, se invalida al cambiar algo
    const memo = new Map();
    let memoTodo = null;

    function leerTodo() {
        if (memoTodo) return memoTodo;
        try { memoTodo = JSON.parse(localStorage.getItem(`${CLAVE}:${userId}`) || '{}') || {}; } catch (_) { memoTodo = {}; }
        return memoTodo;
    }
    function guardarTodo(o) {
        memoTodo = o; memo.clear();
        try { localStorage.setItem(`${CLAVE}:${userId}`, JSON.stringify(o)); } catch (_) { /* sin almacenamiento */ }
        oyentes.forEach((f) => { try { f(); } catch (_) { /* nada */ } });
    }

    const clonar = (v) => (v && typeof v === 'object' ? { ...v } : v);
    function defaultsDe(inputs) {
        const out = {};
        inputs.forEach((inp) => { out[inp.id] = clonar(inp.def); });
        return out;
    }
    function porDefecto(id) {
        const e = esquemas.get(id);
        return defaultsDe(e ? e.inputs : []);
    }

    // Mezcla valores guardados con los defaults, descartando lo que ya no es válido.
    function mezclar(inputs, guardados) {
        const out = defaultsDe(inputs);
        inputs.forEach((inp) => {
            if (guardados && guardados[inp.id] !== undefined && valido(inp, guardados[inp.id])) out[inp.id] = clonar(guardados[inp.id]);
        });
        return out;
    }

    function valores(id) {
        if (vistaPrevia.has(id)) return vistaPrevia.get(id);
        if (memo.has(id)) return memo.get(id);
        const e = esquemas.get(id);
        const v = Object.freeze(mezclar(e ? e.inputs : [], leerTodo()[id] || {}));
        memo.set(id, v);
        return v;
    }

    function valido(inp, v) {
        switch (inp.tipo) {
            case 'bool': return typeof v === 'boolean';
            case 'int': case 'float': return typeof v === 'number' && Number.isFinite(v);
            case 'string': case 'timeframe': return inp.opciones ? inp.opciones.some((o) => (o.v ?? o) === v) : typeof v === 'string';
            case 'color': return !!v && typeof v.hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.hex) && typeof v.t === 'number';
            case 'session': return /^\d{4}-\d{4}$/.test(v);
            case 'texto': return typeof v === 'string' && v.length <= (inp.max || 500);
            default: return false;
        }
    }

    function guardar(id, vals) {
        const todo = leerTodo();
        todo[id] = vals;
        guardarTodo(todo);
    }

    // ------------------------------------------------------------ diálogo
    let modal = null;
    const esc = (t) => NLTCharts.ui.esc(t);

    function campoHTML(inp, v) {
        const tip = inp.tooltip ? ` title="${esc(inp.tooltip)}"` : '';
        const badge = inp.etapa2 ? ' <span class="cs-etapa2" title="Existe en el Zone Engine de TradingView; llega a NLT Charts en la etapa 2 del port">Etapa 2</span>' : '';
        const label = inp.titulo ? `<span class="cs-label"${tip}>${esc(inp.titulo)}${inp.tooltip ? ' <i class="ph ph-info"></i>' : ''}${badge}</span>` : '';
        const d = `data-in="${esc(inp.id)}"${inp.etapa2 ? ' disabled' : ''}`;
        const cls = inp.etapa2 ? ' cs-off' : '';
        switch (inp.tipo) {
            case 'bool':
                return `<label class="cs-campo cs-bool${cls}"><input type="checkbox" ${d}${v ? ' checked' : ''}>${label}</label>`;
            case 'int': case 'float':
                return `<label class="cs-campo${cls}">${label}<input type="number" class="cs-num" ${d} value="${esc(v)}"${inp.min != null ? ` min="${inp.min}"` : ''}${inp.max != null ? ` max="${inp.max}"` : ''} step="${inp.step || (inp.tipo === 'int' ? 1 : 0.01)}"></label>`;
            case 'string': case 'timeframe':
                return `<label class="cs-campo${cls}">${label}<select class="cs-sel" ${d}>${inp.opciones.map((o) => {
                    const val = o.v ?? o, txt = o.t ?? o;
                    return `<option value="${esc(val)}"${val === v ? ' selected' : ''}>${esc(txt)}</option>`;
                }).join('')}</select></label>`;
            case 'session': {
                const [a, b] = String(v).split('-');
                const hhmm = (s) => `${s.slice(0, 2)}:${s.slice(2)}`;
                return `<label class="cs-campo${cls}">${label}<span class="cs-sesion"><input type="time" data-ses="a" ${d} value="${hhmm(a)}"> – <input type="time" data-ses="b" ${d} value="${hhmm(b)}"></span></label>`;
            }
            case 'color':
                return `<label class="cs-campo cs-color${cls}">${label}<span class="cs-color-in">
                    <input type="color" data-col="hex" ${d} value="${esc(v.hex)}">
                    <input type="range" data-col="op" ${d} min="0" max="100" value="${100 - v.t}" title="Opacidad">
                </span></label>`;
            case 'texto':
                return inp.multilinea
                    ? `<label class="cs-campo cs-col${cls}">${label}<textarea class="cs-texto" rows="3" maxlength="${inp.max || 500}" ${d}>${esc(v)}</textarea></label>`
                    : `<label class="cs-campo${cls}">${label}<input type="text" class="cs-texto" maxlength="${inp.max || 500}" ${d} value="${esc(v)}"></label>`;
            default: return '';
        }
    }

    function renderTab(inputs, vals, tab) {
        const grupos = [];
        inputs.filter((inp) => (inp.tab || 'Entradas') === tab).forEach((inp) => {
            let g = grupos.find((x) => x.nombre === (inp.grupo || ''));
            if (!g) { g = { nombre: inp.grupo || '', filas: [] }; grupos.push(g); }
            const ult = g.filas[g.filas.length - 1];
            if (inp.inline && ult && ult.inline === inp.inline) ult.items.push(inp);
            else g.filas.push({ inline: inp.inline, items: [inp] });
        });
        return grupos.map((g) => `
            <div class="cs-grupo">
                ${g.nombre ? `<p class="cs-grupo-t">${esc(g.nombre)}</p>` : ''}
                ${g.filas.map((f) => `<div class="cs-fila${f.items.length > 1 ? ' cs-inline' : ''}">${f.items.map((inp) => campoHTML(inp, vals[inp.id])).join('')}</div>`).join('')}
            </div>`).join('');
    }

    function leerCampo(inp, el, actual) {
        if (inp.tipo === 'bool') return el.checked;
        if (inp.tipo === 'int' || inp.tipo === 'float') {
            let n = inp.tipo === 'int' ? parseInt(el.value, 10) : parseFloat(el.value);
            if (!Number.isFinite(n)) return actual;
            if (inp.min != null) n = Math.max(inp.min, n);
            if (inp.max != null) n = Math.min(inp.max, n);
            return n;
        }
        if (inp.tipo === 'color') {
            const c = { ...actual };
            if (el.dataset.col === 'hex') c.hex = el.value.toUpperCase();
            else c.t = 100 - parseInt(el.value, 10);
            return c;
        }
        if (inp.tipo === 'session') {
            const [a, b] = String(actual).split('-');
            const hhmm = el.value.replace(':', '');
            return el.dataset.ses === 'a' ? `${hhmm}-${b}` : `${a}-${hhmm}`;
        }
        return el.value;
    }

    /**
     * abrirDialogo({ titulo, inputs, valores, alCambiar(vals, cambiados), alAceptar(vals), alCancelar(),
     *                botones: [{ id, texto, accion(vals) }], tab })
     * `cambiados` = ids de las entradas que cambiaron en este evento (para
     * distinguir cambios visuales de los que exigen recalcular).
     */
    function abrirDialogo(o) {
        cerrar();
        const inputs = o.inputs;
        let vals = mezclar(inputs, o.valores || {});
        const tabs = ORDEN_TABS.filter((t) => inputs.some((inp) => (inp.tab || 'Entradas') === t));
        let tab = o.tab && tabs.includes(o.tab) ? o.tab : tabs[0];
        const bg = document.createElement('div');
        bg.className = 'cs-bg';
        modal = document.createElement('div');
        modal.className = 'cs-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-label', `Configuración de ${o.titulo}`);
        modal.innerHTML = `
            <div class="cs-head"><p class="cs-titulo">${esc(o.titulo)}</p><button type="button" class="ch-tool" data-cs="x" aria-label="Cerrar"><i class="ph ph-x"></i></button></div>
            <div class="cs-tabs">${tabs.map((t) => `<button type="button" class="cs-tab${t === tab ? ' on' : ''}" data-tab="${esc(t)}">${esc(t)}</button>`).join('')}</div>
            <div class="cs-cuerpo"></div>
            <div class="cs-pie">
                <select class="cs-sel cs-plantilla" data-cs-menu aria-label="Valores">
                    <option value="">Valores…</option>
                    <option value="reset">Valores por defecto</option>
                    ${(o.botones || []).map((bt) => `<option value="${esc(bt.id)}">${esc(bt.texto)}</option>`).join('')}
                </select>
                <span style="flex:1"></span>
                <button type="button" class="ch-btn" data-cs="cancelar">Cancelar</button>
                <button type="button" class="ch-btn cs-ok" data-cs="ok">Aceptar</button>
            </div>`;
        const cuerpo = modal.querySelector('.cs-cuerpo');
        const pintar = () => { cuerpo.innerHTML = renderTab(inputs, vals, tab); };
        pintar();

        cuerpo.addEventListener('input', (ev) => {
            const el = ev.target.closest('[data-in]');
            if (!el) return;
            const inp = inputs.find((x) => x.id === el.dataset.in);
            vals[inp.id] = leerCampo(inp, el, vals[inp.id]);
            o.alCambiar && o.alCambiar({ ...vals }, [inp.id]);
        });
        modal.querySelector('.cs-tabs').addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-tab]');
            if (!b) return;
            tab = b.dataset.tab;
            modal.querySelectorAll('.cs-tab').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
            pintar();
        });
        modal.querySelector('[data-cs-menu]').addEventListener('change', (ev) => {
            const acc = ev.target.value;
            ev.target.value = '';
            if (acc === 'reset') {
                vals = defaultsDe(inputs);
                pintar();
                o.alCambiar && o.alCambiar({ ...vals }, inputs.map((x) => x.id));
                return;
            }
            const bt = (o.botones || []).find((x) => x.id === acc);
            if (bt) bt.accion({ ...vals });
        });
        const cancelar = () => { cerrar(); o.alCancelar && o.alCancelar(); };
        modal.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-cs]');
            if (!b) return;
            if (b.dataset.cs === 'ok') { cerrar(); o.alAceptar && o.alAceptar({ ...vals }); return; }
            cancelar();
        });
        bg.addEventListener('click', cancelar);
        document.body.appendChild(bg);
        document.body.appendChild(modal);
        modal._bg = bg;
        modal._cancelar = cancelar;
    }

    /** abrir(id, alCambiar(vals, cambiados)) -- indicador registrado: vista previa; Aceptar guarda. */
    function abrir(id, alCambiar, opciones = {}) {
        const e = esquemas.get(id);
        if (!e) return;
        const original = valores(id);
        abrirDialogo({
            titulo: e.titulo,
            inputs: e.inputs,
            valores: original,
            tab: opciones.tab,
            botones: opciones.botones,
            alCambiar: (vals, cambiados) => { vistaPrevia.set(id, Object.freeze({ ...vals })); alCambiar && alCambiar(vals, cambiados); },
            alAceptar: (vals) => { vistaPrevia.delete(id); guardar(id, vals); alCambiar && alCambiar(valores(id), []); },
            alCancelar: () => {
                const tenia = vistaPrevia.has(id);
                const previa = vistaPrevia.get(id);
                vistaPrevia.delete(id);
                // solo se revierte si hubo vista previa; los ids que difieren deciden si hay que recalcular
                if (tenia) alCambiar && alCambiar(valores(id), Object.keys(previa).filter((k) => JSON.stringify(previa[k]) !== JSON.stringify(original[k])));
            },
        });
    }

    function cerrar() {
        if (!modal) return;
        modal._bg && modal._bg.remove();
        modal.remove();
        modal = null;
    }

    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && modal) modal._cancelar(); });

    // ¿Algún id de `cambiados` exige recalcular? (entradas con recalc === false son solo visuales)
    function exigeRecalculo(id, cambiados) {
        const e = esquemas.get(id);
        if (!e || !cambiados) return true;
        return cambiados.some((c) => { const inp = e.inputs.find((x) => x.id === c); return !inp || inp.recalc !== false; });
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.settings = {
        setUser(id) { userId = id || 'anon'; memoTodo = null; memo.clear(); },
        registrar(id, esquema) { esquemas.set(id, esquema); memo.delete(id); },
        esquema(id) { return esquemas.get(id); },
        tiene(id) { return esquemas.has(id); },
        valores,
        mezclar,
        guardar,
        abrir,
        abrirDialogo,
        exigeRecalculo,
        todo: leerTodo,
        reemplazarTodo(o) { guardarTodo(o || {}); },
        alGuardar(f) { oyentes.add(f); },
    };
})();
