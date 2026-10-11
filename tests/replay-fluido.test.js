/* NLT Charts -- pruebas del replay "en vivo" (node tests/replay-fluido.test.js). Sin dependencias. */
const F = require('../assets/js/charts/replay-fluido.js');
let ok = 0, mal = 0;
const afirmar = (cond, nombre) => { if (cond) ok++; else { mal++; console.log('FALLA:', nombre); } };

const alcista = { timestamp: 1.7e12, open: 100, high: 106, low: 98, close: 105, volume: 500 };
const bajista = { timestamp: 1.7e12 + 60000, open: 105, high: 107, low: 99, close: 100, volume: 800 };
const doji = { timestamp: 1.7e12 + 120000, open: 100, high: 100, low: 100, close: 100, volume: 0 };
const rara = { timestamp: 1.7e12 + 180000, open: 100, high: 99, low: 101, close: 102, volume: 10 };   // máx < mín: dato corrupto

for (const c of [alcista, bajista, doji, rara]) {
    const ruta = F.rutaVela(c, 20);
    const hi = Math.max(c.high, c.open, c.close), lo = Math.min(c.low, c.open, c.close);
    afirmar(ruta[0] === c.open && ruta[ruta.length - 1] === c.close, 'la ruta empieza en la apertura y termina en el cierre');
    afirmar(ruta.every((p) => p >= lo && p <= hi && Number.isFinite(p)), 'la ruta nunca sale de [mínimo, máximo]');
    afirmar(Math.max(...ruta) === hi && Math.min(...ruta) === lo, 'la ruta toca el máximo y el mínimo reales');
    afirmar(JSON.stringify(ruta) === JSON.stringify(F.rutaVela(c, 20)), 'misma vela, mismo camino (determinista)');
}
const ra = F.rutaVela(alcista, 20), rb = F.rutaVela(bajista, 20);
afirmar(ra.indexOf(98) < ra.indexOf(106), 'vela alcista: toca el mínimo antes que el máximo');
afirmar(rb.indexOf(107) < rb.indexOf(99), 'vela bajista: toca el máximo antes que el mínimo');
afirmar(F.rutaVela(alcista, 20).join() !== F.rutaVela({ ...alcista, timestamp: alcista.timestamp + 1 }, 20).join(), 'otra vela, otro temblor');

// el plan: máximo/mínimo parciales solo crecen hacia lo real, y el volumen sube
const plan = F.planVela(alcista, 20);
let H = -Infinity, L = Infinity, volOk = true, ant = -1;
for (let i = 0; i < plan.largo; i++) {
    const v = plan.vela(i, i / (plan.largo - 1));
    afirmar(v.high >= H || H === -Infinity, 'el máximo parcial nunca baja');
    afirmar(v.low <= L || L === Infinity, 'el mínimo parcial nunca sube');
    afirmar(v.high >= Math.max(v.open, v.close) && v.low <= Math.min(v.open, v.close), 'la mecha cubre el cuerpo');
    afirmar(v.timestamp === alcista.timestamp && v.open === alcista.open, 'la apertura y la hora no cambian');
    if (v.volume < ant) volOk = false; ant = v.volume; H = v.high; L = v.low;
}
afirmar(volOk, 'el volumen parcial solo sube');

// animar: reloj y cuadros falsos; la última vela empujada es EXACTAMENTE la real
function correr(c, durMs, cortarEn) {
    let t = 0, cola = [];
    const empujadas = [];
    const a = F.animar({ vela: c, durMs, empujar: (v) => empujadas.push(v), ahora: () => t, raf: (f) => cola.push(f) });
    let vueltas = 0;
    while (cola.length && vueltas++ < 5000) {
        t += 16;
        if (cortarEn != null && t >= cortarEn) { a.terminar(); break; }
        cola.shift()();
    }
    return { empujadas, a };
}
let e = correr(alcista, 800);
afirmar(e.empujadas.length > 3, 'se ve formarse la vela en varios pasos');
afirmar(JSON.stringify(e.empujadas[e.empujadas.length - 1]) === JSON.stringify(alcista), 'el último paso es la vela real exacta');
afirmar(e.empujadas.filter((v) => v === alcista).length === 1, 'la vela real se empuja una sola vez');
afirmar(e.empujadas.every((v) => v.timestamp === alcista.timestamp), 'todos los pasos son la MISMA vela (no crea velas nuevas)');
afirmar(e.empujadas[0].high === alcista.open && e.empujadas[0].low === alcista.open, 'nace en el precio de apertura');

// terminar a mitad: cierra con la vela real, una vez, y no sigue empujando
e = correr(bajista, 2000, 400);
afirmar(e.empujadas[e.empujadas.length - 1] === bajista, 'terminar() deja la vela real');
const n = e.empujadas.length; e.a.terminar();
afirmar(e.empujadas.length === n, 'terminar() dos veces no empuja de más');

// duración tiny / cero: no se cuelga
e = correr(doji, 0);
afirmar(e.empujadas[e.empujadas.length - 1] === doji, 'duración 0 también termina con la vela real');

// la promesa se resuelve al terminar
(async () => {
    let t = 0, cola = [];
    const a = F.animar({ vela: alcista, durMs: 100, empujar: () => {}, ahora: () => t, raf: (f) => cola.push(f) });
    let resuelta = false; a.promesa.then(() => { resuelta = true; });
    while (cola.length) { t += 50; cola.shift()(); }
    await a.promesa;
    afirmar(resuelta, 'la promesa se resuelve cuando termina');
    console.log(mal ? `${mal} FALLAS (${ok} ok)` : `replay-fluido: ${ok} pruebas ok`);
    process.exit(mal ? 1 : 0);
})();
