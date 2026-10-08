/* NLT Script -- lenguaje de indicadores de NLT Charts (parecido a Pine Script v5, con su propio intérprete).
 *
 * Este archivo es el LENGUAJE: lexer, parser e intérprete. No toca el DOM, la red ni el gráfico, y nunca ejecuta el código del
 * usuario como JavaScript (no hay eval): el script se interpreta con un recorrido del árbol sintáctico, con límite de operaciones
 * por vela. En el navegador corre además dentro de un Web Worker (nlts-worker.js) que se puede matar por tiempo. Así un script
 * de un tercero no puede leer la sesión, la cuenta ni salir a internet.
 *
 * Qué entiende (Pine Script v5, salvo lo indicado abajo):
 *   indicator()/strategy() encabezado · x = expr | x := expr | var/varip · tipos (float x, series int n, array<float> a)
 *   [a, b] = f()  ·  if/else if/else · for i = a to b by s · for x in lista · while · switch · ternario · break/continue
 *   f(x, int k = 2) => ... (funciones propias, con historia x[1] en parámetros y locales) · e[1] sobre cualquier expresión
 *   request.security(símbolo, temporalidad, expresión) con los datos que entrega la página (sin mirar el futuro, con lookahead_on opcional)
 *   input.* · plot/plotshape/plotchar/plotcandle/plotarrow/hline/bgcolor/fill/alertcondition/alert
 *   label/line/box/table (.new, .set_*, .delete) · array.* (también a.push(x)) · str.* · math.* · color.* · timeframe.* · syminfo.*
 *   ta.*: sma ema rma wma vwma swma hma alma linreg rsi atr tr stdev variance dev median highest lowest change mom roc crossover/under cross cum
 *         macd bb bbw kc kcw stoch cci mfi cmo tsi wpr dmi supertrend vwap pivothigh pivotlow barssince valuewhen percentrank correlation
 *         highestbars lowestbars rising falling range max min obv  (y los alias de Pine v4: sma(), crossover()…)
 *   NO soporta todavía: órdenes de estrategias (strategy.entry/exit se aceptan sin efecto y se avisa), barcolor, type, map, matrix, bibliotecas.
 *
 * Uso:  NLTS.ejecutar(codigo, velas, { inputs: {...} })  ->  { ok, meta, inputs, plots, hlines, bgcolors, shapes, alerts, errores }
 *       velas = { t: [], o: [], h: [], l: [], c: [], v: [] }  (arrays del mismo largo) */
