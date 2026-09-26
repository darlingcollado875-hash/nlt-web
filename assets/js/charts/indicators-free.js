/* NLT Charts -- indicadores FREE propios de NLT (F4/F5.2).
 *
 * Todo lo de acá son conceptos públicos y corren en el navegador:
 *   NLT_SESSIONS   Asia / Londres / Nueva York (hora NY, mismas ventanas que el Zone Engine)
 *   NLT_KEY_LEVELS PDH / PDL / PWH / PWL
 *   NLT_FVG        FVG básico: hueco de 3 velas sin rellenar
 *   NLT_FREE_ZONES oferta/demanda simple: pivotes de 5 velas no testeados
 *
 * Lo que NO está acá a propósito (es PRO y vive en el servidor): el filtro
 * de tamaño por ATR, la máquina de estados ARMED/CONFIRMED, los Order
 * Blocks calibrados y cualquier score. */
(function () {
    const FUENTE = 'Inter, system-ui, sans-serif';

    // ---------------------------------------------------------------- utilidades
    const fmtNY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });
    const cacheHoraNY = new Map();
    // Hora de NY por hora UTC: todas las velas de una misma hora UTC
    // comparten la hora de NY, así que se calcula una vez por hora y no por vela.
    function horaNY(ts) {
        const clave = Math.floor(ts / 3600000);
        let h = cacheHoraNY.get(clave);
        if (h === undefined) {
            h = Number(fmtNY.format(new Date(clave * 3600000))) % 24;
            if (cacheHoraNY.size > 50000) cacheHoraNY.clear();
            cacheHoraNY.set(clave, h);
        }
        return h;
    }

    // Recorre el rango visible agrupando velas consecutivas con la misma clave
    // y llama fn(clave, desdeIdx, hastaIdx) por cada tramo.
    function tramos(res, from, to, claveDe, fn) {
        let i = from;
        while (i < to) {
            const k = res[i] ? claveDe(res[i]) : null;
            if (k == null) { i++; continue; }
            let j = i;
            while (j + 1 < to && res[j + 1] && claveDe(res[j + 1]) === k) j++;
            fn(k, i, j);
            i = j + 1;
        }
    }

    function periodoIntradia(chart, maxHoras) {
        const p = chart.getPeriod();
        if (!p) return false;
        if (p.type === 'minute') return true;
        return p.type === 'hour' && p.span <= maxHoras;
    }

    function caja(ctx, x0, x1, y0, y1, rgb, alfa) {
        const top = Math.min(y0, y1), h = Math.max(1, Math.abs(y1 - y0));
        ctx.fillStyle = `rgba(${rgb},${alfa})`;
        ctx.fillRect(x0, top, x1 - x0, h);
        ctx.strokeStyle = `rgba(${rgb},${Math.min(1, alfa * 4)})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, top + 0.5, x1 - x0 - 1, h - 1);
    }

    // ---------------------------------------------------------------- Sesiones
    const SESIONES = [
        { id: 'asia', nombre: 'Asia', rgb: '168,85,247', dentro: (h) => h >= 20 || h < 2 },
        { id: 'london', nombre: 'Londres', rgb: '67,120,255', dentro: (h) => h >= 2 && h < 5 },
        { id: 'ny', nombre: 'Nueva York', rgb: '245,158,11', dentro: (h) => h >= 8 && h < 11 },
    ];
    const SESION_POR_ID = Object.fromEntries(SESIONES.map((s) => [s.id, s]));

    function sesionDe(ts) {
        const h = horaNY(ts);
        const s = SESIONES.find((x) => x.dentro(h));
        return s ? s.id : null;
    }

    // ---------------------------------------------------------------- Key Levels
    // Velas diarias REALES del backend (el equivalente de request.security
    // "D", high[1] del Zone Engine). Armar el día con velas intradía daría
    // un PDH equivocado en 1m, donde hay solo unas horas cargadas.
    let simboloActual = null;
    const cacheDiarias = new Map(); // symbol -> { t, velas }
    const DIARIAS_TTL_MS = 60000;

    async function diarias(symbol) {
        const c = cacheDiarias.get(symbol);
        if (c && Date.now() - c.t < DIARIAS_TTL_MS) return c.velas;
        const r = await NLTCharts.market.velas(symbol, '1D', { limit: 60 });
        cacheDiarias.set(symbol, { t: Date.now(), velas: r.velas });
        return r.velas;
    }

    // Semana de una vela diaria = lunes de (apertura + 12 h) en UTC: la
    // diaria de forex abre el domingo a la tarde (hora del broker) y es del lunes.
    function claveSemana(tsDiaria) {
        const d = new Date(tsDiaria + 12 * 3600000);
        const dia = (d.getUTCDay() + 6) % 7; // 0 = lunes
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dia);
    }

    // Para cada vela diaria: H/L de la diaria anterior y de la semana anterior.
    function nivelesPorDiaria(velasD) {
        const semanas = [];
        const porSemana = new Map();
        velasD.forEach((v) => {
            const k = claveSemana(v.timestamp);
            let s = porSemana.get(k);
            if (!s) { s = { k, h: v.high, l: v.low }; porSemana.set(k, s); semanas.push(s); }
            s.h = Math.max(s.h, v.high);
            s.l = Math.min(s.l, v.low);
        });
        const idxSemana = new Map(semanas.map((s, i) => [s.k, i]));
        return velasD.map((v, i) => {
            const prev = velasD[i - 1];
            const iw = idxSemana.get(claveSemana(v.timestamp));
            // La primera semana cargada puede estar incompleta: no se usa como "semana anterior".
            const sw = iw >= 2 ? semanas[iw - 1] : null;
            return {
                ts: v.timestamp,
                pdh: prev ? prev.high : null, pdl: prev ? prev.low : null,
                pwh: sw ? sw.h : null, pwl: sw ? sw.l : null,
            };
        });
    }

    // Última diaria que abrió en o antes de ts (búsqueda binaria).
    function diariaDe(niveles, ts) {
        let lo = 0, hi = niveles.length - 1, r = -1;
        while (lo <= hi) {
            const m = (lo + hi) >> 1;
            if (niveles[m].ts <= ts) { r = m; lo = m + 1; } else hi = m - 1;
        }
        return r >= 0 ? niveles[r] : null;
    }

    const NIVELES = [
        { k: 'pwh', nombre: 'PWH', rgb: '34,211,238', guiones: [6, 4] },
        { k: 'pwl', nombre: 'PWL', rgb: '34,211,238', guiones: [6, 4] },
        { k: 'pdh', nombre: 'PDH', rgb: '229,231,235', guiones: [3, 3] },
        { k: 'pdl', nombre: 'PDL', rgb: '229,231,235', guiones: [3, 3] },
    ];

    // ---------------------------------------------------------------- FVG básico
    const MAX_FVG_POR_LADO = 5;
    // Filtro de ruido genérico (NO es el fvgMinDyn calibrado del Zone Engine):
    // un hueco menor a 1/4 del rango promedio de las últimas 14 velas no se muestra.
    const FVG_MIN_RANGO = 0.25;
    const FVG_VENTANA_RANGO = 14;

    function calcularFVG(data, opt = {}) {
        const maxLado = opt.max ?? MAX_FVG_POR_LADO, minRango = opt.minRango ?? FVG_MIN_RANGO;
        const zonas = [];
        let sumaRango = 0;
        for (let i = 0; i < data.length; i++) {
            sumaRango += data[i].high - data[i].low;
            if (i >= FVG_VENTANA_RANGO) sumaRango -= data[i - FVG_VENTANA_RANGO].high - data[i - FVG_VENTANA_RANGO].low;
            if (i < 2) continue;
            const minimo = (sumaRango / Math.min(i + 1, FVG_VENTANA_RANGO)) * minRango;
            const a = data[i - 2], c = data[i];
            if (c.low - a.high >= minimo && c.low > a.high) zonas.push({ dir: 1, desde: i - 1, top: c.low, bottom: a.high, fin: null });
            else if (a.low - c.high >= minimo && c.high < a.low) zonas.push({ dir: -1, desde: i - 1, top: a.low, bottom: c.high, fin: null });
        }
        // Rellenado = el precio cruzó el hueco completo después de formarse.
        zonas.forEach((z) => {
            for (let j = z.desde + 2; j < data.length; j++) {
                if ((z.dir === 1 && data[j].low <= z.bottom) || (z.dir === -1 && data[j].high >= z.top)) { z.fin = j; break; }
            }
        });
        const abiertas = zonas.filter((z) => z.fin === null);
        return [
            ...abiertas.filter((z) => z.dir === 1).slice(-maxLado),
            ...abiertas.filter((z) => z.dir === -1).slice(-maxLado),
        ];
    }

    // ---------------------------------------------------------------- Free Zones
    const PIVOTE = 2; // velas a cada lado
    const MAX_ZONAS_POR_LADO = 3;

    function calcularFreeZones(data, opt = {}) {
        const PIV = opt.pivote ?? PIVOTE, maxLado = opt.max ?? MAX_ZONAS_POR_LADO;
        const zonas = [];
        for (let i = PIV; i < data.length - PIV; i++) {
            let esAlto = true, esBajo = true;
            for (let k = 1; k <= PIV; k++) {
                if (!(data[i].high > data[i - k].high && data[i].high > data[i + k].high)) esAlto = false;
                if (!(data[i].low < data[i - k].low && data[i].low < data[i + k].low)) esBajo = false;
            }
            const cuerpoAlto = Math.max(data[i].open, data[i].close);
            const cuerpoBajo = Math.min(data[i].open, data[i].close);
            if (esAlto) zonas.push({ dir: -1, desde: i, top: data[i].high, bottom: cuerpoAlto, fin: null });
            if (esBajo) zonas.push({ dir: 1, desde: i, top: cuerpoBajo, bottom: data[i].low, fin: null });
        }
        // Invalidada = una vela CIERRA del otro lado de la zona.
        zonas.forEach((z) => {
            for (let j = z.desde + PIV + 1; j < data.length; j++) {
                if ((z.dir === -1 && data[j].close > z.top) || (z.dir === 1 && data[j].close < z.bottom)) { z.fin = j; break; }
            }
        });
        const vivas = zonas.filter((z) => z.fin === null);
        return [
            ...vivas.filter((z) => z.dir === 1).slice(-maxLado),
            ...vivas.filter((z) => z.dir === -1).slice(-maxLado),
        ];
    }

    function estiloZonas(v, kB, kR, etiqueta) {
        const rgb = (c) => { const h = c.hex.replace('#', ''); return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`; };
        return { alcista: rgb(v[kB]), bajista: rgb(v[kR]), alfa: 1 - v[kB].t / 100, alfaBajista: 1 - v[kR].t / 100, etiqueta };
    }

    // Dibuja zonas (FVG o Free Zones) desde su vela de origen hasta el borde derecho.
    function dibujarZonas(ctx, zonas, { from, to }, xAxis, yAxis, media, bounding, estilo) {
        const xFin = bounding.width;
        ctx.save();
        ctx.font = `600 10px ${FUENTE}`;
        ctx.textBaseline = 'top'; // etiqueta adentro de la caja: afuera se pisan entre zonas vecinas
        zonas.forEach((z) => {
            if (z.desde >= to) return;
            const x0 = Math.max(0, xAxis.convertToPixel(Math.max(z.desde, from)) - media);
            const y0 = yAxis.convertToPixel(z.top), y1 = yAxis.convertToPixel(z.bottom);
            const rgb = z.dir === 1 ? estilo.alcista : estilo.bajista;
            caja(ctx, x0, xFin, y0, y1, rgb, z.dir === 1 ? estilo.alfa : (estilo.alfaBajista ?? estilo.alfa));
            if (z.desde >= from && Math.abs(y1 - y0) >= 10) {
                ctx.fillStyle = `rgba(${rgb},0.85)`;
                ctx.fillText(estilo.etiqueta(z), x0 + 3, Math.min(y0, y1) + 1);
            }
        });
        ctx.restore();
    }

    // Los resultados de FVG/Free Zones son listas de zonas, no un valor por
    // vela: se guardan por id de indicador y calc devuelve un arreglo vacío
    // del largo de los datos (el motor lo necesita así).
    const zonasPorIndicador = new Map();
    const incSesiones = {}, incNiveles = {};   // estado de P.incremental

    // ---------------------------------------------------------------- configuración (engranaje)
    const Pc = (hex, t) => ({ hex, t });
    const rgbDe = (c) => { const h = c.hex.replace('#', ''); return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`; };
    const alfaDe = (c) => 1 - c.t / 100;
    const aj = (id) => NLTCharts.settings.valores(id);
    const ESQUEMAS = {
        NLT_SESSIONS: { titulo: 'NLT Sessions', inputs: [
            { id: 'asia', tipo: 'bool', def: true, titulo: 'Asia (20:00-02:00 NY)', grupo: 'Sesiones', inline: 'a' },
            { id: 'colAsia', tipo: 'color', def: Pc('#A855F7', 93), titulo: '', grupo: 'Sesiones', inline: 'a' },
            { id: 'london', tipo: 'bool', def: true, titulo: 'Londres (02:00-05:00 NY)', grupo: 'Sesiones', inline: 'l' },
            { id: 'colLondon', tipo: 'color', def: Pc('#4378FF', 93), titulo: '', grupo: 'Sesiones', inline: 'l' },
            { id: 'ny', tipo: 'bool', def: true, titulo: 'Nueva York (08:00-11:00 NY)', grupo: 'Sesiones', inline: 'n' },
            { id: 'colNY', tipo: 'color', def: Pc('#F59E0B', 93), titulo: '', grupo: 'Sesiones', inline: 'n' },
            { id: 'etiquetas', tipo: 'bool', def: true, titulo: 'Mostrar nombres', grupo: 'Visuales' },
        ] },
        NLT_KEY_LEVELS: { titulo: 'NLT Key Levels', inputs: [
            { id: 'pd', tipo: 'bool', def: true, titulo: 'PDH / PDL (día anterior)', grupo: 'Niveles', inline: 'd' },
            { id: 'colPD', tipo: 'color', def: Pc('#E5E7EB', 30), titulo: '', grupo: 'Niveles', inline: 'd' },
            { id: 'pw', tipo: 'bool', def: true, titulo: 'PWH / PWL (semana anterior)', grupo: 'Niveles', inline: 'w' },
            { id: 'colPW', tipo: 'color', def: Pc('#22D3EE', 30), titulo: '', grupo: 'Niveles', inline: 'w' },
            { id: 'etiquetas', tipo: 'bool', def: true, titulo: 'Mostrar nombres', grupo: 'Visuales' },
        ] },
        NLT_FVG: { titulo: 'FVG básico', inputs: [
            { id: 'max', tipo: 'int', def: MAX_FVG_POR_LADO, titulo: 'Máximo por lado', grupo: 'Cálculo', min: 1, max: 30 },
            { id: 'minRango', tipo: 'float', def: FVG_MIN_RANGO, titulo: 'Tamaño mínimo (× rango promedio de 14 velas)', grupo: 'Cálculo', min: 0, max: 5, step: 0.05 },
            { id: 'colBull', tipo: 'color', def: Pc('#22C55E', 92), titulo: 'Alcista', grupo: 'Visuales', inline: 'c' },
            { id: 'colBear', tipo: 'color', def: Pc('#EF4444', 92), titulo: 'Bajista', grupo: 'Visuales', inline: 'c' },
        ] },
        NLT_FREE_ZONES: { titulo: 'NLT Free Zones', inputs: [
            { id: 'pivote', tipo: 'int', def: PIVOTE, titulo: 'Velas a cada lado del pivote', grupo: 'Cálculo', min: 1, max: 20 },
            { id: 'max', tipo: 'int', def: MAX_ZONAS_POR_LADO, titulo: 'Máximo por lado', grupo: 'Cálculo', min: 1, max: 20 },
            { id: 'colDem', tipo: 'color', def: Pc('#2DD4BF', 94), titulo: 'Demanda', grupo: 'Visuales', inline: 'c' },
            { id: 'colOf', tipo: 'color', def: Pc('#FB923C', 94), titulo: 'Oferta', grupo: 'Visuales', inline: 'c' },
        ] },
    };

    // ---------------------------------------------------------------- registro
    let registrados = false;
    function registrar() {
        if (registrados) return;
        registrados = true;
        Object.entries(ESQUEMAS).forEach(([id, e]) => NLTCharts.settings.registrar(id, e));
        const vacio = () => ({ name: '', calcParamsText: '', features: [], legends: [] });

        klinecharts.registerIndicator({
            name: 'NLT_SESSIONS',
            shortName: 'Sesiones',
            figures: [],
            calc: (dataList) => NLTCharts.pine.incremental(incSesiones, dataList, 'v1',
                () => dataList.map((d) => ({ s: sesionDe(d.timestamp) })), (i) => ({ s: sesionDe(dataList[i].timestamp) })),
            createTooltipDataSource: () => ({ ...vacio(), name: 'Sesiones' }),
            draw: ({ ctx, chart, indicator, bounding, xAxis }) => {
                // En 4H y diario una vela abarca varias sesiones: no se marcan.
                if (!periodoIntradia(chart, 1)) return false;
                const { from, to } = chart.getVisibleRange();
                const media = chart.getBarSpace().halfGapBar;
                const v = aj('NLT_SESSIONS');
                const conf = { asia: [v.asia, v.colAsia], london: [v.london, v.colLondon], ny: [v.ny, v.colNY] };
                ctx.save();
                ctx.font = `600 10px ${FUENTE}`;
                // Etiqueta abajo: arriba está la leyenda OHLC del gráfico.
                ctx.textBaseline = 'bottom';
                tramos(indicator.result, from, to, (r) => r.s, (s, i, j) => {
                    const [visible, col] = conf[s];
                    if (!visible) return;
                    const x0 = xAxis.convertToPixel(i) - media;
                    const x1 = xAxis.convertToPixel(j) + media;
                    const ses = SESION_POR_ID[s];
                    ctx.fillStyle = `rgba(${rgbDe(col)},${alfaDe(col)})`;
                    ctx.fillRect(x0, 0, x1 - x0, bounding.height);
                    if (v.etiquetas && x1 - x0 > 44) {
                        ctx.fillStyle = `rgba(${rgbDe(col)},0.8)`;
                        ctx.fillText(ses.nombre, x0 + 4, bounding.height - 4);
                    }
                });
                ctx.restore();
                return false;
            },
        });

        klinecharts.registerIndicator({
            name: 'NLT_KEY_LEVELS',
            shortName: 'Key Levels',
            figures: [],
            calc: async (dataList) => {
                if (!simboloActual || !dataList.length) return dataList.map(() => ({}));
                let vd;
                try {
                    vd = await diarias(simboloActual);
                } catch (_) {
                    return dataList.map(() => ({}));
                }
                // Los niveles solo cambian cuando llegan diarias nuevas (cache de 60 s).
                const version = `${simboloActual}|${(cacheDiarias.get(simboloActual) || {}).t}`;
                if (incNiveles.version !== version) incNiveles.niveles = nivelesPorDiaria(vd);
                const niv = incNiveles.niveles;
                return NLTCharts.pine.incremental(incNiveles, dataList, version,
                    () => dataList.map((d) => diariaDe(niv, d.timestamp) || {}), (i) => diariaDe(niv, dataList[i].timestamp) || {});
            },
            createTooltipDataSource: ({ indicator, crosshair }) => {
                const r = indicator.result[crosshair.dataIndex] || {};
                const p = (v) => (v == null ? 'n/a' : String(v));
                return {
                    name: 'Key Levels', calcParamsText: '', features: [],
                    legends: NIVELES.map((n) => ({ title: { text: n.nombre + ': ', color: '#9CA3AF' }, value: { text: p(r[n.k]), color: `rgb(${n.rgb})` } })),
                };
            },
            draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
                const { from, to } = chart.getVisibleRange();
                const media = chart.getBarSpace().halfGapBar;
                const res = indicator.result;
                ctx.save();
                ctx.font = `600 10px ${FUENTE}`;
                ctx.textBaseline = 'bottom';
                const v = aj('NLT_KEY_LEVELS');
                NIVELES.forEach((n) => {
                    const semanal = n.k === 'pwh' || n.k === 'pwl';
                    if (!(semanal ? v.pw : v.pd)) return;
                    const col = semanal ? v.colPW : v.colPD;
                    ctx.setLineDash(n.guiones);
                    ctx.strokeStyle = `rgba(${rgbDe(col)},${alfaDe(col)})`;
                    ctx.lineWidth = 1;
                    let ultimo = null;
                    tramos(res, from, to, (r) => r[n.k], (valor, i, j) => {
                        const y = Math.round(yAxis.convertToPixel(valor)) + 0.5;
                        const x0 = xAxis.convertToPixel(i) - media, x1 = xAxis.convertToPixel(j) + media;
                        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
                        ultimo = { x0, x1, y };
                    });
                    if (ultimo && v.etiquetas) {
                        ctx.setLineDash([]);
                        ctx.fillStyle = `rgba(${rgbDe(col)},0.9)`;
                        ctx.fillText(n.nombre, Math.max(ultimo.x0, ultimo.x1 - 34), ultimo.y - 2);
                    }
                });
                ctx.restore();
                return false;
            },
        });

        klinecharts.registerIndicator({
            name: 'NLT_FVG',
            shortName: 'FVG',
            figures: [],
            calc: (dataList, indicator) => {
                zonasPorIndicador.set(indicator.id || indicator.name, calcularFVG(dataList, aj('NLT_FVG')));
                return dataList.map(() => ({}));
            },
            createTooltipDataSource: () => ({ ...vacio(), name: 'FVG básico' }),
            draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
                dibujarZonas(ctx, zonasPorIndicador.get(indicator.id || indicator.name) || [], chart.getVisibleRange(), xAxis, yAxis,
                    chart.getBarSpace().halfGapBar, bounding,
                    estiloZonas(aj('NLT_FVG'), 'colBull', 'colBear', () => 'FVG'));
                return false;
            },
        });

        klinecharts.registerIndicator({
            name: 'NLT_FREE_ZONES',
            shortName: 'Free Zones',
            figures: [],
            calc: (dataList, indicator) => {
                zonasPorIndicador.set(indicator.id || indicator.name, calcularFreeZones(dataList, aj('NLT_FREE_ZONES')));
                return dataList.map(() => ({}));
            },
            createTooltipDataSource: () => ({ ...vacio(), name: 'Free Zones' }),
            draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
                dibujarZonas(ctx, zonasPorIndicador.get(indicator.id || indicator.name) || [], chart.getVisibleRange(), xAxis, yAxis,
                    chart.getBarSpace().halfGapBar, bounding,
                    estiloZonas(aj('NLT_FREE_ZONES'), 'colDem', 'colOf', (z) => (z.dir === 1 ? 'Demanda' : 'Oferta')));
                return false;
            },
        });
    }

    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.freeIndicators = {
        registrar,
        setSymbol(s) { simboloActual = s; },
        // expuestos para tests en el navegador
        SESIONES, horaNY, sesionDe, calcularFVG, calcularFreeZones, nivelesPorDiaria, claveSemana, diariaDe,
    };
})();
