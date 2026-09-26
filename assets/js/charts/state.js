/* NLT Charts -- estado del usuario en el navegador (símbolo, timeframe,
 * indicadores activos, watchlist, paneles, dibujos).
 *
 * localStorage es la copia rápida de este dispositivo; layout.js la sincroniza
 * con la cuenta (/charts/layout) para verla igual en otro dispositivo. Todo
 * acceso va en try/catch -- en modo privado o con el almacenamiento bloqueado
 * el gráfico funciona igual, solo no recuerda. Son preferencias de dibujo,
 * nunca permisos. Los dibujos van por usuario y símbolo. */
(function () {
    const PREFS = 'nlt_charts_prefs_v1';
    const DIBUJOS = 'nlt_charts_drawings_v1';
    const MAX_DIBUJOS = 300; // por símbolo: techo para no llenar el almacenamiento

    function leer(clave, porDefecto) {
        try {
            const v = localStorage.getItem(clave);
            return v ? JSON.parse(v) : porDefecto;
        } catch (_) {
            return porDefecto;
        }
    }

    function escribir(clave, valor) {
        try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (_) { /* sin almacenamiento */ }
    }

    let userId = 'anon';
    const oyentes = new Set();   // layout.js: algo cambió -> sincronizar
    const avisar = () => oyentes.forEach((f) => { try { f(); } catch (_) { /* nada */ } });
    const clavePrefs = () => `${PREFS}:${userId}`;
    const prefijoDibujos = () => `${DIBUJOS}:${userId}:`;

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.state = {
        setUser(id) {
            userId = id || 'anon';
            // Antes las preferencias no iban por usuario: se migran una vez.
            try {
                if (localStorage.getItem(clavePrefs()) === null && localStorage.getItem(PREFS) !== null) {
                    localStorage.setItem(clavePrefs(), localStorage.getItem(PREFS));
                    localStorage.removeItem(PREFS);
                }
            } catch (_) { /* sin almacenamiento */ }
        },

        prefs() {
            return { symbol: 'XAUUSD', timeframe: '15m', indicators: ['NLT_UNIFIED'], ...leer(clavePrefs(), {}) };
        },
        savePrefs(parcial) {
            escribir(clavePrefs(), { ...this.prefs(), ...parcial });
            avisar();
        },

        drawings(symbol) {
            const lista = leer(`${prefijoDibujos()}${symbol}`, []);
            return Array.isArray(lista) ? lista : [];
        },
        saveDrawings(symbol, lista) {
            escribir(`${prefijoDibujos()}${symbol}`, lista.slice(-MAX_DIBUJOS));
            avisar();
        },

        // ---- para layout.js (copia completa y reemplazo) ----
        alCambiar(f) { oyentes.add(f); },
        todasLasPrefs() { return leer(clavePrefs(), {}); },
        todosLosDibujos() {
            const out = {};
            try {
                for (let k = 0; k < localStorage.length; k++) {
                    const clave = localStorage.key(k);
                    if (clave && clave.startsWith(prefijoDibujos())) {
                        const lista = leer(clave, []);
                        if (Array.isArray(lista) && lista.length) out[clave.slice(prefijoDibujos().length)] = lista;
                    }
                }
            } catch (_) { /* sin almacenamiento */ }
            return out;
        },
        // Reemplaza lo local por lo de la cuenta (sin avisar: no es un cambio del usuario).
        reemplazar({ prefs, drawings }) {
            if (prefs && typeof prefs === 'object') escribir(clavePrefs(), prefs);
            if (drawings && typeof drawings === 'object') {
                try {
                    const borrar = [];
                    for (let k = 0; k < localStorage.length; k++) {
                        const clave = localStorage.key(k);
                        if (clave && clave.startsWith(prefijoDibujos()) && !(clave.slice(prefijoDibujos().length) in drawings)) borrar.push(clave);
                    }
                    borrar.forEach((c) => localStorage.removeItem(c));
                } catch (_) { /* sin almacenamiento */ }
                Object.entries(drawings).forEach(([sym, lista]) => { if (Array.isArray(lista)) escribir(`${prefijoDibujos()}${sym}`, lista.slice(-MAX_DIBUJOS)); });
            }
        },
    };
})();