(function (global) {
    'use strict';

    const MAX_OPS_POR_VELA = 60000;       // protege de bucles enormes: pasado esto, el script se detiene con un error claro
    const MAX_ITER_BUCLE = 100000;
    const MAX_PLOTS = 64, MAX_SHAPES = 20000;

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
                // Como en Pine: una línea más sangrada que el bloque y con sangría que NO es múltiplo de 4 continúa la línea anterior
                if (ind > indentStack[indentStack.length - 1] && ind % 4 !== 0 && toks.length && toks[toks.length - 1].tipo === 'NEWLINE') { toks.pop(); continuar = true; }
            }
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
            continuar = false;
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
            while (!es('DEDENT') && !es('EOF')) { out.push(...sentencias()); saltarNL(); }
            esperar('DEDENT');
            return out;
        }
        // Cuerpo de if/for/función: en la misma línea (una expresión) o un bloque indentado.
        function cuerpo() {
            if (es('NEWLINE')) return bloque();
            return sentencias(true);
        }
        const CALIFICADORES = new Set(['series', 'simple', 'const', 'input']);
        /** Cuántos tokens ocupa un tipo escrito antes de un nombre («float», «series int», «array<float>»…); 0 si no hay tipo. */
        function tokensDeTipo(k0) {
            let k = k0;
            if (T[k].tipo === 'ID' && CALIFICADORES.has(T[k].valor) && T[k + 1].tipo === 'ID') k++;
            if (T[k].tipo !== 'ID') return 0;
            k++;
            while (T[k].tipo === 'OP' && T[k].valor === '.' && T[k + 1].tipo === 'ID') k += 2;     // chart.point
            if (T[k].tipo === 'OP' && T[k].valor === '<') {                                           // array<float>, map<string, float>
                let prof = 1; k++;
                while (prof > 0 && T[k].tipo !== 'EOF' && T[k].tipo !== 'NEWLINE') { if (T[k].tipo === 'OP' && T[k].valor === '<') prof++; if (T[k].tipo === 'OP' && T[k].valor === '>') prof--; k++; }
                if (prof !== 0) return 0;
            }
            while (T[k].tipo === 'OP' && T[k].valor === '[' && T[k + 1].tipo === 'OP' && T[k + 1].valor === ']') k += 2;   // float[], line[]
            return T[k].tipo === 'ID' ? k - k0 : 0;
        }
        let cola = [];
        /** Una sentencia (o varias si la línea declara con comas: «float a = 0.0, float b = 1.0»). */
        function sentencias(enLinea) { cola = []; const r = sentencia(enLinea); const extra = cola; cola = []; return [r, ...extra]; }
        function sentencia(enLinea) {
            const t = ver(), linea = t.linea;
            let r;
            if (es('ID') && (t.valor === 'import') && T[p + 1].tipo === 'ID') { while (!es('NEWLINE') && !es('EOF')) p++; return nodo('Expr', linea, { expr: nodo('Id', linea, { n: 'na' }) }); }
            if (es('ID') && t.valor === 'type' && T[p + 1].tipo === 'ID' && (T[p + 2].tipo === 'NEWLINE')) throw new ErrorNLTS('Los tipos propios («type») todavía no están soportados en NLT Script.', linea);
            if (es('ID') && (t.valor === 'export' || t.valor === 'method') && T[p + 1].tipo === 'ID' && T[p + 2].tipo === 'OP' && T[p + 2].valor === '(') p++;
            if (kw('if')) r = sentenciaIf();
            else if (kw('for')) r = sentenciaFor();
            else if (kw('while')) { sig(); const cond = expr(); r = nodo('While', linea, { cond, cuerpo: cuerpo() }); }
            else if (kw('break') || kw('continue')) { sig(); r = nodo(t.valor === 'break' ? 'Break' : 'Continue', linea, {}); }
            else if (kw('var') || kw('varip')) { sig(); p += tokensDeTipo(p); const nombre = esperar('ID').valor; esperar('OP', '=', 'Falta «=» después del nombre de la variable.'); r = nodo('Decl', linea, { nombre, valor: expr(), persistente: true }); }
            else if (op('[') && esDestructurar()) {
                sig(); const nombres = [esperar('ID').valor];
                while (op(',')) { sig(); nombres.push(esperar('ID').valor); }
                esperar('OP', ']'); esperar('OP', '=');
                r = nodo('Destructurar', linea, { nombres, valor: expr() });
            } else if (es('ID') && T[p + 1].tipo === 'OP' && T[p + 1].valor === '(' && esDefFuncion()) {
                const nombre = sig().valor; sig();
                const params = [], defectos = [];
                while (!op(')')) {
                    p += tokensDeTipo(p);
                    params.push(esperar('ID').valor);
                    if (op('=')) { sig(); defectos.push(expr()); } else defectos.push(nodo('Id', linea, { n: 'na' }));
                    if (op(',')) sig(); else break;
                }
                esperar('OP', ')'); esperar('OP', '=>');
                r = nodo('DefFuncion', linea, { nombre, params, defectos, cuerpo: cuerpo() });
            } else if (es('ID') && T[p + 1].tipo === 'OP' && ['=', ':=', '+=', '-=', '*=', '/=', '%='].includes(T[p + 1].valor)) {
                const nombre = sig().valor, o = sig().valor;
                const v = expr();
                r = o === '=' ? nodo('Decl', linea, { nombre, valor: v, persistente: false }) : nodo('Asignar', linea, { nombre, op: o, valor: v });
            } else if (es('ID') && tokensDeTipo(p) > 0 && T[p + tokensDeTipo(p) + 1].tipo === 'OP' && ['=', ':='].includes(T[p + tokensDeTipo(p) + 1].valor)) {
                // declaración con tipo: «float x = 1», «series int n = 3», «array<float> a = ...»
                p += tokensDeTipo(p);
                const nombre = sig().valor, o = sig().valor;
                r = nodo('Decl', linea, { nombre, valor: expr(), persistente: false });
            } else r = nodo('Expr', linea, { expr: expr() });
            // declaraciones encadenadas con comas
            while (r.tipo === 'Decl' && op(',')) {
                const k = p + 1, n = tokensDeTipo(k), j = k + n;
                if (!(T[j].tipo === 'ID' && T[j + 1].tipo === 'OP' && T[j + 1].valor === '=')) break;
                p = j; const nombre = sig().valor; sig();
                cola.push(nodo('Decl', linea, { nombre, valor: expr(), persistente: r.persistente }));
            }
            // if/for/while/función ya consumieron su cuerpo (en bloque o en la misma línea) y con él su fin de línea
            const cerroBloque = (T[p - 1] && T[p - 1].tipo === 'DEDENT') || ['If', 'For', 'ForIn', 'While', 'DefFuncion'].includes(r.tipo);
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
        function sentenciaSwitch() {
            const linea = sig().linea;
            const sujeto = es('NEWLINE') ? null : expr();
            esperar('NEWLINE', undefined, 'Después de «switch» van los casos, uno por línea e indentados.');
            saltarNL();
            esperar('INDENT', undefined, 'Los casos del switch deben ir indentados.');
            const casos = [];
            saltarNL();
            while (!es('DEDENT') && !es('EOF')) {
                const l = ver().linea;
                let cond = null;
                if (op('=>')) { sig(); } else { cond = expr(); esperar('OP', '=>', 'En un switch cada caso va «valor => resultado».'); }
                casos.push(nodo('Caso', l, { cond, cuerpo: cuerpo() }));
                saltarNL();
            }
            esperar('DEDENT');
            return nodo('Switch', linea, { sujeto, casos });
        }
        function sentenciaFor() {
            const linea = sig().linea;
            if (op('[')) {                                    // for [i, x] in lista
                sig(); const v1 = esperar('ID').valor; esperar('OP', ','); const v2 = esperar('ID').valor; esperar('OP', ']'); esperar('KW', 'in');
                const iter = expr();
                return nodo('ForIn', linea, { v: v1, v2, iter, cuerpo: cuerpo() });
            }
            const v = esperar('ID').valor;
            if (kw('in')) { sig(); const iter = expr(); return nodo('ForIn', linea, { v, v2: '', iter, cuerpo: cuerpo() }); }
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
                else if (op('<') && a.tipo === 'Miembro' && esLlamadaGenerica()) {        // array.new<float>(5): el tipo entre <> se ignora
                    let prof = 1; sig();
                    while (prof > 0) { if (op('<')) prof++; if (op('>')) prof--; sig(); }
                }
                else break;
            }
            return a;
        }
        function esLlamadaGenerica() {
            let k = p + 1;
            while (T[k].tipo === 'ID' || (T[k].tipo === 'OP' && (T[k].valor === ',' || T[k].valor === '.'))) k++;
            return T[k].tipo === 'OP' && T[k].valor === '>' && T[k + 1].tipo === 'OP' && T[k + 1].valor === '(' && k > p + 1;
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
            if (kw('switch')) return sentenciaSwitch();
            if (t.tipo === 'EOF' || t.tipo === 'NEWLINE') throw new ErrorNLTS('Falta completar la expresión (la línea termina antes de tiempo).', t.linea);
            throw new ErrorNLTS(`No entiendo «${t.valor == null ? t.tipo : t.valor}» aquí.`, t.linea);
        }

        const prog = [];
        saltarNL();
        while (!es('EOF')) {
            if (es('INDENT')) throw new ErrorNLTS('Indentación inesperada.', ver().linea);
            prog.push(...sentencias()); saltarNL();
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

    // ───────────────────────────── tiempo y temporalidades ─────────────────────────────
    const FECHA_PARTES = ['year', 'month', 'dayofmonth', 'hour', 'minute', 'second', 'weekofyear'];
    function fechaParte(nombre, t) {
        if (t == null || !Number.isFinite(t)) return null;
        const d = new Date(t);
        switch (nombre) {
            case 'year': return d.getUTCFullYear();
            case 'month': return d.getUTCMonth() + 1;
            case 'dayofmonth': return d.getUTCDate();
            case 'dayofweek': return d.getUTCDay() + 1;          // domingo = 1, como en Pine
            case 'hour': return d.getUTCHours();
            case 'minute': return d.getUTCMinutes();
            case 'second': return d.getUTCSeconds();
            case 'weekofyear': { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const dia = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - dia); const ini = Date.UTC(x.getUTCFullYear(), 0, 1); return Math.ceil(((x - ini) / 86400000 + 1) / 7); }
            default: return null;
        }
    }
    const TF_MS = { '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '30m': 1800000, '45m': 2700000, '1H': 3600000, '2H': 7200000, '4H': 14400000, '1D': 86400000, '1W': 604800000 };
    const TF_PINE = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '45m': '45', '1H': '60', '2H': '120', '4H': '240', '1D': 'D', '1W': 'W' };
    const TF_ALIAS = { '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m', '45': '45m', '60': '1H', '120': '2H', '240': '4H', 'D': '1D', '1D': '1D', 'W': '1W', '1W': '1W', '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '45m': '45m', '1H': '1H', '2H': '2H', '4H': '4H', '1h': '1H', '4h': '4H', 'd': '1D' };
    /** Para cada vela del gráfico, índice de la vela de la otra temporalidad cuyo valor se le entrega (-1 si todavía no hay).
     *  Sin lookahead: la última vela ya CERRADA (no mira el futuro). Con lookahead_on: la que contiene a la vela (como TradingView). */
    function mapear(tc, chartMs, th, hMs, lookahead) {
        const m = new Int32Array(tc.length).fill(-1);
        let j = -1;
        for (let i = 0; i < tc.length; i++) {
            if (lookahead) { while (j + 1 < th.length && th[j + 1] <= tc[i]) j++; m[i] = j >= 0 && tc[i] < th[j] + hMs ? j : -1; }
            else { const cierre = tc[i] + chartMs; while (j + 1 < th.length && th[j + 1] + hMs <= cierre) j++; m[i] = j; }
        }
        // la última vela del gráfico ve la vela abierta de la otra temporalidad en desarrollo (como en TradingView)
        if (!lookahead && tc.length) { const i = tc.length - 1; if (j + 1 < th.length && th[j + 1] <= tc[i] && (Date.now() - tc[i]) < 3 * Math.max(hMs, chartMs)) m[i] = j + 1; }
        return m;
    }
    // Espacios de nombres cuyas constantes (position.top_right, size.small…) se devuelven como texto
    const NS_LIBRES = new Set(['position', 'size', 'text', 'extend', 'xloc', 'yloc', 'display', 'barmerge', 'format', 'currency', 'scale', 'alert', 'font', 'order', 'adjustment', 'settlement', 'label', 'line', 'box', 'table', 'plot', 'hline', 'shape', 'location', 'strategy', 'session']);
    const NOMBRE_CONSTANTE = /^[a-z][a-z0-9_]*$/i, PROHIBIDOS = new Set(['constructor', 'prototype', '__proto__', 'tostring', 'valueof', 'hasownproperty']);
    const NS_FUNCIONES = new Set(['ta', 'math', 'str', 'array', 'color', 'input', 'request', 'label', 'line', 'box', 'table', 'strategy', 'timeframe', 'syminfo', 'barstate', 'ticker', 'alert', 'log', 'runtime', 'matrix', 'map', 'chart', 'session', 'linefill', 'polyline', 'plot', 'hline', 'position', 'size', 'text', 'xloc', 'yloc', 'extend', 'display', 'barmerge', 'format', 'currency', 'scale', 'location', 'shape', 'dayofweek', 'order']);

    // ───────────────────────────── intérprete ─────────────────────────────
    const esNum = (x) => typeof x === 'number' && Number.isFinite(x);
    const NA = null;

    function ejecutarPrograma(prog, velas, opciones) {
        const n = velas.c.length;
        opciones = opciones || {};
        const inputsUsuario = opciones.inputs || {};
        const chart = opciones.chart || {};                  // { symbol, tf: '15m', tfMs, tipo, precision, tfs: [...disponibles] }
        const captura = opciones.captura || null;            // si existe, este motor corre OTRA temporalidad para un request.security
        const esSub = !!captura;
        const necesita = new Map();                          // datos de otras temporalidades que faltan
        const subs = new Map();
        const out = { meta: { titulo: 'Script', overlay: false, precision: null, maxEtiquetas: 50, maxLineas: 50, maxCajas: 50 }, inputs: [], plots: [], hlines: [], fills: [], bgcolors: [], shapes: [], alerts: [], velasPropias: [], etiquetas: [], lineas: [], cajas: [], tablas: [], avisos: [], errores: [] };
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
        const hlcc4 = velas.c.map((c, i) => (velas.h[i] + velas.l[i] + 2 * c) / 4);
        const SERIES = { __proto__: null, open: velas.o, high: velas.h, low: velas.l, close: velas.c, volume: velas.v, time: velas.t, hl2, hlc3, ohlc4, hlcc4 };
        let obvAcum = 0; const obv = new Array(n);
        for (let i = 0; i < n; i++) { if (i > 0) obvAcum += velas.c[i] > velas.c[i - 1] ? velas.v[i] : velas.c[i] < velas.c[i - 1] ? -velas.v[i] : 0; obv[i] = obvAcum; }

        const falla = (msg, nd) => { throw new ErrorNLTS(msg, nd && nd.linea); };
        const gasto = (nd) => { if (++ops > MAX_OPS_POR_VELA) falla('El script hace demasiadas operaciones por vela (¿un bucle muy grande?).', nd); };

        // ── datos del símbolo y la temporalidad (syminfo.*, timeframe.*) ──
        const tfMsChart = chart.tfMs || 0;
        function datoDeSimbolo(ruta) {
            const sym = chart.symbol || 'SIMBOLO';
            switch (ruta) {
                case 'syminfo.tickerid': case 'syminfo.ticker': case 'syminfo.root': case 'syminfo.description': return sym;
                case 'syminfo.prefix': return '';
                case 'syminfo.currency': return sym.length >= 6 ? sym.slice(3, 6) : 'USD';
                case 'syminfo.basecurrency': return sym.slice(0, 3);
                case 'syminfo.type': return chart.tipo || 'forex';
                case 'syminfo.mintick': return chart.precision != null ? Number(`1e-${chart.precision}`) : 0.00001;
                case 'syminfo.pointvalue': return 1;
                case 'syminfo.timezone': return 'UTC';
                case 'syminfo.session': return 'regular';
                case 'timeframe.period': return TF_PINE[chart.tf] || chart.tf || '';
                case 'timeframe.multiplier': { const pn = TF_PINE[chart.tf]; return /^\d+$/.test(pn || '') ? Number(pn) : 1; }
                case 'timeframe.isintraday': return tfMsChart > 0 && tfMsChart < 86400000;
                case 'timeframe.isdaily': return tfMsChart === 86400000;
                case 'timeframe.isweekly': return tfMsChart === 604800000;
                case 'timeframe.ismonthly': case 'timeframe.isseconds': return false;
                case 'timeframe.isdwm': return tfMsChart >= 86400000;
                case 'barstate.isnew': return true;
                case 'barstate.islastconfirmedhistory': return barra === n - 1;
                case 'chart.bg_color': return aRGBA('#080A0F');
                case 'chart.fg_color': return aRGBA('#FFFFFF');
                case 'chart.is_standard': return true;
                case 'chart.is_heikinashi': case 'chart.is_renko': case 'chart.is_kagi': case 'chart.is_linebreak': case 'chart.is_pnf': case 'chart.is_range': return false;
                case 'strategy.position_size': case 'strategy.equity': case 'strategy.netprofit': case 'strategy.opentrades': case 'strategy.closedtrades': case 'strategy.position_avg_price': return 0;
                case 'strategy.long': return 'long';
                case 'strategy.short': return 'short';
                default: break;
            }
            const dia = /^dayofweek\.(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(ruta);
            if (dia) return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(dia[1]) + 1;
            if (ruta === 'barmerge.lookahead_on' || ruta === 'barmerge.gaps_on') return true;
            if (ruta === 'barmerge.lookahead_off' || ruta === 'barmerge.gaps_off') return false;
            return undefined;
        }
        const disponibles = chart.tfs && chart.tfs.length ? chart.tfs : ['1m', '5m', '15m', '30m', '1H', '4H', '1D'];
        function normTf(v, nd) {
            if (v == null || v === '') return chart.tf;
            const id = TF_ALIAS[String(v)];
            if (!id || !disponibles.includes(id)) falla(`La temporalidad «${v}» no está disponible en NLT Charts (disponibles: ${disponibles.join(', ')}).`, nd);
            return id;
        }
        function normSimbolo(v) {
            if (v == null || v === '') return chart.symbol;
            const t = String(v).split(':').pop().toUpperCase();
            return t || chart.symbol;
        }
        function correrSub(clave, sym, tfId, d) {
            const tfMs = TF_MS[tfId];
            const cap = { clave, valores: new Map() };
            ejecutarPrograma(prog, d, { inputs: inputsUsuario, chart: { symbol: sym, tf: tfId, tfMs, tipo: chart.tipo, precision: chart.precision, tfs: chart.tfs }, captura: cap });
            return { valores: cap.valores, mapaOn: mapear(velas.t, tfMsChart, d.t, tfMs, true), mapaOff: mapear(velas.t, tfMsChart, d.t, tfMs, false) };
        }
        /** request.security(símbolo, temporalidad, expresión): la expresión se evalúa sobre las velas de OTRA temporalidad/símbolo. */
        function seguridad(nd) {
            const arg = (i, nom) => (nd.kwargs[nom] !== undefined ? nd.kwargs[nom] : nd.args[i]);
            const nSym = arg(0, 'symbol'), nTf = arg(1, 'timeframe'), nExpr = arg(2, 'expression');
            if (!nSym || !nTf || !nExpr) falla('request.security necesita (símbolo, temporalidad, expresión).', nd);
            const sym = normSimbolo(ev(nSym)), tfId = normTf(ev(nTf), nd);
            const lookahead = nd.kwargs.lookahead !== undefined ? !!ev(nd.kwargs.lookahead) : (nd.args[4] !== undefined ? !!ev(nd.args[4]) : false);
            const clave = `${sym}|${tfId}`, ck = nd.id + '|' + ctxClave;
            if (esSub) {                                                       // motor de la otra temporalidad: solo evalúa las llamadas que le tocan
                if (clave !== captura.clave) return NA;
                const v = ev(nExpr);
                let arr = captura.valores.get(ck);
                if (!arr) { arr = new Array(n); captura.valores.set(ck, arr); }
                arr[barra] = v;
                return v;
            }
            if (sym === chart.symbol && tfId === chart.tf) return ev(nExpr);   // misma serie: se calcula directo
            const datos = opciones.mtf && opciones.mtf[clave];
            if (!datos) { necesita.set(clave, { simbolo: sym, tf: tfId }); return NA; }
            let sub = subs.get(clave);
            if (!sub) { sub = correrSub(clave, sym, tfId, datos); subs.set(clave, sub); }
            const j = (lookahead ? sub.mapaOn : sub.mapaOff)[barra];
            if (j < 0) return NA;
            const arr = sub.valores.get(ck);
            const v = arr ? arr[j] : NA;
            return v === undefined ? NA : v;
        }

        // ── entorno ──
        const histFrames = new Map();        // por cada llamada a una función propia: historia de sus variables locales y parámetros (para x[1] dentro de funciones)
        let frameActual = null;
        const anotar = (nombre, valor) => { if (!frameActual) return; let h = frameActual.get(nombre); if (!h) { h = []; frameActual.set(nombre, h); } h[barra] = valor; };
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
            if (nombre === 'time_close') return velas.t[barra] + (chart.tfMs || 0);
            if (nombre === 'timenow' || nombre === 'last_bar_time') return velas.t[n - 1];
            if (FECHA_PARTES.includes(nombre)) return fechaParte(nombre, velas.t[barra]);
            if (nombre === 'dayofweek') return fechaParte('dayofweek', velas.t[barra]);
            falla(`La variable «${nombre}» no existe.`, nd);
        }
        function leerHistoria(nombre, k, nd) {
            if (!Number.isInteger(k) || k < 0) falla('El índice [n] debe ser un entero mayor o igual a 0.', nd);
            if (k === 0) return leerVar(nombre, nd);
            const i = barra - k;
            if (i < 0) return NA;
            const local = buscarLocal(nombre);          // una sola búsqueda (antes se repetía hasta 3 veces por lectura)
            if (!local && Object.prototype.hasOwnProperty.call(SERIES, nombre) && !globales.has(nombre)) return SERIES[nombre][i];
            if (nombre === 'bar_index') return i;
            const h = hist.get(nombre);
            if (h && !local) { const v = h[i]; return v === undefined ? NA : v; }
            if (local) {
                const fh = frameActual && frameActual.get(nombre);
                if (fh) { const v = fh[i]; return v === undefined ? NA : v; }
                falla(`«${nombre}[${k}]» no se puede usar en una variable de un bloque if/for; declárala fuera del bloque o úsala dentro de una función.`, nd);
            }
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
                    const k = ev(nd.i);
                    if (nd.a.tipo === 'Id') return leerHistoria(nd.a.n, k, nd);
                    // sobre una expresión cualquiera (ta.ema(close, 9)[1], f(x)[2]): se recuerda su valor en cada vela
                    if (!Number.isInteger(k) || k < 0) falla('El índice [n] debe ser un entero mayor o igual a 0.', nd);
                    const v = ev(nd.a);
                    const st = estado(nd, () => ({ vals: [] }));
                    st.vals[barra] = v;
                    if (k === 0) return v;
                    const r = st.vals[barra - k];
                    return r === undefined ? NA : r;
                }
                case 'Switch': {
                    const conSujeto = !!nd.sujeto, sv = conSujeto ? ev(nd.sujeto) : undefined;
                    let porDefecto = null;
                    for (const c of nd.casos) {
                        if (c.cond === null) { porDefecto = c; continue; }
                        const cv = ev(c.cond);
                        if (conSujeto ? (cv === sv || (cv == null && sv == null)) : !!cv) { const r = ejecutarBloque(c.cuerpo, true); if (r.control) controlPendiente = r.control; return r.valor; }
                    }
                    if (porDefecto) { const r = ejecutarBloque(porDefecto.cuerpo, true); if (r.control) controlPendiente = r.control; return r.valor; }
                    return NA;
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
            if (ruta.startsWith('math.')) { const c = { 'math.pi': Math.PI, 'math.e': Math.E, 'math.phi': 1.618033988749895, 'math.rphi': 0.6180339887498949 }[ruta]; if (c !== undefined) return c; }
            const v = datoDeSimbolo(ruta);
            if (v !== undefined) return v;
            const raiz = ruta.split('.')[0];
            if (NS_LIBRES.has(raiz) && ruta.includes('.')) { const c = ruta.slice(raiz.length + 1); if (NOMBRE_CONSTANTE.test(c) && !PROHIBIDOS.has(c.toLowerCase())) return c; }      // position.top_right, size.small, label.style_label_up…
            falla(`«${ruta}» no existe.`, nd);
        }
        const CONSTANTES = Object.create(null);
        ['line', 'histogram', 'columns', 'circles', 'stepline', 'cross', 'area', 'linebr'].forEach((s) => { CONSTANTES['plot.style_' + s] = s; });
        ['triangleup', 'triangledown', 'circle', 'cross', 'xcross', 'diamond', 'square', 'arrowup', 'arrowdown', 'labelup', 'labeldown', 'flag'].forEach((s) => { CONSTANTES['shape.' + s] = s; });
        ['abovebar', 'belowbar', 'top', 'bottom', 'absolute'].forEach((s) => { CONSTANTES['location.' + s] = s; });
        ['solid', 'dashed', 'dotted'].forEach((s) => { CONSTANTES['hline.style_' + s] = s; });
        ['dashed', 'dotted', 'solid'].forEach((s) => { CONSTANTES['line.style_' + s] = s; });
        const RUTAS = new WeakMap();       // en un mapa aparte (no en el árbol): el árbol protegido lleva una firma de integridad y no se puede tocar
        function rutaDe(nd) {
            if (nd.tipo === 'Id') return nd.n;
            if (nd.tipo === 'Miembro') { let r = RUTAS.get(nd); if (r === undefined) { r = `${rutaDe(nd.a)}.${nd.n}`; RUTAS.set(nd, r); } return r; }        // cacheada: se pedía en cada llamada de cada vela
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
            if (loc) { loc.set(nombre, nuevo); anotar(nombre, nuevo); } else globales.set(nombre, nuevo);
        }
        function ejecutarSent(s) {
            gasto(s);
            switch (s.tipo) {
                case 'Expr': { controlPendiente = 0; const v = ev(s.expr); if (controlPendiente) { const c = controlPendiente; controlPendiente = 0; return { control: c }; } return { valor: v }; }
                case 'Decl': {
                    const enGlobal = locales.length === 0;
                    if (enGlobal) {
                        if (s.persistente) {
                            if (barra === 0 || !globales.has(s.nombre)) globales.set(s.nombre, ev(s.valor));
                        } else globales.set(s.nombre, ev(s.valor));
                    } else { const vv = ev(s.valor); locales[locales.length - 1].set(s.nombre, vv); anotar(s.nombre, vv); }
                    return { valor: enGlobal ? globales.get(s.nombre) : locales[locales.length - 1].get(s.nombre) };
                }
                case 'Asignar': asignar(s.nombre, ev(s.valor), s, s.op); return {};
                case 'Destructurar': {
                    let v = ev(s.valor);
                    if (v == null) v = [];                       // un request.security sin datos (o una función que devuelve na) deja todo en na
                    if (!Array.isArray(v) || (v.length < s.nombres.length && v.length > 0)) falla(`Esa llamada no devuelve ${s.nombres.length} valores.`, s);
                    s.nombres.forEach((nm, i) => { const x = v[i] === undefined ? NA : v[i]; if (locales.length === 0) globales.set(nm, x); else { locales[locales.length - 1].set(nm, x); anotar(nm, x); } });
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
                case 'ForIn': {
                    const lista = ev(s.iter);
                    if (!Array.isArray(lista)) falla('El «for ... in» necesita una lista (array).', s);
                    let iter = 0, ultimo = NA;
                    locales.push(new Map());
                    try {
                        for (const x of lista.slice()) {
                            if (++iter > MAX_ITER_BUCLE) falla('El bucle for hace demasiadas vueltas.', s);
                            const amb = locales[locales.length - 1];
                            if (s.v2) { amb.set(s.v, iter - 1); amb.set(s.v2, x); } else amb.set(s.v, x);
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
        const CLAVES_KW = new WeakMap();
        const SIN_KW = Object.freeze({});            // llamadas sin argumentos con nombre (casi todas): no se crea un objeto nuevo cada vez
        function argsDe(nd) {
            const a = nd.args.map(ev);
            let claves = CLAVES_KW.get(nd);
            if (claves === undefined) { claves = Object.keys(nd.kwargs); CLAVES_KW.set(nd, claves); }
            if (!claves.length) return { a, k: SIN_KW };
            const k = {};
            for (const nombre of claves) k[nombre] = ev(nd.kwargs[nombre]);
            return { a, k };
        }
        function llamada(nd) {
            const c = nd.callee;
            if (c.tipo === 'Id' && funciones.has(c.n)) return llamarUsuario(nd, funciones.get(c.n));
            // «lista.push(x)», «etiqueta.set_text(...)»: azúcar de método sobre una variable
            if (c.tipo === 'Miembro' && c.a.tipo === 'Id' && !NS_FUNCIONES.has(c.a.n) && (buscarLocal(c.a.n) || globales.has(c.a.n))) {
                const base = ev(c.a), tipo = Array.isArray(base) ? 'array' : base && base.__k;
                const fm = tipo && BUILTIN[`${tipo}.${c.n}`];
                if (!fm) falla(`Ese valor no tiene el método «${c.n}».`, nd);
                const { a, k } = argsDe(nd);
                return fm(nd, [base, ...a], k);
            }
            const nombre = rutaDe(c);
            if (nombre === 'request.security' || nombre === 'security') return seguridad(nd);
            const f = BUILTIN[nombre];
            if (!f) falla(`La función «${nombre}» no existe o todavía no está soportada.`, nd);
            const { a, k } = argsDe(nd);
            return f(nd, conNombres(nombre, a, k), k);
        }
        function llamarUsuario(nd, def) {
            if (pila.length > 40) falla('Demasiadas llamadas anidadas (recursión).', nd);
            const { a, k } = argsDe(nd);
            const amb = new Map();
            const faltan = [];
            def.params.forEach((p, i) => { const v = k[p] !== undefined ? k[p] : a[i]; if (v === undefined) faltan.push(i); amb.set(p, v === undefined ? NA : v); });
            pila.push(def.nombre);
            const ctxAnterior = ctxClave, frameAnterior = frameActual;
            ctxClave = `${ctxClave}>${nd.id}`;
            frameActual = histFrames.get(ctxClave) || (histFrames.set(ctxClave, new Map()), histFrames.get(ctxClave));
            def.params.forEach((p) => anotar(p, amb.get(p)));
            const salvadas = locales.splice(0, locales.length);      // las funciones no ven las variables locales de quien las llama
            locales.push(amb);
            try {
                faltan.forEach((i) => { if (def.defectos && def.defectos[i]) { const dv = ev(def.defectos[i]); amb.set(def.params[i], dv); anotar(def.params[i], dv); } });   // parámetros con valor por defecto
                const r = ejecutarBloque(def.cuerpo, false);
                return r.valor;
            } finally { locales.length = 0; salvadas.forEach((m) => locales.push(m)); ctxClave = ctxAnterior; frameActual = frameAnterior; pila.pop(); }
        }

        // Argumentos con nombre de las funciones incorporadas: plot(series=x), ta.sma(source=close, length=14)… se colocan en su lugar
        const PARAMS = {
            plot: ['series', 'title', 'color', 'linewidth', 'style', 'trackprice', 'histbase', 'offset'], plotshape: ['series', 'title', 'style', 'location', 'color', 'offset', 'text', 'textcolor', 'editable', 'size'],
            plotchar: ['series', 'title', 'char', 'location', 'color', 'offset', 'text', 'textcolor'], plotarrow: ['series', 'title', 'colorup', 'colordown'], bgcolor: ['color', 'offset'], hline: ['price', 'title', 'color', 'linestyle', 'linewidth'],
            alertcondition: ['condition', 'title', 'message'], fill: ['plot1', 'plot2', 'color', 'title'], plotcandle: ['open', 'high', 'low', 'close', 'title', 'color', 'wickcolor'],
            'ta.sma': ['source', 'length'], 'ta.ema': ['source', 'length'], 'ta.rma': ['source', 'length'], 'ta.wma': ['source', 'length'], 'ta.vwma': ['source', 'length'], 'ta.hma': ['source', 'length'], 'ta.swma': ['source'],
            'ta.alma': ['series', 'length', 'offset', 'sigma'], 'ta.rsi': ['source', 'length'], 'ta.stdev': ['source', 'length'], 'ta.variance': ['source', 'length'], 'ta.dev': ['source', 'length'], 'ta.median': ['source', 'length'],
            'ta.highest': ['source', 'length'], 'ta.lowest': ['source', 'length'], 'ta.highestbars': ['source', 'length'], 'ta.lowestbars': ['source', 'length'], 'ta.atr': ['length'], 'ta.change': ['source', 'length'], 'ta.mom': ['source', 'length'], 'ta.roc': ['source', 'length'],
            'ta.cum': ['source'], 'ta.crossover': ['source1', 'source2'], 'ta.crossunder': ['source1', 'source2'], 'ta.cross': ['source1', 'source2'], 'ta.macd': ['source', 'fastlen', 'slowlen', 'siglen'], 'ta.bb': ['series', 'length', 'mult'],
            'ta.stoch': ['source', 'high', 'low', 'length'], 'ta.pivothigh': ['source', 'leftbars', 'rightbars'], 'ta.pivotlow': ['source', 'leftbars', 'rightbars'], 'ta.barssince': ['condition'], 'ta.valuewhen': ['condition', 'source', 'occurrence'],
            'ta.cci': ['source', 'length'], 'ta.mfi': ['series', 'length'], 'ta.cmo': ['series', 'length'], 'ta.linreg': ['source', 'length', 'offset'], 'ta.percentrank': ['source', 'length'], 'ta.correlation': ['source1', 'source2', 'length'],
            'ta.rising': ['source', 'length'], 'ta.falling': ['source', 'length'], 'ta.kc': ['series', 'length', 'mult', 'useTrueRange'], 'ta.dmi': ['diLength', 'adxSmoothing'], 'ta.supertrend': ['factor', 'atrPeriod'], 'ta.vwap': ['source'], 'ta.tsi': ['source', 'short_length', 'long_length'],
            'ta.wpr': ['length'], 'ta.range': ['source', 'length'], 'ta.max': ['source'], 'ta.min': ['source'],
            'math.abs': ['number'], 'math.sqrt': ['number'], 'math.round': ['number', 'precision'], 'math.floor': ['number'], 'math.ceil': ['number'], 'math.pow': ['base', 'exponent'], 'math.log': ['number'], 'math.exp': ['number'], 'math.sum': ['source', 'length'],
            nz: ['source', 'replacement'], na: ['x'], fixnan: ['source'], 'color.new': ['color', 'transp'], 'color.rgb': ['red', 'green', 'blue', 'transp'], 'str.tostring': ['value', 'format'], 'str.format': ['formatString'],
        };
        const SOLO_LONGITUD = new Set(['ta.highest', 'ta.lowest', 'ta.highestbars', 'ta.lowestbars']);
        function conNombres(nombre, a, k) {
            const nombres = PARAMS[nombre];
            if (!nombres || k === SIN_KW) return a;       // sin argumentos con nombre no hay nada que acomodar
            const r = a.slice();
            let usado = false;
            nombres.forEach((nm, i) => { if (k[nm] !== undefined && r[i] === undefined) { r[i] = k[nm]; usado = true; } });
            if (nombre === 'fill') { if (k.hline1 !== undefined && r[0] === undefined) r[0] = k.hline1; if (k.hline2 !== undefined && r[1] === undefined) r[1] = k.hline2; }
            if (SOLO_LONGITUD.has(nombre) && usado && r[0] === undefined && r.length === 2) return [r[1]];       // highest(length=10): sin serie, usa máximos/mínimos de la vela
            return r;
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
                const titulo = k.title !== undefined ? k.title : (typeof a[1] === 'string' ? a[1] : null);
                const clave = String(titulo != null ? titulo : `Entrada ${nd.id}`);
                if (!inputsVistos.has(clave)) {
                    inputsVistos.add(clave);
                    const numerico = tipo === 'int' || tipo === 'float';
                    out.inputs.push({ id: clave, tipo, def: defecto, titulo: clave, min: k.minval !== undefined ? k.minval : (numerico && typeof a[2] === 'number' ? a[2] : undefined), max: k.maxval !== undefined ? k.maxval : (numerico && typeof a[3] === 'number' ? a[3] : undefined), step: k.step !== undefined ? k.step : (numerico && typeof a[4] === 'number' ? a[4] : undefined), opciones: k.options, grupo: k.group });
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
        def('input.enum', (nd, a, k) => (k.defval !== undefined ? k.defval : a[0]));
        def('input', (nd, a, k) => entrada(typeof a[0] === 'boolean' ? 'bool' : Number.isInteger(a[0]) ? 'int' : typeof a[0] === 'number' ? 'float' : 'string')(nd, a, k));

        // salidas
        def('indicator', (nd, a, k) => { out.meta.titulo = String(k.title !== undefined ? k.title : (a[0] || 'Script')); out.meta.overlay = !!k.overlay; if (k.precision != null) out.meta.precision = k.precision; return NA; });
        BUILTIN.study = BUILTIN.indicator;
        def('plot', (nd, a, k) => {
            const titulo = String(k.title !== undefined ? k.title : (typeof a[1] === 'string' ? a[1] : `Plot ${plotsPorClave.size + 1}`));
            let p = plotsPorClave.get(nd.id);
            if (!p) {
                if (plotsPorClave.size >= MAX_PLOTS) falla(`Máximo ${MAX_PLOTS} plots por script.`, nd);
                p = { titulo, color: null, grosor: 1, estilo: 'line', valores: new Array(n).fill(NA), colores: new Array(n).fill(NA), offset: k.offset || 0, oculto: false };
                plotsPorClave.set(nd.id, p); out.plots.push(p);
            }
            p.valores[barra] = a[0] == null || Number.isNaN(a[0]) ? NA : a[0];
            const col = k.color !== undefined ? k.color : (typeof a[2] === 'string' ? a[2] : null);
            p.colores[barra] = col == null ? NA : col;
            p.grosor = k.linewidth !== undefined ? k.linewidth : 1;
            p.estilo = k.style !== undefined ? k.style : 'line';
            p.oculto = k.display === 'none';
            return { __k: 'plot', idx: out.plots.indexOf(p) };
        });
        def('hline', (nd, a, k) => {
            let h = out.hlines.find((x) => x._id === nd.id);
            if (!h) { h = { _id: nd.id, precio: a[0], titulo: String(k.title || ''), color: k.color || aRGBA('#787B86'), estilo: k.linestyle || 'dashed' }; out.hlines.push(h); }
            return { __k: 'hline', idx: out.hlines.indexOf(h) };
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

        // ═════════════ ampliación de compatibilidad con Pine Script v5 ═════════════
        const esArr = Array.isArray;
        const avisar = (msg) => { if (!out.avisos.includes(msg)) out.avisos.push(msg); };
        const aTexto = (v) => (v == null ? 'na' : typeof v === 'number' ? String(parseFloat(v.toFixed(10))) : esArr(v) ? `[${v.map(aTexto).join(', ')}]` : String(v));
        const decimalesDe = (fmt) => { if (typeof fmt !== 'string') return null; if (fmt === 'mintick' || fmt === 'price') return chart.precision != null ? chart.precision : 5; if (fmt === 'percent') return 2; if (fmt === 'volume') return 0; const m = /[.]([#0]+)/.exec(fmt); return m ? m[1].length : (/^[#0,]+$/.test(fmt) ? 0 : null); };
        const formato = (v, fmt) => { if (v == null) return 'na'; if (typeof v !== 'number') return aTexto(v); const d = decimalesDe(fmt); return d == null ? aTexto(v) : v.toFixed(d); };
        const colNum = (c) => { const m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(aRGBA(c) || ''); return m ? [+m[1], +m[2], +m[3], +m[4]] : null; };

        // ── colores extra
        def('color.r', (nd, a) => { const x = colNum(a[0]); return x ? x[0] : NA; });
        def('color.g', (nd, a) => { const x = colNum(a[0]); return x ? x[1] : NA; });
        def('color.b', (nd, a) => { const x = colNum(a[0]); return x ? x[2] : NA; });
        def('color.t', (nd, a) => { const x = colNum(a[0]); return x ? Math.round((1 - x[3]) * 100) : NA; });

        // ── matemática extra
        def('math.random', (nd, a) => { const lo = a[0] == null ? 0 : a[0], hi = a[1] == null ? 1 : a[1]; return lo + Math.random() * (hi - lo); });
        def('math.todegrees', (nd, a) => (a[0] == null ? NA : (a[0] * 180) / Math.PI));
        def('math.toradians', (nd, a) => (a[0] == null ? NA : (a[0] * Math.PI) / 180));
        m1('asin', Math.asin); m1('acos', Math.acos); m1('round_to_mintick', (x) => { const t = chart.precision != null ? Number(`1e-${chart.precision}`) : 0.00001; return Math.round(x / t) * t; });
        def('math.round', (nd, a) => { if (a[0] == null) return NA; const d = a[1] || 0; const f = 10 ** d; return Math.round(a[0] * f) / f; });
        def('fixnan', (nd, a) => { const st = estado(nd, () => ({ u: NA })); if (st._barra !== barra) { st._barra = barra; if (a[0] != null) st.u = a[0]; } return a[0] != null ? a[0] : st.u; });
        def('bool', (nd, a) => (a[0] == null ? false : !!a[0]));
        def('timestamp', (nd, a) => { const v = a.length === 1 && typeof a[0] === 'string' ? Date.parse(a[0]) : Date.UTC(a[0], (a[1] || 1) - 1, a[2] || 1, a[3] || 0, a[4] || 0, a[5] || 0); return Number.isFinite(v) ? v : NA; });
        FECHA_PARTES.concat(['dayofweek']).forEach((nm) => def(nm, (nd, a) => fechaParte(nm, a.length ? a[0] : velas.t[barra])));
        def('timeframe.in_seconds', (nd, a) => { const id = a[0] == null || a[0] === '' ? chart.tf : TF_ALIAS[String(a[0])]; return id && TF_MS[id] ? TF_MS[id] / 1000 : NA; });
        // time(timeframe, session): hora de apertura de la vela del marco pedido (UTC); con sesión «HHMM-HHMM» devuelve na fuera de ella.
        def('time', (nd, a) => {
            const t = velas.t[barra], tf = a[0] == null || a[0] === '' || a[0] === 'period' ? null : String(a[0]);
            let ini = t;
            if (tf === 'M' || tf === '1M') { const d = new Date(t); ini = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); }
            else {
                const id = tf == null ? chart.tf : TF_ALIAS[tf], ms = id && TF_MS[id];
                if (!ms) return NA;
                ini = id === '1W' ? Math.floor((t - 345600000) / ms) * ms + 345600000 : Math.floor(t / ms) * ms;
            }
            const ses = a[1];
            if (typeof ses === 'string' && /^\d{4}-\d{4}/.test(ses)) {
                const d = new Date(t), m = d.getUTCHours() * 60 + d.getUTCMinutes();
                const x = ses.slice(0, 9), d1 = Number(x.slice(0, 2)) * 60 + Number(x.slice(2, 4)), d2 = Number(x.slice(5, 7)) * 60 + Number(x.slice(7, 9));
                const dentro = d1 <= d2 ? (m >= d1 && m < d2) : (m >= d1 || m < d2);
                if (!dentro) return NA;
            }
            return ini;
        });
        def('timeframe.change', (nd, a) => { const id = a[0] == null || a[0] === '' ? chart.tf : TF_ALIAS[String(a[0])]; const ms = id && TF_MS[id]; if (!ms || barra === 0) return barra === 0; return Math.floor(velas.t[barra] / ms) !== Math.floor(velas.t[barra - 1] / ms); });
        def('timeframe.from_seconds', (nd, a) => { const id = Object.keys(TF_MS).find((k) => TF_MS[k] === a[0] * 1000); return id ? TF_PINE[id] : String(a[0]); });

        // ── texto
        def('str.tostring', (nd, a) => formato(a[0], a[1]));
        def('str.tonumber', (nd, a) => { const v = parseFloat(a[0]); return Number.isFinite(v) ? v : NA; });
        def('str.length', (nd, a) => (a[0] == null ? NA : String(a[0]).length));
        def('str.contains', (nd, a) => String(a[0]).includes(String(a[1])));
        def('str.startswith', (nd, a) => String(a[0]).startsWith(String(a[1])));
        def('str.endswith', (nd, a) => String(a[0]).endsWith(String(a[1])));
        def('str.substring', (nd, a) => String(a[0]).substring(a[1], a[2] === undefined ? undefined : a[2]));
        def('str.upper', (nd, a) => String(a[0]).toUpperCase());
        def('str.lower', (nd, a) => String(a[0]).toLowerCase());
        def('str.trim', (nd, a) => String(a[0]).trim());
        def('str.pos', (nd, a) => { const i = String(a[0]).indexOf(String(a[1])); return i < 0 ? NA : i; });
        def('str.replace', (nd, a) => String(a[0]).replace(String(a[1]), String(a[2])));
        def('str.replace_all', (nd, a) => String(a[0]).split(String(a[1])).join(String(a[2])));
        def('str.repeat', (nd, a) => String(a[0]).repeat(Math.max(0, Math.min(1000, a[1] || 0))));
        def('str.split', (nd, a) => String(a[0]).split(String(a[1])));
        def('str.format', (nd, a) => String(a[0]).replace(/\{(\d+)(?:,\s*number\s*(?:,\s*([^}]*))?)?\}/g, (m, i, f) => (a[+i + 1] === undefined ? m : f ? formato(a[+i + 1], f.trim()) : aTexto(a[+i + 1]))));

        // ── listas (array.*)
        const nuevaLista = (nd, a) => { const k = Math.max(0, Math.min(100000, Math.floor(a[0] || 0))); return new Array(k).fill(a[1] === undefined ? NA : a[1]); };
        ['float', 'int', 'bool', 'string', 'color', 'label', 'line', 'box', 'table'].forEach((t) => def(`array.new_${t}`, nuevaLista));
        def('array.new', nuevaLista);
        def('array.from', (nd, a) => a.slice());
        const L = (f) => (nd, a, k) => { if (!esArr(a[0])) falla('Eso no es una lista (array).', nd); return f(a[0], a, k, nd); };
        def('array.push', L((l, a) => { if (l.length >= 100000) falla('La lista es demasiado grande.'); l.push(a[1]); return NA; }));
        def('array.pop', L((l) => { const v = l.pop(); return v === undefined ? NA : v; }));
        def('array.shift', L((l) => { const v = l.shift(); return v === undefined ? NA : v; }));
        def('array.unshift', L((l, a) => { l.unshift(a[1]); return NA; }));
        def('array.get', L((l, a, k, nd) => { const i = a[1] < 0 ? l.length + a[1] : a[1]; if (!Number.isInteger(i) || i < 0 || i >= l.length) falla(`Índice fuera de la lista (${a[1]}; tiene ${l.length}).`, nd); return l[i]; }));
        def('array.set', L((l, a, k, nd) => { const i = a[1] < 0 ? l.length + a[1] : a[1]; if (!Number.isInteger(i) || i < 0 || i >= l.length) falla(`Índice fuera de la lista (${a[1]}; tiene ${l.length}).`, nd); l[i] = a[2]; return NA; }));
        def('array.size', L((l) => l.length));
        def('array.clear', L((l) => { l.length = 0; return NA; }));
        def('array.insert', L((l, a) => { l.splice(a[1], 0, a[2]); return NA; }));
        def('array.remove', L((l, a) => { const v = l.splice(a[1], 1)[0]; return v === undefined ? NA : v; }));
        def('array.includes', L((l, a) => l.includes(a[1])));
        def('array.indexof', L((l, a) => l.indexOf(a[1])));
        def('array.lastindexof', L((l, a) => l.lastIndexOf(a[1])));
        def('array.first', L((l) => (l.length ? l[0] : NA)));
        def('array.last', L((l) => (l.length ? l[l.length - 1] : NA)));
        const numeros = (l) => l.filter(esNum);
        def('array.sum', L((l) => numeros(l).reduce((s, x) => s + x, 0)));
        def('array.avg', L((l) => { const v = numeros(l); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NA; }));
        def('array.min', L((l) => { const v = numeros(l); return v.length ? Math.min(...v) : NA; }));
        def('array.max', L((l) => { const v = numeros(l); return v.length ? Math.max(...v) : NA; }));
        def('array.median', L((l) => { const v = numeros(l).sort((x, y) => x - y); if (!v.length) return NA; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; }));
        def('array.stdev', L((l) => { const v = numeros(l); if (!v.length) return NA; const m = v.reduce((s, x) => s + x, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length); }));
        def('array.variance', L((l) => { const v = numeros(l); if (!v.length) return NA; const m = v.reduce((s, x) => s + x, 0) / v.length; return v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length; }));
        def('array.range', L((l) => { const v = numeros(l); return v.length ? Math.max(...v) - Math.min(...v) : NA; }));
        def('array.sort', L((l, a) => { const desc = a[1] === 'order.descending' || a[1] === 'descending'; l.sort((x, y) => (x === y ? 0 : x == null ? 1 : y == null ? -1 : x < y ? -1 : 1) * (desc ? -1 : 1)); return NA; }));
        def('array.reverse', L((l) => { l.reverse(); return NA; }));
        def('array.copy', L((l) => l.slice()));
        def('array.slice', L((l, a) => l.slice(a[1], a[2])));
        def('array.concat', L((l, a) => { if (esArr(a[1])) l.push(...a[1]); return l; }));
        def('array.fill', L((l, a) => { l.fill(a[1], a[2], a[3]); return NA; }));
        def('array.join', L((l, a) => l.map(aTexto).join(a[1] === undefined ? ',' : String(a[1]))));

        // ── más indicadores técnicos
        const hist1 = (nd, v, len) => { const st = estado(nd, () => ({ buf: [] })); if (st._barra !== barra) { st._barra = barra; st.buf.push(v); if (st.buf.length > len) st.buf.shift(); } return st.buf; };
        def('ta.vwma', (nd, a) => { const len = Math.max(1, Math.floor(a[1])); const b = hist1(nd, [a[0], velas.v[barra]], len); if (b.length < len || b.some((x) => x[0] == null)) return NA; let sv = 0, sw = 0; b.forEach((x) => { sv += x[0] * x[1]; sw += x[1]; }); return sw ? sv / sw : NA; });
        def('ta.swma', (nd, a) => { const b = hist1(nd, a[0], 4); return b.length < 4 || b.some((x) => x == null) ? NA : (b[0] + 2 * b[1] + 2 * b[2] + b[3]) / 6; });
        def('ta.alma', (nd, a) => { const len = Math.max(1, Math.floor(a[1])), off = a[2] === undefined ? 0.85 : a[2], sg = a[3] === undefined ? 6 : a[3]; const b = hist1(nd, a[0], len); if (b.length < len || b.some((x) => x == null)) return NA; const m = off * (len - 1), s = len / sg; let sw = 0, sv = 0; b.forEach((x, i) => { const w = Math.exp(-((i - m) ** 2) / (2 * s * s)); sw += w; sv += x * w; }); return sv / sw; });
        def('ta.linreg', (nd, a) => { const len = Math.max(2, Math.floor(a[1])), off = a[2] || 0; const b = hist1(nd, a[0], len); if (b.length < len || b.some((x) => x == null)) return NA; let sx = 0, sy = 0, sxy = 0, sxx = 0; b.forEach((y, i) => { sx += i; sy += y; sxy += i * y; sxx += i * i; }); const den = len * sxx - sx * sx; const pend = den ? (len * sxy - sx * sy) / den : 0; const ord = (sy - pend * sx) / len; return ord + pend * (len - 1 - off); });
        def('ta.median', (nd, a) => ventana(nd, a[0], a[1], (b) => { const v = b.slice().sort((x, y) => x - y); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; }));
        def('ta.variance', (nd, a) => ventana(nd, a[0], a[1], (b) => { const m = b.reduce((s, x) => s + x, 0) / b.length; return b.reduce((s, x) => s + (x - m) ** 2, 0) / b.length; }));
        def('ta.dev', (nd, a) => ventana(nd, a[0], a[1], (b) => { const m = b.reduce((s, x) => s + x, 0) / b.length; return b.reduce((s, x) => s + Math.abs(x - m), 0) / b.length; }));
        def('ta.range', (nd, a) => ventana(nd, a[0], a[1], (b) => Math.max(...b) - Math.min(...b)));
        def('ta.percentrank', (nd, a) => ventana(nd, a[0], a[1] + 1, (b) => { const ult = b[b.length - 1]; let c = 0; for (let i = 0; i < b.length - 1; i++) if (b[i] <= ult) c++; return (c / (b.length - 1)) * 100; }));
        def('ta.correlation', (nd, a) => { const len = Math.max(2, Math.floor(a[2])); const b = hist1(nd, [a[0], a[1]], len); if (b.length < len || b.some((x) => x[0] == null || x[1] == null)) return NA; const mx = b.reduce((s, x) => s + x[0], 0) / len, my = b.reduce((s, x) => s + x[1], 0) / len; let sxy = 0, sxx = 0, syy = 0; b.forEach((x) => { sxy += (x[0] - mx) * (x[1] - my); sxx += (x[0] - mx) ** 2; syy += (x[1] - my) ** 2; }); return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NA; });
        def('ta.highestbars', (nd, a) => { const [src, len] = a.length > 1 ? [a[0], a[1]] : [velas.h[barra], a[0]]; const b = hist1(nd, src, len); if (b.length < len || b.some((x) => x == null)) return NA; let mi = 0; b.forEach((x, i) => { if (x >= b[mi]) mi = i; }); return mi - (b.length - 1); });
        def('ta.lowestbars', (nd, a) => { const [src, len] = a.length > 1 ? [a[0], a[1]] : [velas.l[barra], a[0]]; const b = hist1(nd, src, len); if (b.length < len || b.some((x) => x == null)) return NA; let mi = 0; b.forEach((x, i) => { if (x <= b[mi]) mi = i; }); return mi - (b.length - 1); });
        def('ta.rising', (nd, a) => { const len = Math.floor(a[1]); const b = hist1(nd, a[0], len + 1); return b.length < len + 1 || b.some((x) => x == null) ? false : b.every((x, i) => i === 0 || x > b[i - 1]); });
        def('ta.falling', (nd, a) => { const len = Math.floor(a[1]); const b = hist1(nd, a[0], len + 1); return b.length < len + 1 || b.some((x) => x == null) ? false : b.every((x, i) => i === 0 || x < b[i - 1]); });
        def('ta.max', (nd, a) => { const st = estado(nd, () => ({ m: NA })); if (st._barra !== barra) { st._barra = barra; if (a[0] != null && (st.m == null || a[0] > st.m)) st.m = a[0]; } return st.m; });
        def('ta.min', (nd, a) => { const st = estado(nd, () => ({ m: NA })); if (st._barra !== barra) { st._barra = barra; if (a[0] != null && (st.m == null || a[0] < st.m)) st.m = a[0]; } return st.m; });
        def('ta.cci', (nd, a) => { const len = Math.max(1, Math.floor(a[1])); const b = hist1(nd, a[0], len); if (b.length < len || b.some((x) => x == null)) return NA; const m = b.reduce((s, x) => s + x, 0) / len; const dm = b.reduce((s, x) => s + Math.abs(x - m), 0) / len; return dm ? (b[len - 1] - m) / (0.015 * dm) : 0; });
        def('ta.cmo', (nd, a) => { const len = Math.max(1, Math.floor(a[1])); const b = hist1(nd, a[0], len + 1); if (b.length < len + 1 || b.some((x) => x == null)) return NA; let up = 0, dn = 0; for (let i = 1; i < b.length; i++) { const d = b[i] - b[i - 1]; if (d > 0) up += d; else dn -= d; } return up + dn ? (100 * (up - dn)) / (up + dn) : 0; });
        def('ta.mfi', (nd, a) => { const len = Math.max(1, Math.floor(a[1])); const b = hist1(nd, [a[0], velas.v[barra]], len + 1); if (b.length < len + 1 || b.some((x) => x[0] == null)) return NA; let pos = 0, neg = 0; for (let i = 1; i < b.length; i++) { const f = b[i][0] * b[i][1]; if (b[i][0] > b[i - 1][0]) pos += f; else if (b[i][0] < b[i - 1][0]) neg += f; } return neg === 0 ? 100 : 100 - 100 / (1 + pos / neg); });
        def('ta.wpr', (nd, a) => { const len = Math.max(1, Math.floor(a[0])); const bh = hist1(subNodo(nd, 1), velas.h[barra], len), bl = hist1(subNodo(nd, 2), velas.l[barra], len); if (bh.length < len) return NA; const hh = Math.max(...bh), ll = Math.min(...bl); return hh === ll ? NA : (100 * (velas.c[barra] - hh)) / (hh - ll); });
        def('ta.tsi', (nd, a) => { const mom = a[0] == null ? NA : (() => { const st = estado(subNodo(nd, 9), () => ({ p: NA })); const m = st.p == null ? NA : a[0] - st.p; if (st._barra !== barra) { st._barra = barra; st.p = a[0]; } return m; })(); const e1 = BUILTIN['ta.ema'](subNodo(nd, 1), [mom, a[2]]), e2 = BUILTIN['ta.ema'](subNodo(nd, 2), [e1, a[1]]); const m1v = mom == null ? NA : Math.abs(mom), f1 = BUILTIN['ta.ema'](subNodo(nd, 3), [m1v, a[2]]), f2 = BUILTIN['ta.ema'](subNodo(nd, 4), [f1, a[1]]); return e2 == null || f2 == null || f2 === 0 ? NA : (100 * e2) / f2; });
        def('ta.vwap', (nd, a) => { const st = estado(nd, () => ({ pv: 0, v: 0, dia: -1 })); if (st._barra !== barra) { st._barra = barra; const dia = Math.floor(velas.t[barra] / 86400000); if (dia !== st.dia) { st.dia = dia; st.pv = 0; st.v = 0; } const src = a[0] == null ? hlc3[barra] : a[0]; st.pv += src * velas.v[barra]; st.v += velas.v[barra]; } return st.v ? st.pv / st.v : NA; });
        def('ta.kc', (nd, a) => { const [src, len, mult, usarTr] = a; const base = BUILTIN['ta.ema'](subNodo(nd, 1), [src, len]); const rango = usarTr === false ? NA : BUILTIN['ta.atr'](subNodo(nd, 2), [len]); return [base, base == null || rango == null ? NA : base + mult * rango, base == null || rango == null ? NA : base - mult * rango]; });
        def('ta.kcw', (nd, a) => { const r = BUILTIN['ta.kc'](nd, a); return r[0] ? (r[1] - r[2]) / r[0] : NA; });
        def('ta.bbw', (nd, a) => { const r = BUILTIN['ta.bb'](nd, a); return r[0] ? (r[1] - r[2]) / r[0] : NA; });
        def('ta.dmi', (nd, a) => {
            const di = Math.floor(a[0]), adxLen = Math.floor(a[1] === undefined ? a[0] : a[1]);
            const st = estado(nd, () => ({ ph: NA, pl: NA }));
            let mas = 0, menos = 0;
            if (st._barra !== barra) { st._barra = barra; if (st.ph != null) { const up = velas.h[barra] - st.ph, dn = st.pl - velas.l[barra]; mas = up > dn && up > 0 ? up : 0; menos = dn > up && dn > 0 ? dn : 0; } st.ph = velas.h[barra]; st.pl = velas.l[barra]; st.mas = mas; st.menos = menos; } else { mas = st.mas; menos = st.menos; }
            const trS = BUILTIN['ta.rma'](subNodo(nd, 1), [tr[barra], di]), masS = BUILTIN['ta.rma'](subNodo(nd, 2), [mas, di]), menosS = BUILTIN['ta.rma'](subNodo(nd, 3), [menos, di]);
            const pdi = trS ? (100 * masS) / trS : NA, mdi = trS ? (100 * menosS) / trS : NA;
            const dx = pdi == null || mdi == null || pdi + mdi === 0 ? NA : (100 * Math.abs(pdi - mdi)) / (pdi + mdi);
            return [pdi, mdi, BUILTIN['ta.rma'](subNodo(nd, 4), [dx, adxLen])];
        });
        def('ta.supertrend', (nd, a) => {
            const [factor, per] = a;
            const atr = BUILTIN['ta.atr'](subNodo(nd, 1), [per]);
            const st = estado(nd, () => ({ up: NA, dn: NA, dir: 1, pc: NA, tend: NA }));
            if (st._barra !== barra) {
                st._barra = barra;
                if (atr == null) { st.res = [NA, NA]; st.pc = velas.c[barra]; return st.res; }
                const medio = hl2[barra];
                let up = medio - factor * atr, dn = medio + factor * atr;
                if (st.up != null && st.pc != null) { if (!(up > st.up || st.pc < st.up)) up = st.up; if (!(dn < st.dn || st.pc > st.dn)) dn = st.dn; }
                let dir = st.dir;
                if (st.tend == null) dir = 1; else if (dir === -1 && velas.c[barra] > st.dn) dir = 1; else if (dir === 1 && velas.c[barra] < st.up) dir = -1;
                st.up = up; st.dn = dn; st.dir = dir; st.tend = true; st.pc = velas.c[barra];
                st.res = [dir === 1 ? up : dn, dir === 1 ? -1 : 1];
            }
            return st.res;
        });

        // alias estilo Pine v4 (sma(...), crossover(...)…)
        ['sma', 'ema', 'rma', 'wma', 'hma', 'vwma', 'rsi', 'atr', 'stdev', 'highest', 'lowest', 'change', 'mom', 'roc', 'crossover', 'crossunder', 'cross', 'cum', 'macd', 'stoch', 'pivothigh', 'pivotlow', 'barssince', 'valuewhen', 'cci', 'mfi', 'linreg', 'cmo', 'tsi', 'percentrank', 'correlation', 'highestbars', 'lowestbars', 'rising', 'falling', 'dmi', 'supertrend', 'bb', 'kc', 'vwap'].forEach((nm) => { if (!BUILTIN[nm] && BUILTIN[`ta.${nm}`]) BUILTIN[nm] = BUILTIN[`ta.${nm}`]; });

        // ── entradas extra
        ['symbol', 'session', 'price', 'time', 'text_area', 'enum'].forEach((t) => def(`input.${t}`, entrada(t === 'price' || t === 'time' ? 'float' : 'string')));

        // ── dibujos sobre el gráfico: etiquetas, líneas, cajas, tablas
        const color1 = (c, d) => (c == null ? aRGBA(d) : c);
        const empuja = (lista, obj, max) => { lista.push(obj); let vivos = 0; for (let i = lista.length - 1; i >= 0; i--) { if (!lista[i].borrado && ++vivos > max) lista[i].borrado = true; } return obj; };
        const posic = (a, k, nombres, defecto) => { const o = {}; nombres.forEach((nm, i) => { o[nm] = k[nm] !== undefined ? k[nm] : (a[i] !== undefined ? a[i] : defecto[nm]); }); return o; };
        def('label.new', (nd, a, k) => {
            const o = posic(a, k, ['x', 'y', 'text', 'xloc', 'yloc', 'color', 'style', 'textcolor', 'size', 'textalign', 'tooltip'], { text: '', xloc: 'bar_index', yloc: 'price', style: 'label_down', size: 'normal', textalign: 'center' });
            if (o.x == null || (o.y == null && o.yloc === 'price')) return NA;
            return empuja(out.etiquetas, { __k: 'label', x: o.x, y: o.y, texto: aTexto(o.text === '' ? '' : o.text), xloc: String(o.xloc), yloc: String(o.yloc), color: color1(o.color, '#2962FF'), estilo: String(o.style), colorTexto: color1(o.textcolor, '#FFFFFF'), tam: String(o.size) }, out.meta.maxEtiquetas);
        });
        def('line.new', (nd, a, k) => {
            const o = posic(a, k, ['x1', 'y1', 'x2', 'y2', 'xloc', 'extend', 'color', 'style', 'width'], { xloc: 'bar_index', extend: 'none', style: 'solid', width: 1 });
            if ([o.x1, o.y1, o.x2, o.y2].some((v) => v == null)) return NA;
            return empuja(out.lineas, { __k: 'line', x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2, xloc: String(o.xloc), extend: String(o.extend), color: color1(o.color, '#2962FF'), estilo: String(o.style), grosor: o.width }, out.meta.maxLineas);
        });
        def('box.new', (nd, a, k) => {
            const o = posic(a, k, ['left', 'top', 'right', 'bottom', 'border_color', 'border_width', 'border_style', 'extend', 'xloc', 'bgcolor', 'text', 'text_size', 'text_color'], { border_width: 1, border_style: 'solid', extend: 'none', xloc: 'bar_index', text: '' });
            if ([o.left, o.top, o.right, o.bottom].some((v) => v == null)) return NA;
            return empuja(out.cajas, { __k: 'box', izq: o.left, arriba: o.top, der: o.right, abajo: o.bottom, borde: color1(o.border_color, '#2962FF'), grosor: o.border_width, estiloBorde: String(o.border_style), extend: String(o.extend), xloc: String(o.xloc), fondo: color1(o.bgcolor, 'rgba(0,0,0,0)'), texto: aTexto(o.text), colorTexto: color1(o.text_color, '#FFFFFF') }, out.meta.maxCajas);
        });
        def('table.new', (nd, a, k) => {
            const o = posic(a, k, ['position', 'columns', 'rows', 'bgcolor', 'frame_color', 'frame_width', 'border_color', 'border_width'], { position: 'top_right', columns: 1, rows: 1, frame_width: 0, border_width: 0 });
            if (out.tablas.filter((t) => !t.borrado).length >= 9) falla('Máximo 9 tablas por script.', nd);
            return empuja(out.tablas, { __k: 'table', pos: String(o.position), cols: Math.max(1, Math.min(30, o.columns | 0)), filas: Math.max(1, Math.min(60, o.rows | 0)), fondo: o.bgcolor == null ? null : o.bgcolor, marco: o.frame_color == null ? null : o.frame_color, marcoW: o.frame_width, bordeC: o.border_color == null ? null : o.border_color, bordeW: o.border_width, celdas: {} }, 9);
        });
        def('table.cell', (nd, a, k) => {
            const t = a[0]; if (!t || t.__k !== 'table') return NA;
            const o = posic(a.slice(1), k, ['column', 'row', 'text', 'width', 'height', 'text_color', 'text_halign', 'text_valign', 'text_size', 'bgcolor', 'tooltip'], { text: '', text_halign: 'center', text_size: 'normal' });
            if (!(o.column >= 0 && o.column < t.cols && o.row >= 0 && o.row < t.filas)) return NA;
            const c = t.celdas[`${o.column},${o.row}`] || (t.celdas[`${o.column},${o.row}`] = { c: o.column, r: o.row });
            c.texto = aTexto(o.text); c.ancho = o.width; c.alto = o.height; c.colorTexto = o.text_color == null ? null : o.text_color; c.alin = String(o.text_halign); c.tam = String(o.text_size); c.fondo = o.bgcolor == null ? null : o.bgcolor;
            return NA;
        });
        const celda = (t, c, r) => (t && t.__k === 'table' ? t.celdas[`${c},${r}`] || (t.celdas[`${c},${r}`] = { c, r, texto: '' }) : null);
        def('table.set_text', (nd, a) => { const c = celda(a[0], a[1], a[2]); if (c) c.texto = aTexto(a[3]); return NA; });
        def('table.cell_set_text', (nd, a) => { const c = celda(a[0], a[1], a[2]); if (c) c.texto = aTexto(a[3]); return NA; });
        def('table.cell_set_bgcolor', (nd, a) => { const c = celda(a[0], a[1], a[2]); if (c) c.fondo = a[3]; return NA; });
        def('table.cell_set_text_color', (nd, a) => { const c = celda(a[0], a[1], a[2]); if (c) c.colorTexto = a[3]; return NA; });
        def('table.cell_set_text_size', (nd, a) => { const c = celda(a[0], a[1], a[2]); if (c) c.tam = String(a[3]); return NA; });
        def('table.cell_set_text_halign', (nd, a) => { const c = celda(a[0], a[1], a[2]); if (c) c.alin = String(a[3]); return NA; });
        def('table.cell_set_width', (nd, a) => { const c = celda(a[0], a[1], a[2]); if (c) c.ancho = a[3]; return NA; });
        def('table.cell_set_height', (nd, a) => { const c = celda(a[0], a[1], a[2]); if (c) c.alto = a[3]; return NA; });
        def('table.set_position', (nd, a) => { if (a[0] && a[0].__k === 'table') a[0].pos = String(a[1]); return NA; });
        def('table.set_bgcolor', (nd, a) => { if (a[0] && a[0].__k === 'table') a[0].fondo = a[1]; return NA; });
        def('table.set_frame_color', (nd, a) => { if (a[0] && a[0].__k === 'table') a[0].marco = a[1]; return NA; });
        def('table.set_frame_width', (nd, a) => { if (a[0] && a[0].__k === 'table') a[0].marcoW = a[1]; return NA; });
        def('table.set_border_color', (nd, a) => { if (a[0] && a[0].__k === 'table') a[0].bordeC = a[1]; return NA; });
        def('table.set_border_width', (nd, a) => { if (a[0] && a[0].__k === 'table') a[0].bordeW = a[1]; return NA; });
        def('table.clear', (nd, a) => { if (a[0] && a[0].__k === 'table') a[0].celdas = {}; return NA; });
        def('table.merge_cells', () => NA);
        const borra = (nd, a) => { if (a[0] && a[0].__k) a[0].borrado = true; return NA; };
        ['label', 'line', 'box', 'table'].forEach((t) => def(`${t}.delete`, borra));
        const setter = (tipo, nombre, campo) => def(`${tipo}.${nombre}`, (nd, a) => { if (a[0] && a[0].__k === tipo) a[0][campo] = a[1]; return NA; });
        [['set_x', 'x'], ['set_y', 'y'], ['set_color', 'color'], ['set_textcolor', 'colorTexto'], ['set_style', 'estilo'], ['set_size', 'tam'], ['set_xloc', 'xloc'], ['set_yloc', 'yloc']].forEach(([f, c]) => setter('label', f, c));
        def('label.set_text', (nd, a) => { if (a[0] && a[0].__k === 'label') a[0].texto = aTexto(a[1]); return NA; });
        def('label.set_xy', (nd, a) => { if (a[0] && a[0].__k === 'label') { a[0].x = a[1]; a[0].y = a[2]; } return NA; });
        def('label.set_tooltip', () => NA);
        [['set_x1', 'x1'], ['set_y1', 'y1'], ['set_x2', 'x2'], ['set_y2', 'y2'], ['set_color', 'color'], ['set_width', 'grosor'], ['set_style', 'estilo'], ['set_extend', 'extend'], ['set_xloc', 'xloc']].forEach(([f, c]) => setter('line', f, c));
        def('line.set_xy1', (nd, a) => { if (a[0] && a[0].__k === 'line') { a[0].x1 = a[1]; a[0].y1 = a[2]; } return NA; });
        def('line.set_xy2', (nd, a) => { if (a[0] && a[0].__k === 'line') { a[0].x2 = a[1]; a[0].y2 = a[2]; } return NA; });
        [['set_left', 'izq'], ['set_top', 'arriba'], ['set_right', 'der'], ['set_bottom', 'abajo'], ['set_bgcolor', 'fondo'], ['set_border_color', 'borde'], ['set_border_width', 'grosor'], ['set_border_style', 'estiloBorde'], ['set_extend', 'extend'], ['set_text_color', 'colorTexto'], ['set_xloc', 'xloc']].forEach(([f, c]) => setter('box', f, c));
        def('box.set_lefttop', (nd, a) => { if (a[0] && a[0].__k === 'box') { a[0].izq = a[1]; a[0].arriba = a[2]; } return NA; });
        def('box.set_rightbottom', (nd, a) => { if (a[0] && a[0].__k === 'box') { a[0].der = a[1]; a[0].abajo = a[2]; } return NA; });
        def('box.set_text', (nd, a) => { if (a[0] && a[0].__k === 'box') a[0].texto = aTexto(a[1]); return NA; });
        [['get_x', 'label', 'x'], ['get_y', 'label', 'y'], ['get_text', 'label', 'texto'], ['get_x1', 'line', 'x1'], ['get_y1', 'line', 'y1'], ['get_x2', 'line', 'x2'], ['get_y2', 'line', 'y2'], ['get_left', 'box', 'izq'], ['get_top', 'box', 'arriba'], ['get_right', 'box', 'der'], ['get_bottom', 'box', 'abajo']].forEach(([f, t, c]) => def(`${t}.${f}`, (nd, a) => (a[0] && a[0].__k === t && a[0][c] != null ? a[0][c] : NA)));

        // ── salidas extra: relleno entre dos plots, velas propias, alertas libres, estrategias
        def('fill', (nd, a, k) => {
            const h1 = a[0], h2 = a[1];
            if (!h1 || !h2 || !h1.__k || !h2.__k) return NA;
            let f = out.fills.find((x) => x._id === nd.id);
            if (!f) { f = { _id: nd.id, a: { k: h1.__k, i: h1.idx }, b: { k: h2.__k, i: h2.idx }, colores: new Array(n).fill(NA), titulo: String(k.title || '') }; out.fills.push(f); }
            const col = k.color !== undefined ? k.color : a[2];
            f.colores[barra] = col == null ? NA : col;
            return NA;
        });
        def('plotcandle', (nd, a, k) => {
            let v = out.velasPropias.find((x) => x._id === nd.id);
            if (!v) { v = { _id: nd.id, o: new Array(n).fill(NA), h: new Array(n).fill(NA), l: new Array(n).fill(NA), c: new Array(n).fill(NA), color: new Array(n).fill(NA), borde: new Array(n).fill(NA), mecha: new Array(n).fill(NA), titulo: String(k.title || 'Velas') }; out.velasPropias.push(v); }
            v.o[barra] = a[0]; v.h[barra] = a[1]; v.l[barra] = a[2]; v.c[barra] = a[3];
            const col = k.color !== undefined ? k.color : a[4];
            v.color[barra] = col == null ? NA : col; v.borde[barra] = k.bordercolor == null ? NA : k.bordercolor; v.mecha[barra] = k.wickcolor == null ? NA : k.wickcolor;
            return NA;
        });
        BUILTIN.plotbar = BUILTIN.plotcandle;
        def('plotarrow', (nd, a, k) => { if (a[0] != null && a[0] !== 0 && out.shapes.length < MAX_SHAPES) out.shapes.push({ barra, estilo: a[0] > 0 ? 'arrowup' : 'arrowdown', ubicacion: a[0] > 0 ? 'belowbar' : 'abovebar', color: a[0] > 0 ? (k.colorup || aRGBA('#00E676')) : (k.colordown || aRGBA('#F23645')), texto: '', titulo: String(k.title || '') }); return NA; });
        def('barcolor', () => { avisar('barcolor (pintar las velas del gráfico) todavía no se dibuja en NLT Charts; el resto del script funciona.'); return NA; });
        def('bgcolor', (nd, a) => {
            let b = out.bgcolors.find((x) => x._id === nd.id);
            if (!b) { b = { _id: nd.id, colores: new Array(n).fill(NA) }; out.bgcolors.push(b); }
            b.colores[barra] = a[0] == null ? NA : a[0];
            return NA;
        });
        def('alert', (nd, a) => { if (out.alerts.length < 200) { let al = out.alerts.find((x) => x._id === 'libre'); if (!al) { al = { _id: 'libre', titulo: 'Alerta del script', mensaje: '', barras: [] }; out.alerts.push(al); } al.mensaje = String(a[0]); al.barras.push(barra); } return NA; });
        def('runtime.error', (nd, a) => falla(String(a[0] == null ? 'Error del script' : a[0]), nd));
        const noopEstrategia = (nm) => def(nm, () => { avisar('Este script es una estrategia: sus indicadores se calculan, pero las órdenes (strategy.entry/exit/close) todavía no se simulan en NLT Charts.'); return NA; });
        ['strategy', 'strategy.entry', 'strategy.exit', 'strategy.close', 'strategy.close_all', 'strategy.order', 'strategy.cancel', 'strategy.cancel_all', 'strategy.risk.max_drawdown'].forEach(noopEstrategia);
        def('log.warning', () => NA); def('log.error', () => NA);
        def('indicator', (nd, a, k) => {
            out.meta.titulo = String(k.title !== undefined ? k.title : (a[0] || 'Script')); out.meta.overlay = !!k.overlay;
            if (k.precision != null) out.meta.precision = k.precision;
            if (k.max_labels_count != null) out.meta.maxEtiquetas = Math.max(1, Math.min(500, k.max_labels_count));
            if (k.max_lines_count != null) out.meta.maxLineas = Math.max(1, Math.min(500, k.max_lines_count));
            if (k.max_boxes_count != null) out.meta.maxCajas = Math.max(1, Math.min(500, k.max_boxes_count));
            return NA;
        });
        BUILTIN.study = BUILTIN.indicator;
        def('strategy', BUILTIN.indicator); BUILTIN.strategy = (nd, a, k) => { BUILTIN.indicator(nd, a, k); avisar('Este script es una estrategia: sus indicadores se calculan, pero las órdenes (strategy.entry/exit/close) todavía no se simulan en NLT Charts.'); return NA; };
        def('library', () => NA);


        // en el motor de otra temporalidad no se dibuja nada: solo se calculan valores
        if (esSub) {
            ['plot', 'plotshape', 'plotchar', 'plotarrow', 'plotcandle', 'plotbar', 'hline', 'bgcolor', 'fill', 'barcolor', 'alert', 'alertcondition', 'label.new', 'line.new', 'box.new', 'table.new', 'table.cell'].forEach((nm) => { BUILTIN[nm] = () => NA; });
        }

        // ── corrida ──
        // 1) funciones definidas (se registran antes de correr, como en Pine)
        prog.forEach((s) => { if (s.tipo === 'DefFuncion') funciones.set(s.nombre, s); });
        // 1b) revisión de compatibilidad: todas las funciones que no existen, de una vez y con su línea
        if (!esSub) {
            const desconocidas = new Map();
            const camino = (nd) => (nd.tipo === 'Id' ? nd.n : nd.tipo === 'Miembro' ? (camino(nd.a) ? `${camino(nd.a)}.${nd.n}` : null) : null);
            const raizDe = (nd) => (nd.tipo === 'Id' ? nd.n : nd.tipo === 'Miembro' ? raizDe(nd.a) : null);
            const recorrer = (x) => {
                if (!x || typeof x !== 'object') return;
                if (Array.isArray(x)) { x.forEach(recorrer); return; }
                if (x.tipo === 'Llamada') {
                    const ruta = camino(x.callee), raiz = raizDe(x.callee);
                    if (ruta && !funciones.has(ruta) && !BUILTIN[ruta] && ruta !== 'request.security' && ruta !== 'security' && (ruta.indexOf('.') < 0 || NS_FUNCIONES.has(raiz)) && !desconocidas.has(ruta)) desconocidas.set(ruta, x.linea);
                }
                for (const k of Object.keys(x)) { if (k !== 'tipo' && k !== 'linea' && k !== 'id') recorrer(x[k]); }
            };
            recorrer(prog);
            if (desconocidas.size) {
                const lista = [...desconocidas].slice(0, 15).map(([ruta, linea]) => ({ linea, mensaje: `La función «${ruta}» no existe o todavía no está soportada en NLT Script.` }));
                const e = new ErrorNLTS(lista[0].mensaje, lista[0].linea); e.lista = lista; throw e;
            }
        }
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
        if (esSub) { return out; }
        out.plots.forEach((p) => { delete p.offset; });
        out.hlines.forEach((h) => { delete h._id; });
        out.bgcolors.forEach((b) => { delete b._id; });
        out.alerts.forEach((a) => { delete a._id; });
        out.fills.forEach((f) => { delete f._id; });
        out.velasPropias.forEach((v) => { delete v._id; });
        ['etiquetas', 'lineas', 'cajas', 'tablas'].forEach((c) => { out[c] = out[c].filter((o) => !o.borrado).map((o) => { const { borrado, ...resto } = o; return resto; }); });
        out.necesita = [...necesita.values()];
        out.usaMtf = [...subs.keys()].map((c) => { const [simbolo, tf] = c.split('|'); return { simbolo, tf }; });
        return out;
    }

    // ───────────── scripts protegidos: se entrega el árbol ya compilado, no el texto ─────────────
    // El creador compila en su navegador y el servidor guarda el árbol (JSON). Quien compra recibe SOLO el árbol (sin comentarios ni
    // formato); como viene de otra persona, antes de ejecutarlo se valida forma por forma: solo nodos conocidos, con sus campos exactos.
    const ESQUEMA = {
        Asignar: { nombre: 's', op: 's', valor: 'n' }, Bin: { op: 's', a: 'n', b: 'n' }, Bool: { v: 'b' }, Color: { v: 's' }, Break: {}, Continue: {},
        Decl: { nombre: 's', valor: 'n', persistente: 'b' }, DefFuncion: { nombre: 's', params: 'S', defectos: 'L', cuerpo: 'L' }, ForIn: { v: 's', v2: 's', iter: 'n', cuerpo: 'L' }, Switch: { sujeto: 'N', casos: 'L' }, Caso: { cond: 'N', cuerpo: 'L' }, Destructurar: { nombres: 'S', valor: 'n' },
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
            // scripts protegidos guardados antes de existir los valores por defecto de los parámetros
            if (nd.tipo === 'DefFuncion' && !own(nd, 'defectos') && Array.isArray(nd.params)) nd.defectos = nd.params.map((_, i) => ({ tipo: 'Id', linea: null, id: 900000000 + i, n: 'na' }));
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
            if (e instanceof ErrorNLTS) return { ok: false, n, errores: e.lista || [{ linea: e.linea, mensaje: e.message }], meta: {}, inputs: [], plots: [], hlines: [], bgcolors: [], shapes: [], alerts: [] };
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
