/* NLT Charts -- estado del usuario en el navegador (símbolo, timeframe,
 * indicadores activos, dibujos).
 *
 * V1 guarda en localStorage: son preferencias de este dispositivo, no datos
 * de negocio. Los dibujos van por usuario y símbolo. Todo acceso va en
 * try/catch -- en modo privado o con el almacenamiento bloqueado el gráfico
 * funciona igual, solo no recuerda. Pasar a guardarlo en el backend (para
 * verlo en otro dispositivo) cambia solo este archivo. */
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

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.state = {
        setUser(id) { userId = id || 'anon'; },

        prefs() {
            return { symbol: 'XAUUSD', timeframe: '15m', indicators: ['VOL'], ...leer(PREFS, {}) };
        },
        savePrefs(parcial) {
            escribir(PREFS, { ...this.prefs(), ...parcial });
        },

        drawings(symbol) {
            const lista = leer(`${DIBUJOS}:${userId}:${symbol}`, []);
            return Array.isArray(lista) ? lista : [];
        },
        saveDrawings(symbol, lista) {
            escribir(`${DIBUJOS}:${userId}:${symbol}`, lista.slice(-MAX_DIBUJOS));
        },
    };
})();
