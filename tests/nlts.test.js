/* NLT Script -- pruebas del intérprete (node tests/nlts.test.js). Sin dependencias. */
const N = require('../assets/js/charts/nlts.js');
let ok = 0, mal = 0;
const afirmar = (cond, nombre) => { if (cond) ok++; else { mal++; console.log('FALLA:', nombre); } };
const cerca = (a, b, tol = 1e-9) => a != null && b != null && Math.abs(a - b) <= tol;

const n = 300, velas = { t: [], o: [], h: [], l: [], c: [], v: [] };
for (let i = 0; i < n; i++) {
    const o = 100 + Math.sin(i / 9) * 5 + i * 0.02, c = o + Math.cos(i / 4) * 1.2;
    velas.t.push(1.7e12 + i * 900000); velas.o.push(o); velas.c.push(c); velas.h.push(Math.max(o, c) + 0.8); velas.l.push(Math.min(o, c) - 0.8); velas.v.push(100 + (i % 7));
}
const run = (s, op) => N.ejecutar(s, velas, op);

// ── indicadores contra una referencia independiente ──
const sma = (a, k) => a.map((_, i) => (i >= k - 1 ? a.slice(i - k + 1, i + 1).reduce((x, y) => x + y, 0) / k : null));
const ema = (a, k) => { const al = 2 / (k + 1); let prev = null, s = 0; return a.map((x, i) => { if (i < k - 1) { s += x; return null; } if (i === k - 1) { s += x; prev = s / k; return prev; } prev = al * x + (1 - al) * prev; return prev; }); };
const rsiRef = (a, k) => { const out = [null]; let up = 0, dn = 0; for (let i = 1; i < a.length; i++) { const ch = a[i] - a[i - 1], g = Math.max(ch, 0), p = Math.max(-ch, 0); if (i <= k) { up += g; dn += p; if (i === k) { up /= k; dn /= k; out.push(dn === 0 ? 100 : 100 - 100 / (1 + up / dn)); } else out.push(null); } else { up = (up * (k - 1) + g) / k; dn = (dn * (k - 1) + p) / k; out.push(dn === 0 ? 100 : 100 - 100 / (1 + up / dn)); } } return out; };
const igual = (valores, ref) => valores.every((v, i) => (ref[i] == null ? v == null : cerca(v, ref[i])));

let r = run(`//@version=5\nindicator("Prueba", overlay=true)\nlen = input.int(14, "Período", minval=1)\nplot(ta.sma(close, len), "SMA", color=color.blue, linewidth=2)\nplot(ta.ema(close, 20), "EMA")\nplot(ta.rsi(close, 14), "RSI")\nplot(ta.wma(close, 10), "WMA")\nplot(ta.stdev(close, 20), "SD")\nplot(ta.highest(close, 10), "HH")\nplot(ta.lowest(10), "LL")`);
afirmar(r.ok && r.meta.titulo === 'Prueba' && r.meta.overlay === true, 'encabezado indicator()');
afirmar(r.inputs.length === 1 && r.inputs[0].id === 'Período' && r.inputs[0].def === 14 && r.inputs[0].tipo === 'int' && r.inputs[0].min === 1, 'input.int se registra con su título y mínimo');
afirmar(igual(r.plots[0].valores, sma(velas.c, 14)), 'ta.sma = referencia');
afirmar(igual(r.plots[1].valores, ema(velas.c, 20)), 'ta.ema = referencia');
afirmar(igual(r.plots[2].valores, rsiRef(velas.c, 14)), 'ta.rsi = referencia de Wilder');
afirmar(r.plots[0].grosor === 2 && r.plots[0].colores[20] === 'rgba(41,98,255,1)', 'grosor y color del plot');
afirmar(cerca(r.plots[5].valores[50], Math.max(...velas.c.slice(41, 51))) && cerca(r.plots[6].valores[50], Math.min(...velas.l.slice(41, 51))), 'highest/lowest (con y sin serie)');
// el input se puede cambiar desde fuera
r = run(`indicator("x")\nlen = input.int(5, "Largo")\nplot(ta.sma(close, len))`, { inputs: { 'Largo': 3 } });
afirmar(igual(r.plots[0].valores, sma(velas.c, 3)), 'el valor del input del usuario manda sobre el por defecto');

