/* NLT Script -- lenguaje de indicadores de NLT Charts (parecido a Pine Script v5, con su propio intérprete).
 *
 * Este archivo es el LENGUAJE: lexer, parser e intérprete. No toca el DOM, la red ni el gráfico, y nunca ejecuta el código del
 * usuario como JavaScript (no hay eval): el script se interpreta con un recorrido del árbol sintáctico, con límite de operaciones
 * por vela. En el navegador corre además dentro de un Web Worker (nlts-worker.js) que se puede matar por tiempo. Así un script
 * de un tercero no puede leer la sesión, la cuenta ni salir a internet.
 *
 * Qué entiende (subconjunto de Pine v5):
 *   indicator("Nombre", overlay=true)          encabezado
 *   x = expr  |  x := expr  |  var x = expr     variables (todas son series: x[1] es el valor de la vela anterior)
 *   [a, b, c] = ta.macd(close, 12, 26, 9)       desestructurar
 *   if / else if / else, for i = a to b by s, while, break, continue, ternario  c ? a : b   (bloques por indentación)
 *   f(x) => expr   y   f(x) =>\n    ...\n    resultado   (funciones propias)
 *   input.int/float/bool/string/color/source, plot, hline, bgcolor, plotshape, alertcondition
 *   ta.sma/ema/rma/wma/hma/rsi/atr/tr/stdev/highest/lowest/change/mom/roc/crossover/crossunder/cross/macd/bb/stoch/cum/
 *      pivothigh/pivotlow/barssince/valuewhen/obv ,  math.*, color.*, nz, na, str.tostring
 *
 * Uso:  NLTS.ejecutar(codigo, velas, { inputs: {...} })  ->  { ok, meta, inputs, plots, hlines, bgcolors, shapes, alerts, errores }
 *       velas = { t: [], o: [], h: [], l: [], c: [], v: [] }  (arrays del mismo largo) */
