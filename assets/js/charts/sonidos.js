/* Sonidos de NLT Charts — sintetizados con Web Audio (sin archivos): nada que descargar, arrancan al instante y suenan igual en
 * cualquier dispositivo. Identidad NLT: tonos de cristal / sintetizador limpio, escala de La (A) y un eco corto tipo "espacio".
 *   abrir      posición abierta (arpegio ascendente + golpe grave suave)
 *   pendiente  orden pendiente puesta (dos "pings" de cristal)
 *   cerrar     posición cerrada (resolución descendente)
 *   ganancia   cierre con ganancia (arpegio mayor brillante)
 *   perdida    cierre con pérdida (descenso grave y suave, nunca agresivo)
 *   sltp       SL/TP movido (tic)        cancelar  orden cancelada (barrido corto)        error  rechazo (dos notas graves)
 * El navegador solo deja sonar tras un toque del usuario: se "desbloquea" solo con el primer clic/toque. Se activa/desactiva en
 * el panel «Operar» (preferencia guardada por usuario). */
(function () {
    'use strict';
    let ctx = null, maestro = null, ultimo = {};
    const prefs = () => { try { return NLTCharts.state.prefs(); } catch (_) { return {}; } };
    const activo = () => prefs().sonidosChart !== false;
    const volumen = () => { const v = Number(prefs().sonidosVol); return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.6; };

    function audio() {
        if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            try { ctx = new AC({ latencyHint: 'interactive' }); } catch (_) { return null; }
            maestro = ctx.createGain();
            const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3;
            // eco corto con filtro: da "aire" futurista sin ensuciar
            const eco = ctx.createDelay(0.6); eco.delayTime.value = 0.16;
            const fb = ctx.createGain(); fb.gain.value = 0.26;
            const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3400;
            const mojado = ctx.createGain(); mojado.gain.value = 0.28;
            maestro.connect(comp); comp.connect(ctx.destination);
            maestro.connect(eco); eco.connect(lp); lp.connect(fb); fb.connect(eco); lp.connect(mojado); mojado.connect(comp);
        }
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        maestro.gain.value = 0.55 * volumen();
        return ctx;
    }

    // Una nota: seno + armónico triangular suave, ataque de 5 ms y caída exponencial. `glide` desliza la afinación.
    function nota(a, { f, t = 0, dur = 0.28, vol = 0.5, glide = null, tipo = 'sine', brillo = 0.35, lp = 0 }) {
        const t0 = a.currentTime + t, fin = t0 + dur;
        const g = a.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, fin);
        let salida = g;
        if (lp) { const fl = a.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; g.connect(fl); salida = fl; }
        salida.connect(maestro);
        const osc = (freq, tp, nivel) => {
            const o = a.createOscillator(), n = a.createGain();
            o.type = tp; o.frequency.setValueAtTime(freq, t0);
            if (glide) o.frequency.exponentialRampToValueAtTime(glide, fin);
            n.gain.value = nivel; o.connect(n); n.connect(g); o.start(t0); o.stop(fin + 0.02);
        };
        osc(f, tipo, 1);
        if (brillo) osc(f * 2.005, 'triangle', brillo);      // ligera desafinación: brillo de cristal
    }

    const A4 = 440, mi = (n) => A4 * Math.pow(2, n / 12);      // n = semitonos desde La4
    const SONIDOS = {
        abrir(a) {
            nota(a, { f: mi(0), t: 0, dur: 0.16, vol: 0.45 });
            nota(a, { f: mi(7), t: 0.07, dur: 0.18, vol: 0.45 });
            nota(a, { f: mi(12), t: 0.14, dur: 0.38, vol: 0.5, brillo: 0.5 });
            nota(a, { f: 110, t: 0, dur: 0.22, vol: 0.4, brillo: 0, lp: 400 });
        },
        pendiente(a) {
            nota(a, { f: mi(16), t: 0, dur: 0.22, vol: 0.38, brillo: 0.6 });
            nota(a, { f: mi(23), t: 0.11, dur: 0.34, vol: 0.34, brillo: 0.6 });
        },
        cerrar(a) {
            nota(a, { f: mi(19), t: 0, dur: 0.18, vol: 0.42, glide: mi(14) });
            nota(a, { f: mi(12), t: 0.1, dur: 0.4, vol: 0.46, brillo: 0.5 });
        },
        ganancia(a) {
            [0, 4, 7, 12, 16].forEach((s, i) => nota(a, { f: mi(s + 12), t: i * 0.065, dur: 0.3 + i * 0.05, vol: 0.34, tipo: 'triangle', brillo: 0.5 }));
            nota(a, { f: mi(24), t: 0.34, dur: 0.5, vol: 0.28, brillo: 0.7 });
        },
        perdida(a) {
            nota(a, { f: mi(-5), t: 0, dur: 0.3, vol: 0.4, glide: mi(-9), brillo: 0.15, lp: 900 });
            nota(a, { f: mi(-12), t: 0.14, dur: 0.46, vol: 0.4, brillo: 0.1, lp: 700 });
        },
        sltp(a) { nota(a, { f: mi(26), t: 0, dur: 0.07, vol: 0.28, brillo: 0.3 }); },
        cancelar(a) { nota(a, { f: mi(14), t: 0, dur: 0.2, vol: 0.34, glide: mi(2) }); },
        error(a) {
            nota(a, { f: mi(-12), t: 0, dur: 0.14, vol: 0.4, tipo: 'triangle', brillo: 0, lp: 800 });
            nota(a, { f: mi(-12), t: 0.17, dur: 0.2, vol: 0.4, tipo: 'triangle', brillo: 0, lp: 800 });
        },
    };

    function reproducir(nombre) {
        if (!activo() || !SONIDOS[nombre]) return;
        const ahora = performance.now();
        if (ultimo[nombre] && ahora - ultimo[nombre] < 90) return;      // el mismo sonido no se pisa
        ultimo[nombre] = ahora;
        const a = audio();
        if (a) { try { SONIDOS[nombre](a); } catch (_) { /* un navegador sin audio no debe romper el gráfico */ } }
    }

    // El navegador exige un gesto del usuario para sonar: se desbloquea con el primer toque y ya no se vuelve a pedir.
    const desbloquear = () => { audio(); window.removeEventListener('pointerdown', desbloquear, true); window.removeEventListener('keydown', desbloquear, true); };
    window.addEventListener('pointerdown', desbloquear, true);
    window.addEventListener('keydown', desbloquear, true);

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.sonidos = {
        reproducir, activo,
        alternar(on) { NLTCharts.state.savePrefs({ sonidosChart: !!on }); if (on) reproducir('pendiente'); },
        nombres: Object.keys(SONIDOS),
    };
})();