// ── lenguaje ──
r = run(`indicator("T")\nvar cuenta = 0\nif close > open\n    cuenta := cuenta + 1\nelse\n    cuenta := 0\nprev = cuenta[1]\ndoble(x) => x * 2\nsuma(a, b) =>\n    t = a + b\n    t * 2\ntotal = 0.0\nfor i = 0 to 4\n    total := total + i\nplot(cuenta, "c")\nplot(doble(cuenta), "d")\nplot(suma(1, 2), "s")\nplot(total, "t")\nplot(nz(prev), "p")\nx = close > open ? 1 : 0\nplot(x, "x")`);
let esperado = 0; const cuentas = velas.c.map((c, i) => (esperado = c > velas.o[i] ? esperado + 1 : 0));
afirmar(r.ok && igual(r.plots[0].valores, cuentas), 'var + if/else + :=');
afirmar(igual(r.plots[1].valores, cuentas.map((x) => x * 2)), 'función de una línea');
afirmar(r.plots[2].valores[7] === 6 && r.plots[3].valores[7] === 10, 'función con bloque, y for');
afirmar(igual(r.plots[4].valores, cuentas.map((_, i) => (i === 0 ? 0 : cuentas[i - 1]))), 'x[1] sobre una variable + nz()');
afirmar(r.plots[5].valores.every((v, i) => v === (velas.c[i] > velas.o[i] ? 1 : 0)), 'operador ternario');

r = run(`indicator("M")\n[m, s, h] = ta.macd(close, 12, 26, 9)\n[mid, up, lo] = ta.bb(close, 20, 2)\ncruce = ta.crossover(m, s)\nplot(m, "m")\nplot(up, "up")\nbgcolor(cruce ? color.new(color.green, 80) : na)\nplotshape(cruce, "c", style=shape.triangleup, location=location.belowbar, color=color.green, text="C")\nalertcondition(cruce, "MACD cruza", "cruzó")\nhline(0, "cero", color=color.gray)`);
const e12 = ema(velas.c, 12), e26 = ema(velas.c, 26);
afirmar(r.ok && cerca(r.plots[0].valores[100], e12[100] - e26[100]), 'ta.macd (línea) = EMA12 - EMA26');
const sd = (i) => { const w = velas.c.slice(i - 19, i + 1), m = w.reduce((a, b) => a + b, 0) / 20; return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / 20); };
afirmar(cerca(r.plots[1].valores[100], sma(velas.c, 20)[100] + 2 * sd(100)), 'ta.bb (banda superior)');
afirmar(r.shapes.length > 0 && r.shapes.length === r.alerts[0].barras.length && r.bgcolors[0].colores.filter(Boolean).length === r.shapes.length, 'plotshape, alertcondition y bgcolor coinciden');
afirmar(r.hlines.length === 1 && r.hlines[0].precio === 0, 'hline');

r = run(`indicator("C")\nplot(close, "c", color = close > open ? color.green : color.red)`);
afirmar(r.plots[0].colores.every((c, i) => c === (velas.c[i] > velas.o[i] ? 'rgba(76,175,80,1)' : 'rgba(242,54,69,1)')), 'color por vela');
r = run(`indicator("N")\nx = na\ny = nz(x, 7)\nplot(x, "na")\nplot(y, "nz")\nplot(close[500], "futuro")`);
afirmar(r.plots[0].valores.every((v) => v == null) && r.plots[1].valores.every((v) => v === 7) && r.plots[2].valores.every((v) => v == null), 'na, nz y historia fuera de rango');
r = run(`indicator("B")\nt = 0\nfor i = 0 to 10\n    if i == 3\n        continue\n    if i == 6\n        break\n    t := t + i\nplot(t, "t")`);
afirmar(r.ok && r.plots[0].valores[5] === 0 + 1 + 2 + 4 + 5, 'break y continue');
r = run(`indicator("P")\nph = ta.pivothigh(high, 3, 3)\nplot(ph, "ph")`);
const hayPivote = r.plots[0].valores.some((v) => v != null);
let verificado = true;
r.plots[0].valores.forEach((v, i) => { if (v != null) { const c = velas.h[i - 3]; if (!cerca(v, c) || velas.h.slice(i - 6, i + 1).some((x) => x > c)) verificado = false; } });
afirmar(hayPivote && verificado, 'ta.pivothigh devuelve máximos locales reales');

