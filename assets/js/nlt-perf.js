/* NLT Perf -- rendimiento adaptativo por dispositivo. Va PRIMERO en el <head> (síncrono y mínimo) para que el nivel ya esté puesto
 * antes del primer dibujo; las reglas viven en nlt-perf.css según <html data-perf="alto|medio|bajo">.
 *
 *   alto   todo el brillo: desenfoques de cristal, sombras, animaciones.
 *   medio  se quitan los costos que más pesan en Safari y en equipos justos (desenfoque de fondo `backdrop-filter`, fondo `fixed`,
 *          resplandores con blur): la página se ve igual de bien, pero ya no repinta la pantalla en cada scroll.
 *   bajo   además sin animaciones decorativas ni sombras grandes (equipos con 2 GB, ahorro de datos, movimiento reducido).
 *
 * El nivel sale de: el navegador (Safari/WebKit), núcleos y memoria del equipo, ahorro de datos, y lo que se MIDE en uso real: si
 * al mover/desplazar la pantalla los cuadros tardan de más varias veces, baja un nivel y se acuerda en este dispositivo.
 * Forzar a mano (soporte): localStorage.nlt_perf_forzar = 'alto' | 'medio' | 'bajo' (y 'auto' para volver). Sin red, sin datos de nadie. */
(function () {
    'use strict';
    var d = document.documentElement, W = window;
    var ORDEN = ['alto', 'medio', 'bajo'];
    function leer(k) { try { return W.localStorage.getItem(k); } catch (_) { return null; } }
    function guardar(k, v) { try { W.localStorage.setItem(k, v); } catch (_) { /* sin almacenamiento */ } }

    var ua = (navigator.userAgent || '');
    var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    // En iOS todos los navegadores usan WebKit; en el resto, Safari es el que no dice Chrome/Edge/Firefox/Opera/Android.
    var safari = ios || (/Safari\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android/.test(ua));
    var nucleos = navigator.hardwareConcurrency || 4;
    var memoria = navigator.deviceMemory || 0;           // solo Chromium la informa
    var con = navigator.connection || {};
    var ahorro = !!con.saveData;
    var reducido = false;
    try { reducido = W.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { /* nada */ }

    function porEquipo() {
        var n = 0;                                       // 0 alto, 1 medio, 2 bajo
        if (safari) n = Math.max(n, 1);
        if (nucleos <= 4 || (memoria && memoria <= 4)) n = Math.max(n, 1);
        if (nucleos <= 2 || (memoria && memoria <= 2) || ahorro || reducido) n = 2;
        return n;
    }
    function aprendido() {
        try {
            var o = JSON.parse(leer('nlt_perf_nivel') || 'null');
            if (o && ORDEN.indexOf(o.n) >= 0 && Date.now() - o.t < 14 * 864e5) return ORDEN.indexOf(o.n);
        } catch (_) { /* nada */ }
        return 0;
    }
    var forzado = leer('nlt_perf_forzar');
    var nivel = ORDEN.indexOf(forzado) >= 0 ? ORDEN.indexOf(forzado) : Math.max(porEquipo(), aprendido());

    var oyentes = [];
    function poner(n) {
        nivel = Math.max(0, Math.min(2, n));
        d.setAttribute('data-perf', ORDEN[nivel]);
        d.classList.toggle('es-safari', safari);
        oyentes.forEach(function (f) { try { f(ORDEN[nivel]); } catch (_) { /* nada */ } });
    }
    poner(nivel);

    // Transiciones entre páginas (View Transitions): bonitas, pero en WebKit y equipos justos retrasan cada navegación.
    if (nivel === 0 && !safari) {
        var s = document.createElement('style'); s.id = 'nlt-vt'; s.textContent = '@view-transition { navigation: auto; }';
        (document.head || d).appendChild(s);
    }

    // crypto.randomUUID falta en Safari < 15.4 y en páginas sin https: sin esto, el chat/DM fallaba al enviar.
    try {
        if (W.crypto && !W.crypto.randomUUID) {
            W.crypto.randomUUID = function () {
                return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, function (c) { return (c ^ (W.crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16); });
            };
        }
    } catch (_) { /* sin crypto: no hay nada que hacer */ }

    // ── medición en uso real ──
    // Cuando la persona mueve o desplaza la pantalla se miden ~1,5 s de cuadros. Si dos ráfagas seguidas van lentas (el 20 % de los
    // cuadros pasa de 40 ms), se baja un nivel. Fuera de esas ráfagas no corre nada (no hay un bucle permanente).
    var rafagas = 0, lentas = 0, midiendo = false, ultimoInicio = 0;
    function rafaga() {
        if (midiendo || forzado && ORDEN.indexOf(forzado) >= 0 || nivel >= 2 || document.hidden || rafagas >= 8) return;
        var ahora = performance.now();
        if (ahora - ultimoInicio < 4000) return;
        midiendo = true; ultimoInicio = ahora; rafagas += 1;
        var t0 = ahora, prev = 0, cuadros = 0, malos = 0;
        (function paso(t) {
            if (prev) { cuadros += 1; if (t - prev > 40) malos += 1; }
            prev = t;
            if (t - t0 < 1500 && !document.hidden) { requestAnimationFrame(paso); return; }
            midiendo = false;
            if (cuadros < 20) return;                    // casi no hubo movimiento: no cuenta
            if (malos / cuadros > 0.2) {
                lentas += 1;
                if (lentas >= 2) { lentas = 0; poner(nivel + 1); guardar('nlt_perf_nivel', JSON.stringify({ n: ORDEN[nivel], t: Date.now() })); }
            } else { lentas = 0; }
        })(0);
    }
    var pasivo = { passive: true, capture: true };
    ['scroll', 'wheel', 'touchmove'].forEach(function (e) { W.addEventListener(e, rafaga, pasivo); });
    W.addEventListener('pointermove', function (e) { if (e.buttons) rafaga(); }, pasivo);

    W.NLTPerf = {
        nivel: function () { return ORDEN[nivel]; },
        esSafari: function () { return safari; },
        // Los módulos pesados (gráfico, animaciones propias) pueden adaptarse: alBajar(fn) se llama al cambiar de nivel.
        alCambiar: function (f) { if (typeof f === 'function') oyentes.push(f); },
        forzar: function (n) { if (ORDEN.indexOf(n) >= 0) { guardar('nlt_perf_forzar', n); poner(ORDEN.indexOf(n)); } else { try { W.localStorage.removeItem('nlt_perf_forzar'); } catch (_) {} } },
        info: function () { return { nivel: ORDEN[nivel], safari: safari, ios: ios, nucleos: nucleos, memoria: memoria, ahorro: ahorro, reducido: reducido }; },
    };
})();