(function (global) {
    'use strict';

    const MAX_OPS_POR_VELA = 60000;       // protege de bucles enormes: pasado esto, el script se detiene con un error claro
    const MAX_ITER_BUCLE = 100000;
    const MAX_PLOTS = 16, MAX_SHAPES = 20000;

    class ErrorNLTS extends Error {
        constructor(mensaje, linea) { super(mensaje); this.linea = linea || null; this.name = 'ErrorNLTS'; }
    }

    // ───────────────────────────── lexer ─────────────────────────────
    const PALABRAS = new Set(['if', 'else', 'for', 'to', 'by', 'while', 'var', 'varip', 'true', 'false', 'and', 'or', 'not', 'break', 'continue', 'switch', 'in']);
    const OPS3 = ['...'];
    const OPS2 = ['==', '!=', '<=', '>=', ':=', '+=', '-=', '*=', '/=', '%=', '=>'];
    const OPS1 = '+-*/%<>=?:,.()[]!'.split('');

    function lex(src) {
        const toks = [];
        const lineas = String(src).replace(/\r\n?/g, '\n').split('\n');
        const indentStack = [0];
        let prof = 0;                                        // profundidad de ( [ : dentro, los saltos de línea no cuentan
        let continuar = false;                               // la línea anterior terminó en un operador: esta continúa
        const push = (tipo, valor, linea) => toks.push({ tipo, valor, linea });
        for (let n = 0; n < lineas.length; n++) {
            let linea = lineas[n];
            const num = n + 1;
            // quitar comentario // (fuera de cadenas)
            let enCad = null, corte = -1;
            for (let i = 0; i < linea.length; i++) {
                const ch = linea[i];
                if (enCad) { if (ch === '\\') i++; else if (ch === enCad) enCad = null; } else if (ch === '"' || ch === "'") enCad = ch; else if (ch === '/' && linea[i + 1] === '/') { corte = i; break; }
            }
            if (corte >= 0) linea = linea.slice(0, corte);
            if (!linea.trim()) continue;
            if (prof === 0 && !continuar) {
                let ind = 0, k = 0;
                while (k < linea.length && (linea[k] === ' ' || linea[k] === '\t')) { ind += linea[k] === '\t' ? 4 : 1; k++; }
                if (ind > indentStack[indentStack.length - 1]) { indentStack.push(ind); push('INDENT', null, num); }
                else {
                    while (ind < indentStack[indentStack.length - 1]) { indentStack.pop(); push('DEDENT', null, num); }
                    if (ind !== indentStack[indentStack.length - 1]) throw new ErrorNLTS('Indentación inconsistente.', num);
                }
            }
            let i = 0;
            const L = linea.length;
            let ultimo = null;
            while (i < L) {
                const ch = linea[i];
                if (ch === ' ' || ch === '\t') { i++; continue; }
                if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(linea[i + 1] || ''))) {
                    const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(linea.slice(i));
                    push('NUM', parseFloat(m[0]), num); i += m[0].length; ultimo = 'NUM'; continue;
                }
                if (ch === '"' || ch === "'") {
                    let j = i + 1, s = '';
                    while (j < L && linea[j] !== ch) { if (linea[j] === '\\' && j + 1 < L) { j++; s += linea[j] === 'n' ? '\n' : linea[j]; } else s += linea[j]; j++; }
                    if (j >= L) throw new ErrorNLTS('Texto sin cerrar.', num);
                    push('STR', s, num); i = j + 1; ultimo = 'STR'; continue;
                }
                if (ch === '#') {
                    const m = /^#([0-9a-fA-F]{8}|[0-9a-fA-F]{6})/.exec(linea.slice(i));
                    if (!m) throw new ErrorNLTS('Color inválido (usa #RRGGBB).', num);
                    push('COLOR', '#' + m[1], num); i += m[0].length; ultimo = 'COLOR'; continue;
                }
                if (/[A-Za-z_]/.test(ch)) {
                    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(linea.slice(i));
                    push(PALABRAS.has(m[0]) ? 'KW' : 'ID', m[0], num); i += m[0].length; ultimo = PALABRAS.has(m[0]) ? 'KW:' + m[0] : 'ID'; continue;
                }
                const dos = linea.slice(i, i + 2);
                if (OPS2.includes(dos)) { push('OP', dos, num); i += 2; ultimo = 'OP:' + dos; continue; }
                if (OPS1.includes(ch)) {
                    if (ch === '(' || ch === '[') prof++;
                    if (ch === ')' || ch === ']') prof = Math.max(0, prof - 1);
                    push('OP', ch, num); i++; ultimo = 'OP:' + ch; continue;
                }
                throw new ErrorNLTS(`Carácter no válido: «${ch}»`, num);
            }
            // ¿la línea sigue en la siguiente? (termina en operador binario o coma)
            continuar = prof > 0 || /^OP:(\+|-|\*|\/|%|<|>|==|!=|<=|>=|\?|:|,|\.|=|:=|\+=|-=|\*=|\/=|%=)$/.test(ultimo || '') || ultimo === 'KW:and' || ultimo === 'KW:or' || ultimo === 'KW:not';
            if (prof === 0 && !continuar) push('NEWLINE', null, num);
        }
        if (prof > 0) throw new ErrorNLTS('Falta cerrar un paréntesis o corchete.', lineas.length);
        const ult = lineas.length;
        while (indentStack.length > 1) { indentStack.pop(); push('DEDENT', null, ult); }
        push('EOF', null, ult);
        return toks;
    }

    // ───────────────────────────── parser ─────────────────────────────
    let idNodo = 0;
    const nodo = (tipo, linea, props) => ({ tipo, linea, id: ++idNodo, ...props });

    function parsear(src) {
        const T = lex(src);
        let p = 0;
        const ver = () => T[p];
        const sig = () => T[p++];
        const es = (tipo, valor) => T[p].tipo === tipo && (valor === undefined || T[p].valor === valor);
        const op = (v) => es('OP', v);
        const kw = (v) => es('KW', v);
        const esperar = (tipo, valor, msg) => {
            if (!es(tipo, valor)) throw new ErrorNLTS(msg || `Se esperaba «${valor || tipo}»${T[p].tipo === 'EOF' ? '' : ` y apareció «${T[p].valor == null ? T[p].tipo : T[p].valor}»`}.`, T[p].linea);
            return sig();
        };
        const saltarNL = () => { while (es('NEWLINE')) p++; };

        function bloque() {
            esperar('NEWLINE', undefined, 'Falta el contenido del bloque (indentado) en la línea siguiente.');
            saltarNL();
            esperar('INDENT', undefined, 'El bloque debe ir indentado.');
            const out = [];
            saltarNL();
            while (!es('DEDENT') && !es('EOF')) { out.push(sentencia()); saltarNL(); }
            esperar('DEDENT');
            return out;
        }
        // Cuerpo de if/for/función: en la misma línea (una expresión) o un bloque indentado.
        function cuerpo() {
            if (es('NEWLINE')) return bloque();
            const s = sentencia(true);
            return [s];
        }
        function sentencia(enLinea) {
            const t = ver(), linea = t.linea;
            let r;
            if (kw('if')) r = sentenciaIf();
            else if (kw('for')) r = sentenciaFor();
            else if (kw('while')) { sig(); const cond = expr(); r = nodo('While', linea, { cond, cuerpo: cuerpo() }); }
            else if (kw('break') || kw('continue')) { sig(); r = nodo(t.valor === 'break' ? 'Break' : 'Continue', linea, {}); }
            else if (kw('var') || kw('varip')) { sig(); const nombre = esperar('ID').valor; esperar('OP', '=', 'Falta «=» después del nombre de la variable.'); r = nodo('Decl', linea, { nombre, valor: expr(), persistente: true }); }
            else if (op('[') && esDestructurar()) {
                sig(); const nombres = [esperar('ID').valor];
                while (op(',')) { sig(); nombres.push(esperar('ID').valor); }
                esperar('OP', ']'); esperar('OP', '=');
                r = nodo('Destructurar', linea, { nombres, valor: expr() });
            } else if (es('ID') && T[p + 1].tipo === 'OP' && T[p + 1].valor === '(' && esDefFuncion()) {
                const nombre = sig().valor; sig();
                const params = [];
                if (!op(')')) { params.push(esperar('ID').valor); while (op(',')) { sig(); params.push(esperar('ID').valor); } }
                esperar('OP', ')'); esperar('OP', '=>');
                r = nodo('DefFuncion', linea, { nombre, params, cuerpo: cuerpo() });
            } else if (es('ID') && T[p + 1].tipo === 'OP' && ['=', ':=', '+=', '-=', '*=', '/=', '%='].includes(T[p + 1].valor)) {
                const nombre = sig().valor, o = sig().valor;
                const v = expr();
                r = o === '=' ? nodo('Decl', linea, { nombre, valor: v, persistente: false }) : nodo('Asignar', linea, { nombre, op: o, valor: v });
            } else r = nodo('Expr', linea, { expr: expr() });
            // if/for/while/función ya consumieron su cuerpo (en bloque o en la misma línea) y con él su fin de línea
            const cerroBloque = (T[p - 1] && T[p - 1].tipo === 'DEDENT') || ['If', 'For', 'While', 'DefFuncion'].includes(r.tipo);
            if (!cerroBloque && (!enLinea || es('NEWLINE'))) { if (es('NEWLINE')) sig(); else if (!es('EOF') && !es('DEDENT')) throw new ErrorNLTS(`No entiendo «${T[p].valor == null ? T[p].tipo : T[p].valor}» aquí.`, T[p].linea); }
            return r;
        }
        function esDestructurar() { let k = p + 1; while (T[k].tipo === 'ID' || (T[k].tipo === 'OP' && T[k].valor === ',')) k++; return T[k].tipo === 'OP' && T[k].valor === ']' && T[k + 1].tipo === 'OP' && T[k + 1].valor === '='; }
        function esDefFuncion() { let k = p + 2, prof = 1; while (prof > 0 && T[k].tipo !== 'EOF' && T[k].tipo !== 'NEWLINE') { if (T[k].tipo === 'OP' && T[k].valor === '(') prof++; if (T[k].tipo === 'OP' && T[k].valor === ')') prof--; k++; } return prof === 0 && T[k].tipo === 'OP' && T[k].valor === '=>'; }
        function sentenciaIf() {
            const linea = sig().linea;
            const cond = expr();
            const entonces = cuerpo();
            let sino = null;
            saltarNLsoloSiElse();
            if (kw('else')) {
                sig();
                if (kw('if')) sino = [sentenciaIf()];
                else sino = cuerpo();
            }
            return nodo('If', linea, { cond, entonces, sino });
        }
        function saltarNLsoloSiElse() { let k = p; while (T[k].tipo === 'NEWLINE') k++; if (T[k].tipo === 'KW' && T[k].valor === 'else') p = k; }
        function sentenciaFor() {
            const linea = sig().linea;
            const v = esperar('ID').valor;
            esperar('OP', '=', 'En un for va «for i = 0 to 10».');
            const desde = expr(); esperar('KW', 'to');
            const hasta = expr();
            let paso = null;
            if (kw('by')) { sig(); paso = expr(); }
            return nodo('For', linea, { v, desde, hasta, paso, cuerpo: cuerpo() });
        }

        // expresiones: precedencia de menor a mayor
        function expr() { return ternario(); }
        function ternario() {
            const c = oLogico();
            if (op('?')) { const l = sig().linea; const a = ternario(); esperar('OP', ':'); const b = ternario(); return nodo('Ternario', l, { c, a, b }); }
            return c;
        }
        function oLogico() { let a = yLogico(); while (kw('or')) { const l = sig().linea; a = nodo('Logico', l, { op: 'or', a, b: yLogico() }); } return a; }
        function yLogico() { let a = igualdad(); while (kw('and')) { const l = sig().linea; a = nodo('Logico', l, { op: 'and', a, b: igualdad() }); } return a; }
        function igualdad() { let a = comparar(); while (op('==') || op('!=')) { const o = sig(); a = nodo('Bin', o.linea, { op: o.valor, a, b: comparar() }); } return a; }
        function comparar() { let a = suma(); while (op('<') || op('>') || op('<=') || op('>=')) { const o = sig(); a = nodo('Bin', o.linea, { op: o.valor, a, b: suma() }); } return a; }
        function suma() { let a = producto(); while (op('+') || op('-')) { const o = sig(); a = nodo('Bin', o.linea, { op: o.valor, a, b: producto() }); } return a; }
        function producto() { let a = unario(); while (op('*') || op('/') || op('%')) { const o = sig(); a = nodo('Bin', o.linea, { op: o.valor, a, b: unario() }); } return a; }
        function unario() {
            if (kw('not')) { const l = sig().linea; return nodo('Un', l, { op: 'not', a: unario() }); }
            if (op('-') || op('+')) { const o = sig(); return nodo('Un', o.linea, { op: o.valor, a: unario() }); }
            return postfijo();
        }
        function postfijo() {
            let a = primario();
            for (;;) {
                if (op('(')) { const l = sig().linea; const { args, kwargs } = argumentos(); a = nodo('Llamada', l, { callee: a, args, kwargs }); }
                else if (op('[')) { const l = sig().linea; const i = expr(); esperar('OP', ']'); a = nodo('Indice', l, { a, i }); }
                else if (op('.')) { const l = sig().linea; const n = esperar('ID').valor; a = nodo('Miembro', l, { a, n }); }
                else break;
            }
            return a;
        }
        function argumentos() {
            const args = [], kwargs = {};
            if (op(')')) { sig(); return { args, kwargs }; }
            for (;;) {
                if (es('ID') && T[p + 1].tipo === 'OP' && T[p + 1].valor === '=' && !(T[p + 2].tipo === 'OP' && T[p + 2].valor === '=')) {
                    const n = sig().valor; sig(); kwargs[n] = expr();
                } else {
                    if (Object.keys(kwargs).length) throw new ErrorNLTS('Los argumentos con nombre van al final.', ver().linea);
                    args.push(expr());
                }
                if (op(',')) { sig(); continue; }
                break;
            }
            esperar('OP', ')');
            return { args, kwargs };
        }
        function primario() {
            const t = ver();
            if (t.tipo === 'NUM') { sig(); return nodo('Num', t.linea, { v: t.valor }); }
            if (t.tipo === 'STR') { sig(); return nodo('Str', t.linea, { v: t.valor }); }
            if (t.tipo === 'COLOR') { sig(); return nodo('Color', t.linea, { v: t.valor }); }
            if (t.tipo === 'KW' && (t.valor === 'true' || t.valor === 'false')) { sig(); return nodo('Bool', t.linea, { v: t.valor === 'true' }); }
            if (t.tipo === 'ID') { sig(); return nodo('Id', t.linea, { n: t.valor }); }
            if (op('(')) { sig(); const e = expr(); esperar('OP', ')'); return e; }
            if (op('[')) { sig(); const items = []; if (!op(']')) { items.push(expr()); while (op(',')) { sig(); items.push(expr()); } } esperar('OP', ']'); return nodo('Tupla', t.linea, { items }); }
            if (kw('if')) { return sentenciaIf(); }
            if (t.tipo === 'EOF' || t.tipo === 'NEWLINE') throw new ErrorNLTS('Falta completar la expresión (la línea termina antes de tiempo).', t.linea);
            throw new ErrorNLTS(`No entiendo «${t.valor == null ? t.tipo : t.valor}» aquí.`, t.linea);
        }

        const prog = [];
        saltarNL();
        while (!es('EOF')) {
            if (es('INDENT')) throw new ErrorNLTS('Indentación inesperada.', ver().linea);
            prog.push(sentencia()); saltarNL();
        }
        return prog;
    }

    // ───────────────────────────── colores ─────────────────────────────
    const COLORES = { aqua: '#00BCD4', black: '#363A45', blue: '#2962FF', fuchsia: '#E040FB', gray: '#787B86', green: '#4CAF50', lime: '#00E676', maroon: '#880E4F', navy: '#311B92', olive: '#808000', orange: '#FF9800', purple: '#9C27B0', red: '#F23645', silver: '#B2B5BE', teal: '#089981', white: '#FFFFFF', yellow: '#FDD835' };
    function aRGBA(c, transp) {
        if (c == null) return null;
        let r, g, b, a = 1;
        const s = String(c);
        let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
        if (m) { r = parseInt(m[1].slice(0, 2), 16); g = parseInt(m[1].slice(2, 4), 16); b = parseInt(m[1].slice(4, 6), 16); if (m[2]) a = parseInt(m[2], 16) / 255; }
        else if ((m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(s))) { r = +m[1]; g = +m[2]; b = +m[3]; a = m[4] == null ? 1 : +m[4]; }
        else return s;
        if (transp != null) a = Math.max(0, Math.min(1, 1 - transp / 100)) * a;
        return `rgba(${r},${g},${b},${+a.toFixed(3)})`;
    }

    // ───────────────────────────── intérprete ─────────────────────────────
    const esNum = (x) => typeof x === 'number' && Number.isFinite(x);
    const NA = null;

    function ejecutarPrograma(prog, velas, opciones) {
        const n = velas.c.length;
        const inputsUsuario = (opciones && opciones.inputs) || {};
        const out = { meta: { titulo: 'Script', overlay: false, precision: null }, inputs: [], plots: [], hlines: [], bgcolors: [], shapes: [], alerts: [], errores: [] };
        const globales = new Map();          // nombre -> valor de la vela actual
        const hist = new Map();              // nombre -> [valores por vela]
        const funciones = new Map();         // funciones del usuario
        const estados = new Map();           // estado de cada llamada ta.* (clave: nodo + contexto)
        let barra = 0, ops = 0, pila = [], ctxClave = '', contadorLlamadas = 0;
        const inputsVistos = new Set();
        const plotsPorClave = new Map();

        const tr = new Array(n);
        const hl2 = new Array(n), hlc3 = new Array(n), ohlc4 = new Array(n);
        for (let i = 0; i < n; i++) {
            tr[i] = i === 0 ? velas.h[0] - velas.l[0] : Math.max(velas.h[i] - velas.l[i], Math.abs(velas.h[i] - velas.c[i - 1]), Math.abs(velas.l[i] - velas.c[i - 1]));
            hl2[i] = (velas.h[i] + velas.l[i]) / 2; hlc3[i] = (velas.h[i] + velas.l[i] + velas.c[i]) / 3; ohlc4[i] = (velas.o[i] + velas.h[i] + velas.l[i] + velas.c[i]) / 4;
        }
        const SERIES = { __proto__: null, open: velas.o, high: velas.h, low: velas.l, close: velas.c, volume: velas.v, time: velas.t, hl2, hlc3, ohlc4 };
        let obvAcum = 0; const obv = new Array(n);
        for (let i = 0; i < n; i++) { if (i > 0) obvAcum += velas.c[i] > velas.c[i - 1] ? velas.v[i] : velas.c[i] < velas.c[i - 1] ? -velas.v[i] : 0; obv[i] = obvAcum; }

        const falla = (msg, nd) => { throw new ErrorNLTS(msg, nd && nd.linea); };
        const gasto = (nd) => { if (++ops > MAX_OPS_POR_VELA) falla('El script hace demasiadas operaciones por vela (¿un bucle muy grande?).', nd); };

        // ── entorno ──
        const locales = [];                  // pila de Map (bloques y funciones)
        function buscarLocal(nombre) { for (let i = locales.length - 1; i >= 0; i--) if (locales[i].has(nombre)) return locales[i]; return null; }
        function leerVar(nombre, nd) {
            const loc = buscarLocal(nombre);
            if (loc) return loc.get(nombre);
            if (globales.has(nombre)) return globales.get(nombre);
            if (Object.prototype.hasOwnProperty.call(SERIES, nombre)) return SERIES[nombre][barra];
            if (nombre === 'bar_index') return barra;
            if (nombre === 'na') return NA;
            if (nombre === 'last_bar_index') return n - 1;
            falla(`La variable «${nombre}» no existe.`, nd);
        }
        function leerHistoria(nombre, k, nd) {
            if (!Number.isInteger(k) || k < 0) falla('El índice [n] debe ser un entero mayor o igual a 0.', nd);
            if (k === 0) return leerVar(nombre, nd);
            const i = barra - k;
            if (i < 0) return NA;
            if (Object.prototype.hasOwnProperty.call(SERIES, nombre) && !globales.has(nombre) && !buscarLocal(nombre)) return SERIES[nombre][i];
            if (nombre === 'bar_index') return i;
            const h = hist.get(nombre);
            if (h && !buscarLocal(nombre)) { const v = h[i]; return v === undefined ? NA : v; }
            if (buscarLocal(nombre)) falla(`«${nombre}[${k}]» no se puede usar en una variable local; declárala fuera del bloque o función.`, nd);
            falla(`La variable «${nombre}» no existe.`, nd);
        }

        // ── evaluación ──
        function ev(nd) {
            gasto(nd);
            switch (nd.tipo) {
                case 'Num': return nd.v;
                case 'Str': return nd.v;
                case 'Bool': return nd.v;
                case 'Color': return aRGBA(nd.v);
                case 'Id': return leerVar(nd.n, nd);
                case 'Tupla': return nd.items.map(ev);
                case 'Un': {
                    const a = ev(nd.a);
                    if (nd.op === 'not') return a == null ? NA : !a;
                    if (a == null) return NA;
                    return nd.op === '-' ? -a : +a;
                }
                case 'Bin': return binario(nd);
                case 'Logico': {
                    const a = ev(nd.a);
                    if (nd.op === 'and') return a ? !!ev(nd.b) : false;
                    return a ? true : !!ev(nd.b);
                }
                case 'Ternario': return ev(nd.c) ? ev(nd.a) : ev(nd.b);
                case 'Indice': {
                    if (nd.a.tipo !== 'Id') falla('Solo se puede usar [n] sobre una variable (guarda el valor en una variable primero).', nd);
                    const k = ev(nd.i);
                    return leerHistoria(nd.a.n, k, nd);
                }
                case 'Miembro': return miembro(nd);
                case 'Llamada': return llamada(nd);
                case 'If': return ejecutarIf(nd);
                default: falla(`Expresión no soportada: ${nd.tipo}`, nd);
            }
        }
        function miembro(nd) {
            const ruta = rutaDe(nd);
            if (ruta === 'ta.tr') return tr[barra];
            if (ruta === 'ta.obv') return obv[barra];
            if (ruta === 'barstate.islast') return barra === n - 1;
            if (ruta === 'barstate.isfirst') return barra === 0;
            if (ruta === 'barstate.isconfirmed') return true;
            if (ruta === 'barstate.isrealtime') return false;
            if (ruta === 'barstate.ishistory') return barra < n - 1;
            if (ruta.startsWith('color.') && Object.prototype.hasOwnProperty.call(COLORES, ruta.slice(6))) return aRGBA(COLORES[ruta.slice(6)]);
            if (CONSTANTES[ruta] !== undefined) return CONSTANTES[ruta];
            if (ruta.startsWith('math.')) { const c = { 'math.pi': Math.PI, 'math.e': Math.E }[ruta]; if (c !== undefined) return c; }
            falla(`«${ruta}» no existe.`, nd);
        }
        const CONSTANTES = Object.create(null);
        ['line', 'histogram', 'columns', 'circles', 'stepline', 'cross', 'area', 'linebr'].forEach((s) => { CONSTANTES['plot.style_' + s] = s; });
        ['triangleup', 'triangledown', 'circle', 'cross', 'xcross', 'diamond', 'square', 'arrowup', 'arrowdown', 'labelup', 'labeldown', 'flag'].forEach((s) => { CONSTANTES['shape.' + s] = s; });
        ['abovebar', 'belowbar', 'top', 'bottom', 'absolute'].forEach((s) => { CONSTANTES['location.' + s] = s; });
        ['solid', 'dashed', 'dotted'].forEach((s) => { CONSTANTES['hline.style_' + s] = s; });
        ['dashed', 'dotted', 'solid'].forEach((s) => { CONSTANTES['line.style_' + s] = s; });
        function rutaDe(nd) {
            if (nd.tipo === 'Id') return nd.n;
            if (nd.tipo === 'Miembro') return `${rutaDe(nd.a)}.${nd.n}`;
            falla('Expresión no válida aquí.', nd);
        }
        function binario(nd) {
            const a = ev(nd.a), b = ev(nd.b);
            switch (nd.op) {
                case '==': return a === b || (a == null && b == null);
                case '!=': return !(a === b || (a == null && b == null));
                case '<': return a == null || b == null ? false : a < b;
                case '>': return a == null || b == null ? false : a > b;
                case '<=': return a == null || b == null ? false : a <= b;
                case '>=': return a == null || b == null ? false : a >= b;
                case '+': if (typeof a === 'string' || typeof b === 'string') return String(a == null ? 'na' : a) + String(b == null ? 'na' : b); // fallthrough
                case '-': case '*': case '/': case '%': {
                    if (a == null || b == null) return NA;
                    if (typeof a !== 'number' || typeof b !== 'number') falla(`No se puede usar «${nd.op}» con esos valores.`, nd);
                    if (nd.op === '+') return a + b;
                    if (nd.op === '-') return a - b;
                    if (nd.op === '*') return a * b;
                    if (nd.op === '/') return b === 0 ? NA : a / b;
                    return b === 0 ? NA : a % b;
                }
                default: falla('Operador no soportado.', nd);
            }
        }

        // ── sentencias ──
        const SIN = { fin: 0, brk: 1, cont: 2 };
        function ejecutarBloque(lista, nuevoAmbito) {
            if (nuevoAmbito) locales.push(new Map());
            let r = SIN.fin, ultimo = NA;
            try {
                for (const s of lista) {
                    const res = ejecutarSent(s);
                    if (res && res.control) { r = res.control; break; }
                    ultimo = res && 'valor' in res ? res.valor : ultimo;
                }
            } finally { if (nuevoAmbito) locales.pop(); }
            return { control: r, valor: ultimo };
        }
        function ejecutarIf(nd) {
            const c = ev(nd.cond);
            const rama = c ? nd.entonces : nd.sino;
            if (!rama) return NA;
            const r = ejecutarBloque(rama, true);
            if (r.control) { controlPendiente = r.control; }
            return r.valor;
        }
        let controlPendiente = 0;
        function asignar(nombre, valor, nd, op) {
            const loc = buscarLocal(nombre);
            let actual;
            if (loc) actual = loc.get(nombre); else if (globales.has(nombre)) actual = globales.get(nombre); else falla(`No puedes usar «:=» con «${nombre}»: primero créala con «${nombre} = ...».`, nd);
            let nuevo = valor;
            if (op !== ':=') {
                if (actual == null || valor == null) nuevo = NA;
                else nuevo = op === '+=' ? actual + valor : op === '-=' ? actual - valor : op === '*=' ? actual * valor : op === '/=' ? (valor === 0 ? NA : actual / valor) : (valor === 0 ? NA : actual % valor);
            }
            if (loc) loc.set(nombre, nuevo); else globales.set(nombre, nuevo);
        }
        function ejecutarSent(s) {
            gasto(s);
            switch (s.tipo) {
                case 'Expr': { const v = ev(s.expr); return { valor: v }; }
                case 'Decl': {
                    const enGlobal = locales.length === 0;
                    if (enGlobal) {
                        if (s.persistente) {
                            if (barra === 0 || !globales.has(s.nombre)) globales.set(s.nombre, ev(s.valor));
                        } else globales.set(s.nombre, ev(s.valor));
                    } else locales[locales.length - 1].set(s.nombre, ev(s.valor));
                    return { valor: enGlobal ? globales.get(s.nombre) : locales[locales.length - 1].get(s.nombre) };
                }
                case 'Asignar': asignar(s.nombre, ev(s.valor), s, s.op); return {};
                case 'Destructurar': {
                    const v = ev(s.valor);
                    if (!Array.isArray(v) || v.length < s.nombres.length) falla(`Esa llamada no devuelve ${s.nombres.length} valores.`, s);
                    s.nombres.forEach((nm, i) => { if (locales.length === 0) globales.set(nm, v[i]); else locales[locales.length - 1].set(nm, v[i]); });
                    return {};
                }
                case 'DefFuncion': funciones.set(s.nombre, s); return {};
                case 'If': {
                    controlPendiente = 0;
                    const v = ejecutarIf(s);
                    if (controlPendiente) { const c = controlPendiente; controlPendiente = 0; return { control: c }; }
                    return { valor: v };
                }
                case 'For': {
                    const d = ev(s.desde), h = ev(s.hasta), paso = s.paso ? ev(s.paso) : (d <= h ? 1 : -1);
                    if (![d, h, paso].every(esNum) || paso === 0) falla('Los límites del for deben ser números (y el paso distinto de 0).', s);
                    let iter = 0, ultimo = NA;
                    locales.push(new Map());
                    try {
                        for (let i = d; paso > 0 ? i <= h : i >= h; i += paso) {
                            if (++iter > MAX_ITER_BUCLE) falla('El bucle for hace demasiadas vueltas.', s);
                            locales[locales.length - 1].set(s.v, i);
                            const r = ejecutarBloque(s.cuerpo, true);
                            ultimo = r.valor;
                            if (r.control === SIN.brk) break;
                        }
                    } finally { locales.pop(); }
                    return { valor: ultimo };
                }
                case 'While': {
                    let iter = 0, ultimo = NA;
                    while (ev(s.cond)) {
                        if (++iter > MAX_ITER_BUCLE) falla('El bucle while hace demasiadas vueltas.', s);
                        const r = ejecutarBloque(s.cuerpo, true);
                        ultimo = r.valor;
                        if (r.control === SIN.brk) break;
                    }
                    return { valor: ultimo };
                }
                case 'Break': return { control: SIN.brk };
                case 'Continue': return { control: SIN.cont };
                default: falla(`Sentencia no soportada: ${s.tipo}`, s);
            }
        }

        // ── llamadas ──
        function estado(nd, init) {
            const clave = nd.id + '|' + ctxClave;
            let st = estados.get(clave);
            if (!st) { st = init ? init() : {}; st._barra = -1; estados.set(clave, st); }
            return st;
        }
        function argsDe(nd) {
            const a = nd.args.map(ev);
            const k = {};
            for (const nombre of Object.keys(nd.kwargs)) k[nombre] = ev(nd.kwargs[nombre]);
            return { a, k };
        }
        function llamada(nd) {
            const c = nd.callee;
            if (c.tipo === 'Id' && funciones.has(c.n)) return llamarUsuario(nd, funciones.get(c.n));
            const nombre = rutaDe(c);
            const f = BUILTIN[nombre];
            if (!f) falla(`La función «${nombre}» no existe.`, nd);
            const { a, k } = argsDe(nd);
            return f(nd, a, k);
        }
        function llamarUsuario(nd, def) {
            if (pila.length > 40) falla('Demasiadas llamadas anidadas (recursión).', nd);
            const { a, k } = argsDe(nd);
            const amb = new Map();
            def.params.forEach((p, i) => { amb.set(p, k[p] !== undefined ? k[p] : a[i]); });
            pila.push(def.nombre);
            const ctxAnterior = ctxClave;
            ctxClave = `${ctxClave}>${nd.id}`;
            const salvadas = locales.splice(0, locales.length);      // las funciones no ven las variables locales de quien las llama
            locales.push(amb);
            try {
                const r = ejecutarBloque(def.cuerpo, false);
                return r.valor;
            } finally { locales.length = 0; salvadas.forEach((m) => locales.push(m)); ctxClave = ctxAnterior; pila.pop(); }
        }

        // ── funciones incorporadas ──
        const num = (x) => (esNum(x) ? x : NA);
        const BUILTIN = Object.create(null);     // sin prototipo: «constructor», «__proto__», etc. no existen
        const def = (nombre, fn) => { BUILTIN[nombre] = fn; };

        // matemática
        const m1 = (nombre, f) => def(`math.${nombre}`, (nd, a) => (a[0] == null ? NA : num(f(a[0]))));
        m1('abs', Math.abs); m1('sqrt', (x) => (x < 0 ? NA : Math.sqrt(x))); m1('floor', Math.floor); m1('ceil', Math.ceil); m1('exp', Math.exp);
        m1('log', (x) => (x <= 0 ? NA : Math.log(x))); m1('log10', (x) => (x <= 0 ? NA : Math.log10(x))); m1('sign', Math.sign);
        m1('sin', Math.sin); m1('cos', Math.cos); m1('tan', Math.tan); m1('atan', Math.atan);
        def('math.round', (nd, a) => { if (a[0] == null) return NA; const d = a[1] || 0; const f = 10 ** d; return Math.round(a[0] * f) / f; });
        def('math.pow', (nd, a) => (a[0] == null || a[1] == null ? NA : num(a[0] ** a[1])));
        def('math.max', (nd, a) => { const v = a.filter((x) => x != null); return v.length < a.length ? NA : Math.max(...v); });
        def('math.min', (nd, a) => { const v = a.filter((x) => x != null); return v.length < a.length ? NA : Math.min(...v); });
        def('math.avg', (nd, a) => (a.some((x) => x == null) ? NA : a.reduce((s, x) => s + x, 0) / a.length));
        def('math.sum', (nd, a) => ventana(nd, a[0], a[1], (b) => b.reduce((s, x) => s + x, 0)));
        def('nz', (nd, a) => (a[0] == null || Number.isNaN(a[0]) ? (a[1] === undefined ? 0 : a[1]) : a[0]));
        def('na', (nd, a) => (a.length ? a[0] == null || Number.isNaN(a[0]) : NA));
        def('str.tostring', (nd, a) => (a[0] == null ? 'na' : typeof a[0] === 'number' && a[1] ? a[0].toFixed(Math.max(0, String(a[1]).split('.')[1] ? String(a[1]).split('.')[1].length : 0)) : String(a[0])));
        def('int', (nd, a) => (a[0] == null ? NA : Math.trunc(a[0])));
        def('float', (nd, a) => a[0]);

        // colores
        def('color.new', (nd, a) => aRGBA(a[0], a[1] || 0));
        def('color.rgb', (nd, a) => aRGBA(`rgb(${a[0]},${a[1]},${a[2]})`, a[3] || 0));
        def('color.from_gradient', (nd, a) => {
            const [v, lo, hi, c1, c2] = a;
            if (v == null) return NA;
            const t = hi === lo ? 0 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
            const p = (c) => { const m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(aRGBA(c)); return m ? [+m[1], +m[2], +m[3], +m[4]] : [0, 0, 0, 1]; };
            const x = p(c1), y = p(c2);
            return `rgba(${Math.round(x[0] + (y[0] - x[0]) * t)},${Math.round(x[1] + (y[1] - x[1]) * t)},${Math.round(x[2] + (y[2] - x[2]) * t)},${+(x[3] + (y[3] - x[3]) * t).toFixed(3)})`;
        });

        // ventana deslizante genérica: guarda los últimos `len` valores de la serie y calcula cuando hay suficientes
        function ventana(nd, v, len, f) {
            len = Math.max(1, Math.floor(len));
            const st = estado(nd, () => ({ buf: [] }));
            if (st._barra !== barra) { st.buf.push(v); if (st.buf.length > len) st.buf.shift(); st._barra = barra; st.res = undefined; }
            if (st.res !== undefined) return st.res;
            st.res = st.buf.length === len && st.buf.every((x) => x != null) ? num(f(st.buf)) : NA;
            return st.res;
        }
        const origen = (a, defecto) => (a[0] !== undefined && typeof a[0] === 'number' && a.length > 1 ? [a[0], a[1]] : [defecto, a[0]]);   // (len) o (src, len)
        def('ta.sma', (nd, a) => ventana(nd, a[0], a[1], (b) => b.reduce((s, x) => s + x, 0) / b.length));
        def('ta.wma', (nd, a) => ventana(nd, a[0], a[1], (b) => { let s = 0, w = 0; b.forEach((x, i) => { s += x * (i + 1); w += i + 1; }); return s / w; }));
        def('ta.stdev', (nd, a) => ventana(nd, a[0], a[1], (b) => { const m = b.reduce((s, x) => s + x, 0) / b.length; return Math.sqrt(b.reduce((s, x) => s + (x - m) ** 2, 0) / b.length); }));
        def('ta.highest', (nd, a) => { const [src, len] = a.length > 1 ? [a[0], a[1]] : [velas.h[barra], a[0]]; return ventana(nd, src, len, (b) => Math.max(...b)); });
        def('ta.lowest', (nd, a) => { const [src, len] = a.length > 1 ? [a[0], a[1]] : [velas.l[barra], a[0]]; return ventana(nd, src, len, (b) => Math.min(...b)); });
        function mediaExp(nd, v, len, alfa) {
            const st = estado(nd, () => ({ prev: NA, cont: 0, suma: 0 }));
            if (st._barra === barra) return st.res;
            st._barra = barra;
            if (v == null) { st.res = NA; return st.res; }
            if (st.prev == null) { st.cont++; st.suma += v; if (st.cont >= len) { st.prev = st.suma / len; st.res = st.prev; } else st.res = NA; }
            else { st.prev = alfa * v + (1 - alfa) * st.prev; st.res = st.prev; }
            return st.res;
        }
        def('ta.ema', (nd, a) => mediaExp(nd, a[0], Math.max(1, Math.floor(a[1])), 2 / (Math.floor(a[1]) + 1)));
        def('ta.rma', (nd, a) => mediaExp(nd, a[0], Math.max(1, Math.floor(a[1])), 1 / Math.floor(a[1])));
        def('ta.hma', (nd, a) => {
            const len = Math.floor(a[1]), st = estado(nd, () => ({ w1: [], w2: [], w3: [] }));
            if (st._barra === barra) return st.res;
            st._barra = barra;
            const wma = (buf, v, l) => { buf.push(v); if (buf.length > l) buf.shift(); if (buf.length < l || buf.some((x) => x == null)) return NA; let s = 0, w = 0; buf.forEach((x, i) => { s += x * (i + 1); w += i + 1; }); return s / w; };
            const half = wma(st.w1, a[0], Math.max(1, Math.floor(len / 2))), full = wma(st.w2, a[0], len);
            st.res = wma(st.w3, half == null || full == null ? NA : 2 * half - full, Math.max(1, Math.round(Math.sqrt(len))));
            return st.res;
        });
        def('ta.change', (nd, a) => { const len = a[1] === undefined ? 1 : a[1]; const st = estado(nd, () => ({ buf: [] })); if (st._barra !== barra) { st.buf.push(a[0]); if (st.buf.length > len + 1) st.buf.shift(); st._barra = barra; } return st.buf.length === len + 1 && st.buf[0] != null && a[0] != null ? a[0] - st.buf[0] : NA; });
        def('ta.mom', BUILTIN['ta.change']);
        def('ta.roc', (nd, a) => { const len = a[1]; const st = estado(nd, () => ({ buf: [] })); if (st._barra !== barra) { st.buf.push(a[0]); if (st.buf.length > len + 1) st.buf.shift(); st._barra = barra; } return st.buf.length === len + 1 && st.buf[0] ? ((a[0] - st.buf[0]) / st.buf[0]) * 100 : NA; });
        def('ta.tr', () => tr[barra]);
        def('ta.atr', (nd, a) => mediaExp(nd, tr[barra], Math.floor(a[0]), 1 / Math.floor(a[0])));
        def('ta.rsi', (nd, a) => {
            const len = Math.floor(a[1]), st = estado(nd, () => ({ prevV: NA, up: NA, dn: NA, cont: 0, su: 0, sd: 0 }));
            if (st._barra === barra) return st.res;
            st._barra = barra;
            const v = a[0];
            if (v == null || st.prevV == null) { st.prevV = v; st.res = NA; return NA; }
            const ch = v - st.prevV; st.prevV = v;
            const g = Math.max(ch, 0), p = Math.max(-ch, 0);
            if (st.up == null) { st.cont++; st.su += g; st.sd += p; if (st.cont >= len) { st.up = st.su / len; st.dn = st.sd / len; } }
            else { st.up = (st.up * (len - 1) + g) / len; st.dn = (st.dn * (len - 1) + p) / len; }
            st.res = st.up == null ? NA : st.dn === 0 ? 100 : 100 - 100 / (1 + st.up / st.dn);
            return st.res;
        });
        const cruce = (dir) => (nd, a) => {
            const st = estado(nd, () => ({ pa: NA, pb: NA }));
            if (st._barra === barra) return st.res;
            st._barra = barra;
            const [x, y] = a;
            let r = false;
            if (x != null && y != null && st.pa != null && st.pb != null) r = dir === 'up' ? x > y && st.pa <= st.pb : dir === 'down' ? x < y && st.pa >= st.pb : (x > y && st.pa <= st.pb) || (x < y && st.pa >= st.pb);
            st.pa = x; st.pb = y; st.res = r;
            return r;
        };
        def('ta.crossover', cruce('up')); def('ta.crossunder', cruce('down')); def('ta.cross', cruce('both'));
        def('ta.cum', (nd, a) => { const st = estado(nd, () => ({ s: 0 })); if (st._barra !== barra) { st._barra = barra; if (a[0] != null) st.s += a[0]; } return st.s; });
        def('ta.macd', (nd, a) => {
            const [src, f, s, g] = a;
            const rapida = BUILTIN['ta.ema'](subNodo(nd, 1), [src, f]), lenta = BUILTIN['ta.ema'](subNodo(nd, 2), [src, s]);
            const linea = rapida == null || lenta == null ? NA : rapida - lenta;
            const senal = BUILTIN['ta.ema'](subNodo(nd, 3), [linea, g]);
            return [linea, senal, linea == null || senal == null ? NA : linea - senal];
        });
        def('ta.bb', (nd, a) => {
            const [src, len, mult] = a;
            const base = BUILTIN['ta.sma'](subNodo(nd, 1), [src, len]), desv = BUILTIN['ta.stdev'](subNodo(nd, 2), [src, len]);
            return [base, base == null || desv == null ? NA : base + mult * desv, base == null || desv == null ? NA : base - mult * desv];
        });
        def('ta.stoch', (nd, a) => {
            const [c, h, l, len] = a;
            const hh = BUILTIN['ta.highest'](subNodo(nd, 1), [h, len]), ll = BUILTIN['ta.lowest'](subNodo(nd, 2), [l, len]);
            return hh == null || ll == null || hh === ll ? NA : ((c - ll) / (hh - ll)) * 100;
        });
        // llamadas internas a otras ta.*: cada una necesita su PROPIO estado, así que se les da un "nodo" distinto
        const subNodos = new Map();
        function subNodo(nd, k) { const clave = `${nd.id}.${k}`; let s = subNodos.get(clave); if (!s) { s = { id: clave, linea: nd.linea }; subNodos.set(clave, s); } return s; }
        def('ta.pivothigh', (nd, a) => pivote(nd, a, true));
        def('ta.pivotlow', (nd, a) => pivote(nd, a, false));
        function pivote(nd, a, alto) {
            const [src, izq, der] = a.length >= 3 ? a : [alto ? velas.h[barra] : velas.l[barra], a[0], a[1]];
            const st = estado(nd, () => ({ buf: [] }));
            if (st._barra !== barra) { st._barra = barra; st.buf.push(src); if (st.buf.length > izq + der + 1) st.buf.shift(); }
            if (st.buf.length < izq + der + 1) return NA;
            const c = st.buf[izq];
            if (c == null) return NA;
            for (let i = 0; i < st.buf.length; i++) { if (i === izq) continue; const x = st.buf[i]; if (x == null) return NA; if (alto ? x > c : x < c) return NA; if (i < izq && (alto ? x >= c : x <= c) && false) return NA; }
            return c;
        }
        def('ta.barssince', (nd, a) => { const st = estado(nd, () => ({ c: NA })); if (st._barra !== barra) { st._barra = barra; st.c = a[0] ? 0 : st.c == null ? NA : st.c + 1; } return st.c; });
        def('ta.valuewhen', (nd, a) => { const st = estado(nd, () => ({ vals: [] })); if (st._barra !== barra) { st._barra = barra; if (a[0]) st.vals.unshift(a[1]); } const k = a[2] || 0; return st.vals[k] === undefined ? NA : st.vals[k]; });
        def('ta.vwap', () => NA);
        def('ta.obv', () => obv[barra]);

        // entradas (inputs): se registran para que la interfaz arme el diálogo de configuración
        function entrada(tipo) {
            return (nd, a, k) => {
                const defecto = k.defval !== undefined ? k.defval : a[0];
                const titulo = k.title !== undefined ? k.title : (typeof a[1] === 'string' ? a[1] : 'Entrada');
                const clave = String(titulo);
                if (!inputsVistos.has(clave)) {
                    inputsVistos.add(clave);
                    out.inputs.push({ id: clave, tipo, def: defecto, titulo: clave, min: k.minval, max: k.maxval, step: k.step, opciones: k.options, grupo: k.group });
                }
                const usuario = Object.prototype.hasOwnProperty.call(inputsUsuario, clave) ? inputsUsuario[clave] : undefined;
                if (usuario === undefined) return defecto;
                if (tipo === 'int') return Math.round(Number(usuario));
                if (tipo === 'float') return Number(usuario);
                if (tipo === 'bool') return !!usuario;
                return usuario;
            };
        }
        ['int', 'float', 'bool', 'string', 'color', 'timeframe'].forEach((t) => def(`input.${t}`, entrada(t)));
        def('input.source', (nd, a, k) => { const v = k.defval !== undefined ? k.defval : a[0]; return v; });
        def('input', (nd, a, k) => entrada(typeof a[0] === 'boolean' ? 'bool' : Number.isInteger(a[0]) ? 'int' : typeof a[0] === 'number' ? 'float' : 'string')(nd, a, k));

        // salidas
        def('indicator', (nd, a, k) => { out.meta.titulo = String(k.title !== undefined ? k.title : (a[0] || 'Script')); out.meta.overlay = !!k.overlay; if (k.precision != null) out.meta.precision = k.precision; return NA; });
        BUILTIN.study = BUILTIN.indicator;
        def('plot', (nd, a, k) => {
            const titulo = String(k.title !== undefined ? k.title : (typeof a[1] === 'string' ? a[1] : `Plot ${plotsPorClave.size + 1}`));
            let p = plotsPorClave.get(nd.id);
            if (!p) {
                if (plotsPorClave.size >= MAX_PLOTS) falla(`Máximo ${MAX_PLOTS} plots por script.`, nd);
                p = { titulo, color: null, grosor: 1, estilo: 'line', valores: new Array(n).fill(NA), colores: new Array(n).fill(NA), offset: k.offset || 0 };
                plotsPorClave.set(nd.id, p); out.plots.push(p);
            }
            p.valores[barra] = a[0] == null || Number.isNaN(a[0]) ? NA : a[0];
            const col = k.color !== undefined ? k.color : (typeof a[2] === 'string' ? a[2] : null);
            p.colores[barra] = col == null ? NA : col;
            p.grosor = k.linewidth !== undefined ? k.linewidth : 1;
            p.estilo = k.style !== undefined ? k.style : 'line';
            return NA;
        });
        def('hline', (nd, a, k) => {
            if (!out.hlines.some((h) => h._id === nd.id)) out.hlines.push({ _id: nd.id, precio: a[0], titulo: String(k.title || ''), color: k.color || aRGBA('#787B86'), estilo: k.linestyle || 'dashed' });
            return NA;
        });
        def('bgcolor', (nd, a) => {
            let b = out.bgcolors.find((x) => x._id === nd.id);
            if (!b) { b = { _id: nd.id, colores: new Array(n).fill(NA) }; out.bgcolors.push(b); }
            b.colores[barra] = a[0] == null ? NA : a[0];
            return NA;
        });
        def('plotshape', (nd, a, k) => {
            if (a[0] && out.shapes.length < MAX_SHAPES) out.shapes.push({ barra, estilo: k.style || 'circle', ubicacion: k.location || 'abovebar', color: k.color || aRGBA('#2962FF'), texto: k.text == null ? '' : String(k.text), titulo: String(k.title || '') });
            return NA;
        });
        BUILTIN.plotchar = BUILTIN.plotshape;
        def('alertcondition', (nd, a, k) => {
            let al = out.alerts.find((x) => x._id === nd.id);
            if (!al) { al = { _id: nd.id, titulo: String(k.title || a[1] || 'Alerta'), mensaje: String(k.message || a[2] || ''), barras: [] }; out.alerts.push(al); }
            if (a[0]) al.barras.push(barra);
            return NA;
        });
        def('log.info', () => NA);

        // ── corrida ──
        // 1) funciones definidas (se registran antes de correr, como en Pine)
        prog.forEach((s) => { if (s.tipo === 'DefFuncion') funciones.set(s.nombre, s); });
        for (barra = 0; barra < n; barra++) {
            ops = 0; pila = []; ctxClave = ''; locales.length = 0; controlPendiente = 0;
            for (const s of prog) { ejecutarSent(s); }
            // al terminar la vela, cada variable global guarda su valor final para poder usar x[1], x[2]...
            for (const [nombre, valor] of globales) {
                let h = hist.get(nombre);
                if (!h) { h = new Array(n); hist.set(nombre, h); }
                h[barra] = valor;
            }
        }
        out.plots.forEach((p) => { delete p.offset; });
        out.hlines.forEach((h) => { delete h._id; });
        out.bgcolors.forEach((b) => { delete b._id; });
        out.alerts.forEach((a) => { delete a._id; });
        return out;
    }

    // ───────────── scripts protegidos: se entrega el árbol ya compilado, no el texto ─────────────
    // El creador compila en su navegador y el servidor guarda el árbol (JSON). Quien compra recibe SOLO el árbol (sin comentarios ni
    // formato); como viene de otra persona, antes de ejecutarlo se valida forma por forma: solo nodos conocidos, con sus campos exactos.
    const ESQUEMA = {
        Asignar: { nombre: 's', op: 's', valor: 'n' }, Bin: { op: 's', a: 'n', b: 'n' }, Bool: { v: 'b' }, Color: { v: 's' }, Break: {}, Continue: {},
        Decl: { nombre: 's', valor: 'n', persistente: 'b' }, DefFuncion: { nombre: 's', params: 'S', cuerpo: 'L' }, Destructurar: { nombres: 'S', valor: 'n' },
        Expr: { expr: 'n' }, For: { v: 's', desde: 'n', hasta: 'n', paso: 'N', cuerpo: 'L' }, Id: { n: 's' }, If: { cond: 'n', entonces: 'L', sino: 'LN' },
        Indice: { a: 'n', i: 'n' }, Llamada: { callee: 'n', args: 'L', kwargs: 'K' }, Logico: { op: 's', a: 'n', b: 'n' }, Miembro: { a: 'n', n: 's' },
        Num: { v: 'x' }, Str: { v: 's' }, Ternario: { c: 'n', a: 'n', b: 'n' }, Tupla: { items: 'L' }, Un: { op: 's', a: 'n' }, While: { cond: 'n', cuerpo: 'L' },
    };
    const MAX_NODOS_AST = 200000, MAX_PROFUNDIDAD_AST = 200;
    function validarAst(prog) {
        const mal = () => new ErrorNLTS('Este script protegido está dañado o es de una versión incompatible.');
        let cuenta = 0;
        const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
        function nodoOk(nd, prof) {
            if (prof > MAX_PROFUNDIDAD_AST || ++cuenta > MAX_NODOS_AST) throw mal();
            if (!nd || typeof nd !== 'object' || Array.isArray(nd) || typeof nd.tipo !== 'string' || !own(ESQUEMA, nd.tipo)) throw mal();
            if (!Number.isInteger(nd.id) || nd.id < 0 || !(nd.linea === null || Number.isInteger(nd.linea))) throw mal();
            const esq = ESQUEMA[nd.tipo], claves = Object.keys(nd).filter((k) => k !== 'tipo' && k !== 'linea' && k !== 'id');
            if (claves.length !== Object.keys(esq).length) throw mal();
            for (const k of claves) {
                if (!own(esq, k)) throw mal();
                const t = esq[k], v = nd[k];
                if (t === 'n') nodoOk(v, prof + 1);
                else if (t === 'N') { if (v !== null) nodoOk(v, prof + 1); }
                else if (t === 'L') lista(v, prof);
                else if (t === 'LN') { if (v !== null) lista(v, prof); }
                else if (t === 's') { if (typeof v !== 'string' || v.length > 5000) throw mal(); }
                else if (t === 'b') { if (typeof v !== 'boolean') throw mal(); }
                else if (t === 'x') { if (typeof v !== 'number' || !Number.isFinite(v)) throw mal(); }
                else if (t === 'S') { if (!Array.isArray(v) || v.length > 100 || v.some((x) => typeof x !== 'string' || x.length > 100)) throw mal(); }
                else if (t === 'K') {
                    if (!v || typeof v !== 'object' || Array.isArray(v)) throw mal();
                    const ks = Object.keys(v); if (ks.length > 50) throw mal();
                    ks.forEach((kk) => nodoOk(v[kk], prof + 1));
                }
            }
        }
        function lista(l, prof) { if (!Array.isArray(l) || l.length > 20000) throw mal(); l.forEach((x) => nodoOk(x, prof + 1)); }
        lista(prog, 0);
        return prog;
    }
    /** Compila el texto a su árbol (JSON puro) para guardarlo junto al script protegido. */
    function compilar(codigo) {
        if (String(codigo).length > 100000) throw new ErrorNLTS('El script es demasiado largo (máximo 100.000 caracteres).');
        const prog = parsear(codigo);
        if (!prog.length) throw new ErrorNLTS('El script está vacío.');
        const ast = JSON.parse(JSON.stringify(prog));
        validarAst(ast);
        return ast;
    }

    // API pública
    function ejecutar(codigo, velas, opciones) {
        const n = velas && velas.c ? velas.c.length : 0;
        try {
            if (String(codigo).length > 100000) throw new ErrorNLTS('El script es demasiado largo (máximo 100.000 caracteres).');
            // con ast: el script viene protegido (sin texto); se valida antes de correrlo
            const prog = opciones && opciones.ast ? validarAst(opciones.ast) : parsear(codigo);
            if (!prog.length) throw new ErrorNLTS('El script está vacío.');
            const r = ejecutarPrograma(prog, velas, opciones || {});
            return { ok: true, n, ...r };
        } catch (e) {
            if (e instanceof ErrorNLTS) return { ok: false, n, errores: [{ linea: e.linea, mensaje: e.message }], meta: {}, inputs: [], plots: [], hlines: [], bgcolors: [], shapes: [], alerts: [] };
            return { ok: false, n, errores: [{ linea: null, mensaje: 'Error interno del intérprete: ' + (e && e.message ? e.message : e) }], meta: {}, inputs: [], plots: [], hlines: [], bgcolors: [], shapes: [], alerts: [] };
        }
    }
    /** Solo valida la sintaxis (sin correr): devuelve la lista de errores. */
    function validar(codigo) {
        try { parsear(codigo); return []; } catch (e) { return [{ linea: e.linea || null, mensaje: e.message }]; }
    }

    const API = { ejecutar, validar, parsear, compilar, validarAst, lex, ErrorNLTS, COLORES };
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    global.NLTS = API;
})(typeof self !== 'undefined' ? self : this);