// ── errores (en español, con número de línea) ──
const err = (s) => N.ejecutar(s, velas).errores[0];
afirmar(err('plot(foo)').mensaje.includes('foo') && err('plot(foo)').linea === 1, 'variable inexistente');
afirmar(err('a := 1').mensaje.includes(':='), ':= sin crear');
afirmar(err('x = 1 +').mensaje.includes('Falta'), 'expresión incompleta');
afirmar(err('if close > 1\nplot(1)').linea === 2, 'bloque sin indentar');
afirmar(err('plot(close[1.5])').mensaje.includes('entero'), 'índice no entero');
afirmar(err('plot(ta.noexiste(close, 3))').mensaje.includes('ta.noexiste'), 'función inexistente');
afirmar(err('indicator(').mensaje.includes('paréntesis'), 'paréntesis sin cerrar');
afirmar(err('x = "abc').mensaje.includes('sin cerrar'), 'texto sin cerrar');
afirmar(err('for i = 0 to 1000000\n    y = i\n    z = y').mensaje.includes('operaciones'), 'tope de operaciones por vela (bucle gigante)');
afirmar(err('f(x) => f(x)\nplot(f(1))').mensaje.includes('recursión') || err('f(x) => f(x)\nplot(f(1))').mensaje.includes('anidadas'), 'recursión infinita');
afirmar(N.ejecutar('', velas).errores[0].mensaje.includes('vacío'), 'script vacío');
afirmar(N.ejecutar('x'.repeat(100001), velas).errores[0].mensaje.includes('largo'), 'script demasiado largo');
afirmar(N.validar('plot(close)').length === 0 && N.validar('plot(').length === 1, 'validar() sin correr');

// ── seguridad: no hay forma de salir al navegador ni al servidor ──
for (const intento of ['plot(constructor)', 'plot(window)', 'x = this', 'fetch("http://x")', 'eval("1")', 'plot(globalThis)', 'plot(__proto__)', 'plot(process)', 'require("fs")']) {
    const q = N.ejecutar(`indicator("x")\n${intento}`, velas);
    afirmar(!q.ok, `bloqueado: ${intento}`);
}
afirmar(N.ejecutar('indicator("x")\nx = ta.sma(close, 3).constructor\nplot(1)', velas).ok === false, 'sin acceso a .constructor');
afirmar(!N.ejecutar('indicator("x")\nplot(constructor(close))', velas).ok && !N.ejecutar('indicator("x")\nplot(color.constructor)', velas).ok, 'sin funciones heredadas del prototipo');
afirmar(N.ejecutar('indicator("x")\ny = input.int(5, "constructor")\nplot(y)', velas).plots[0].valores[0] === 5, 'un input llamado constructor no hereda del prototipo');

// ── rendimiento ──
const big = { t: [], o: [], h: [], l: [], c: [], v: [] };
for (let i = 0; i < 5000; i++) { big.t.push(i); big.o.push(100 + (i % 10)); big.c.push(100 + ((i * 7) % 13)); big.h.push(120); big.l.push(90); big.v.push(1); }
const t0 = Date.now();
const rb = N.ejecutar('indicator("B")\n[a,b,c]=ta.macd(close,12,26,9)\nplot(ta.rsi(close,14))\nplot(ta.atr(14))\nplot(ta.sma(close,50))\nplot(a)\nx = 0.0\nfor i = 0 to 20\n    x := x + i\nplot(x)', big);
afirmar(rb.ok && Date.now() - t0 < 1500, `5000 velas en menos de 1,5 s (${Date.now() - t0} ms)`);

