/* NLT Charts -- sincroniza las preferencias del gráfico con la cuenta.
 *
 * Qué viaja: prefs (símbolo, temporalidad, indicadores activos/ocultos/
 * favoritos, watchlist, paneles), settings (configuración de cada indicador,
 * colores de velas, estilos por defecto de las herramientas) y dibujos por
 * símbolo. Un solo JSON por usuario en /charts/layout.
 *
 * localStorage sigue siendo la copia rápida: el gráfico arranca con ella y
 * funciona igual sin red o si el backend todavía no tiene la tabla (503). Al
 * abrir se trae la versión de la cuenta; gana la más reciente (esta
 * pestaña con cambios sin subir vs. lo guardado desde otro dispositivo). Los
 * cambios se suben agrupados (2 s) y al ocultar la pestaña. Nunca contiene
 * permisos: el acceso PRO lo decide el backend. */
(function () {
    const VERSION = 1;
    const ESPERA_MS = 2000;
    const META = 'nlt_charts_layout_meta_v1';
    let userId = 'anon';
    let estado = 'local';       // 'local' (sin cuenta), 'sincronizado', 'no-disponible'
    let importando = false;
    let timer = null;
    let subiendo = null;

    const claveMeta = () => `${META}:${userId}`;
    function leerMeta() {
        try { return JSON.parse(localStorage.getItem(claveMeta()) || 'null') || {}; } catch (_) { return {}; }
    }
    function guardarMeta(m) {
        try { localStorage.setItem(claveMeta(), JSON.stringify({ ...leerMeta(), ...m })); } catch (_) { /* sin almacenamiento */ }
    }

    function exportar() {
        const { state, settings } = NLTCharts;
        return { v: VERSION, prefs: state.todasLasPrefs(), settings: settings.todo(), drawings: state.todosLosDibujos() };
    }
    function importar(layout) {
        if (!layout || typeof layout !== 'object' || layout.v !== VERSION) return false;
        importando = true;
        try {
            NLTCharts.state.reemplazar({ prefs: layout.prefs, drawings: layout.drawings });
            // cada valor se vuelve a validar contra su esquema al leerlo (settings.mezclar)
            if (layout.settings && typeof layout.settings === 'object') NLTCharts.settings.reemplazarTodo(layout.settings);
        } finally { importando = false; }
        return true;
    }

    // Cambio local: queda marcado (por si se cierra antes de subir) y se sube agrupado.
    function marcarCambio() {
        if (importando) return;
        guardarMeta({ sucio: true, cambioLocal: Date.now() });
        if (estado !== 'sincronizado') return;
        clearTimeout(timer);
        timer = setTimeout(subir, ESPERA_MS);
    }

    async function subir() {
        clearTimeout(timer);
        if (estado !== 'sincronizado' || !leerMeta().sucio) return;
        if (subiendo) { await subiendo; if (leerMeta().sucio) timer = setTimeout(subir, ESPERA_MS); return; }
        const marca = leerMeta().cambioLocal;
        subiendo = (async () => {
            try {
                const r = await NLT_API.chartsGuardarLayout(exportar());
                // si hubo otro cambio mientras subía, sigue sucio
                guardarMeta({ base: r.updated_at, sucio: leerMeta().cambioLocal !== marca });
            } catch (err) {
                if (err.status === 503) estado = 'no-disponible';
                // 413 (demasiado grande) u otros: queda en este dispositivo y se reintenta con el próximo cambio
                if (NLTCharts.diag && NLTCharts.diag.nota) NLTCharts.diag.nota(`layout: ${err.message}`);
            } finally { subiendo = null; }
        })();
        return subiendo;
    }

    /**
     * cargar({ timeoutMs }) -- antes de leer las preferencias al arrancar.
     * Nunca lanza: sin cuenta disponible sigue con lo local.
     */
    async function cargar({ timeoutMs = 2500 } = {}) {
        const pedido = NLT_API.chartsLayout();
        let r;
        try {
            r = await Promise.race([pedido, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { status: 0 })), timeoutMs))]);
        } catch (err) {
            // 503 = la tabla todavía no existe: solo local. Timeout o red: solo local en esta sesión
            // (no se sube nada para no pisar la cuenta con datos viejos).
            estado = err.status === 503 ? 'no-disponible' : 'local';
            return { estado, origen: 'local' };
        }
        estado = 'sincronizado';
        const meta = leerMeta();
        let origen = 'local';
        if (r && r.layout) {
            const servidor = Date.parse(r.updated_at) || 0;
            const localMasNuevo = meta.sucio && (meta.cambioLocal || 0) > servidor;
            if (!localMasNuevo && importar(r.layout)) {
                origen = 'cuenta';
                guardarMeta({ base: r.updated_at, sucio: false });
            } else {
                guardarMeta({ sucio: true });
            }
        } else {
            guardarMeta({ sucio: true });   // la cuenta no tiene nada: se sube lo de este dispositivo
        }
        if (leerMeta().sucio) timer = setTimeout(subir, ESPERA_MS);
        return { estado, origen };
    }

    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') subir(); });

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.layout = {
        setUser(id) {
            userId = id || 'anon';
            NLTCharts.state.alCambiar(marcarCambio);
            NLTCharts.settings.alGuardar(marcarCambio);
        },
        cargar,
        subir,
        exportar,
        estado: () => estado,
    };
})();
