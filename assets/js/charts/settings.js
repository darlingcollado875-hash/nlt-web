/* NLT Charts -- configuración de indicadores al estilo TradingView.
 *
 * Cada indicador declara sus entradas igual que en Pine (tipo, título,
 * grupo, inline, valor por defecto, mín/máx, opciones, tooltip) y este
 * módulo arma el diálogo "Configuración": secciones por grupo, entradas en
 * línea, colores con opacidad, "Valores por defecto", Cancelar / Aceptar,
 * con vista previa en vivo.
 *
 * Los valores se guardan por usuario en este dispositivo: son preferencias
 * de dibujo, nunca permisos (el acceso PRO lo decide siempre el backend).
 *
 * Tipos: bool, int, float, string (con opciones), color, session, timeframe. */
(function () {
    const CLAVE = 'nlt_charts_ind_settings_v1';
    const esquemas = new Map();   // id -> { titulo, inputs }
    const vistaPrevia = new Map(); // id -> valores mientras el diálogo está abierto (sin guardar)
    let userId = 'anon';

    function leerTodo() {
        try { return JSON.parse(localStorage.getItem(`${CLAVE}:${userId}`) || '{}') || {}; } catch (_) { return {}; }
    }
    function guardarTodo(o) {
        try { localStorage.setItem(`${CLAVE}:${userId}`, JSON.stringify(o)); } catch (_) { /* sin almacenamiento */ }
    }

    function porDefecto(id) {
        const e = esquemas.get(id);
        const out = {};
        (e ? e.inputs : []).forEach((inp) => { out[inp.id] = clonar(inp.def); });
        return out;
    }
    const clonar = (v) => (v && typeof v === 'object' ? { ...v } : v);

    function valores(id) {
        if (vistaPrevia.has(id)) return { ...vistaPrevia.get(id) };
        const guardados = leerTodo()[id] || {};
        const out = porDefecto(id);
        const e = esquemas.get(id);
        (e ? e.inputs : []).forEach((inp) => {
            if (guardados[inp.id] !== undefined && valido(inp, guardados[inp.id])) out[inp.id] = guardados[inp.id];
        });
        return out;
    }

    // Un valor guardado que ya no es válido (cambió el esquema) vuelve al default.
    function valido(inp, v) {
        switch (inp.tipo) {
            case 'bool': return typeof v === 'boolean';
            case 'int': case 'float': return typeof v === 'number' && Number.isFinite(v);
            case 'string': case 'timeframe': return inp.opciones ? inp.opciones.some((o) => (o.v ?? o) === v) : typeof v === 'string';
            case 'color': return v && typeof v.hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.hex) && typeof v.t === 'number';
            case 'session': return /^\d{4}-\d{4}$/.test(v);
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

    function esc(t) { return NLTCharts.ui.esc(t); }

    function campoHTML(inp, v) {
        const tip = inp.tooltip ? ` title="${esc(inp.tooltip)}"` : '';
        const label = inp.titulo ? `<span class="cs-label"${tip}>${esc(inp.titulo)}${inp.tooltip ? ' <i class="ph ph-info"></i>' : ''}</span>` : '';
        const d = `data-in="${esc(inp.id)}"`;
        switch (inp.tipo) {
            case 'bool':
                return `<label class="cs-campo cs-bool"><input type="checkbox" ${d}${v ? ' checked' : ''}>${label}</label>`;
            case 'int': case 'float':
                return `<label class="cs-campo">${label}<input type="number" class="cs-num" ${d} value="${esc(v)}"${inp.min != null ? ` min="${inp.min}"` : ''}${inp.max != null ? ` max="${inp.max}"` : ''} step="${inp.step || (inp.tipo === 'int' ? 1 : 0.01)}"></label>`;
            case 'string': case 'timeframe':
                return `<label class="cs-campo">${label}<select class="cs-sel" ${d}>${inp.opciones.map((o) => {
                    const val = o.v ?? o, txt = o.t ?? o;
                    return `<option value="${esc(val)}"${val === v ? ' selected' : ''}>${esc(txt)}</option>`;
                }).join('')}</select></label>`;
            case 'session': {
                const [a, b] = String(v).split('-');
                const hhmm = (s) => `${s.slice(0, 2)}:${s.slice(2)}`;
                return `<label class="cs-campo">${label}<span class="cs-sesion"><input type="time" data-ses="a" ${d} value="${hhmm(a)}"> – <input type="time" data-ses="b" ${d} value="${hhmm(b)}"></span></label>`;
            }
            case 'color':
                return `<label class="cs-campo cs-color">${label}<span class="cs-color-in">
                    <input type="color" data-col="hex" ${d} value="${esc(v.hex)}">
                    <input type="range" data-col="op" ${d} min="0" max="100" value="${100 - v.t}" title="Opacidad">
                </span></label>`;
            default: return '';
        }
    }

    function render(id, vals) {
        const e = esquemas.get(id);
        const grupos = [];
        e.inputs.forEach((inp) => {
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

    /** abrir(id, alCambiar(vals)) -- vista previa en vivo; Cancelar revierte. */
    function abrir(id, alCambiar) {
        const e = esquemas.get(id);
        if (!e) return;
        cerrar();
        let vals = { ...valores(id) };
        const bg = document.createElement('div');
        bg.className = 'cs-bg';
        modal = document.createElement('div');
        modal.className = 'cs-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-label', `Configuración de ${e.titulo}`);
        modal.innerHTML = `
            <div class="cs-head"><p class="cs-titulo">${esc(e.titulo)}</p><button type="button" class="ch-tool" data-cs="x" aria-label="Cerrar"><i class="ph ph-x"></i></button></div>
            <div class="cs-tabs"><span class="cs-tab on">Entradas</span></div>
            <div class="cs-cuerpo"></div>
            <div class="cs-pie">
                <button type="button" class="ch-btn" data-cs="reset">Valores por defecto</button>
                <span style="flex:1"></span>
                <button type="button" class="ch-btn" data-cs="cancelar">Cancelar</button>
                <button type="button" class="ch-btn cs-ok" data-cs="ok">Aceptar</button>
            </div>`;
        const cuerpo = modal.querySelector('.cs-cuerpo');
        const pintar = () => { cuerpo.innerHTML = render(id, vals); };
        pintar();

        const aplicar = () => { vistaPrevia.set(id, { ...vals }); alCambiar && alCambiar({ ...vals }); };
        const soltar = () => { vistaPrevia.delete(id); alCambiar && alCambiar(valores(id)); };
        cuerpo.addEventListener('input', (ev) => {
            const el = ev.target.closest('[data-in]');
            if (!el) return;
            const inp = e.inputs.find((x) => x.id === el.dataset.in);
            vals[inp.id] = leerCampo(inp, el, vals[inp.id]);
            aplicar();
        });
        modal.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-cs]');
            if (!b) return;
            const acc = b.dataset.cs;
            if (acc === 'reset') { vals = porDefecto(id); pintar(); aplicar(); return; }
            if (acc === 'ok') { guardar(id, vals); soltar(); cerrar(); return; }
            // cancelar / cerrar: vuelve a como estaba
            soltar();
            cerrar();
        });
        bg.addEventListener('click', () => { soltar(); cerrar(); });
        document.body.appendChild(bg);
        document.body.appendChild(modal);
        modal._bg = bg;
    }

    function cerrar() {
        if (!modal) return;
        modal._bg && modal._bg.remove();
        modal.remove();
        modal = null;
    }

    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && modal) modal.querySelector('[data-cs="cancelar"]').click(); });

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.settings = {
        setUser(id) { userId = id || 'anon'; },
        registrar(id, esquema) { esquemas.set(id, esquema); },
        tiene(id) { return esquemas.has(id); },
        valores,
        guardar,
        abrir,
    };
})();