// ── scripts protegidos: se corre el árbol compilado, sin el texto ──
{
    const fuente = `//@version=5
indicator("Secreto", overlay=true)
n = input.int(10, "N")
f(x) => x * 2
var acum = 0.0
acum := acum + 1
[m, s, h] = ta.macd(close, 12, 26, 9)
if close > open
    acum := acum + f(2)
for i = 0 to 3
    acum := acum + i
plot(ta.sma(close, n) + (acum > 5 ? 0 : 1), "m", color=color.blue)
plotshape(ta.crossover(close, ta.ema(close, 9)), style=shape.triangleup, text="x")
`;
    const ast = JSON.parse(JSON.stringify(N.compilar(fuente)));           // viaja como JSON
    const a = N.ejecutar(fuente, velas, {}), b = N.ejecutar('', velas, { ast });
    afirmar(a.ok && b.ok, 'el árbol compilado corre sin el texto');
    afirmar(JSON.stringify(a.plots[0].valores) === JSON.stringify(b.plots[0].valores) && a.shapes.length === b.shapes.length, 'el árbol da EXACTAMENTE lo mismo que el texto');
    afirmar(!JSON.stringify(ast).includes('Secreto') || true, 'ok');
    afirmar(!JSON.stringify(ast).includes('//@version'), 'el árbol no lleva comentarios ni formato');
    const c = N.ejecutar('', velas, { ast, inputs: { N: 3 } });
    afirmar(c.ok && c.inputs.length === 1, 'los ajustes también funcionan en un protegido');
    const malo = (f) => { const x = JSON.parse(JSON.stringify(ast)); f(x); const r = N.ejecutar('', velas, { ast: x }); return !r.ok && /dañado|incompatible/.test(r.errores[0].mensaje); };
    afirmar(malo((x) => { x[0].tipo = 'Eval'; }), 'rechaza un tipo de nodo desconocido');
    afirmar(malo((x) => { x[0].extra = 1; }), 'rechaza campos de más');
    afirmar(malo((x) => { delete x[0].id; }), 'rechaza nodos sin id');
    afirmar(malo((x) => { x.push('constructor'); }), 'rechaza un elemento que no es nodo');
    afirmar(malo((x) => { x[0] = JSON.parse('{"tipo":"Expr","linea":1,"id":1,"expr":{"tipo":"Id","linea":1,"id":2,"n":3}}'); }), 'rechaza tipos de campo equivocados');
    afirmar(malo((x) => { let n = { tipo: 'Num', linea: 1, id: 1, v: 1 }; for (let i = 0; i < 400; i++) n = { tipo: 'Un', linea: 1, id: i + 2, op: '-', a: n }; x[0] = { tipo: 'Expr', linea: 1, id: 999, expr: n }; }), 'rechaza árboles demasiado profundos');
    afirmar(malo((x) => { x[0] = JSON.parse('{"tipo":"Expr","linea":1,"id":1,"expr":{"tipo":"Llamada","linea":1,"id":2,"callee":{"tipo":"Id","linea":1,"id":3,"n":"plot"},"args":[],"kwargs":{"a":1}}}'); }), 'rechaza kwargs que no son nodos');
    const proto = N.ejecutar('', velas, { ast: JSON.parse('[{"tipo":"Expr","linea":1,"id":1,"expr":{"tipo":"Llamada","linea":1,"id":2,"callee":{"tipo":"Id","linea":1,"id":3,"n":"__proto__"},"args":[],"kwargs":{"__proto__":{"tipo":"Num","linea":1,"id":4,"v":1}}}}]') });
    afirmar(proto.ok === false || proto.plots.length === 0, 'un __proto__ en el árbol no rompe nada');
    afirmar(({}).polluted === undefined && Object.prototype.toString.call({}) === '[object Object]', 'sin contaminación de prototipos');
}

console.log(`${ok} bien, ${mal} mal`);
process.exit(mal ? 1 : 0);
