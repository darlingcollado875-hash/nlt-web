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

    function calcularFVG(data) {
        const zonas = [];
        let sumaRango = 0;
        for (let i = 0; i < data.length; i++) {
            sumaRango += data[i].high - data[i].low;
            if (i >= FVG_VENTANA_RANGO) sumaRango -= data[i - FVG_VENTANA_RANGO].high - data[i - FVG_VENTANA_RANGO].low;
            if (i < 2) continue;
            const minimo = (sumaRango / Math.min(i + 1, FVG_VENTANA_RANGO)) * FVG_MIN_RANGO;
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
            ...abiertas.filter((z) => z.dir === 1).slice(-MAX_FVG_POR_LADO),
            ...abiertas.filter((z) => z.dir === -1).slice(-MAX_FVG_POR_LADO),
        ];
    }

    // ---------------------------------------------------------------- Free Zones
    const PIVOTE = 2; // velas a cada lado
    const MAX_ZONAS_POR_LADO = 3;

    function calcularFreeZones(data) {
        const zonas = [];
        for (let i = PIVOTE; i < data.length - PIVOTE; i++) {
            let esAlto = true, esBajo = true;
            for (let k = 1; k <= PIVOTE; k++) {
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
            for (let j = z.desde + PIVOTE + 1; j < data.length; j++) {
                if ((z.dir === -1 && data[j].close > z.top) || (z.dir === 1 && data[j].close < z.bottom)) { z.fin = j; break; }
            }
        });
        const vivas = zonas.filter((z) => z.fin === null);
        return [
            ...vivas.filter((z) => z.dir === 1).slice(-MAX_ZONAS_POR_LADO),
            ...vivas.filter((z) => z.dir === -1).slice(-MAX_ZONAS_POR_LADO),
        ];
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
            caja(ctx, x0, xFin, y0, y1, rgb, estilo.alfa);
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

    // ---------------------------------------------------------------- registro
    let registrados = false;
    function registrar() {
        if (registrados) return;
        registrados = true;
        const vacio = () => ({ name: '', calcParamsText: '', features: [], legends: [] });

        klinecharts.registerIndicator({
            name: 'NLT_SESSIONS',
            shortName: 'Sesiones',
            figures: [],
            calc: (dataList) => dataList.map((d) => ({ s: sesionDe(d.timestamp) })),
            createTooltipDataSource: () => ({ ...vacio(), name: 'Sesiones' }),
            draw: ({ ctx, chart, indicator, bounding, xAxis }) => {
                // En 4H y diario una vela abarca varias sesiones: no se marcan.
                if (!periodoIntradia(chart, 1)) return false;
                const { from, to } = chart.getVisibleRange();
                const media = chart.getBarSpace().halfGapBar;
                ctx.save();
                ctx.font = `600 10px ${FUENTE}`;
                // Etiqueta abajo: arriba está la leyenda OHLC del gráfico.
                ctx.textBaseline = 'bottom';
                tramos(indicator.result, from, to, (r) => r.s, (s, i, j) => {
                    const x0 = xAxis.convertToPixel(i) - media;
                    const x1 = xAxis.convertToPixel(j) + media;
                    const ses = SESION_POR_ID[s];
                    ctx.fillStyle = `rgba(${ses.rgb},0.07)`;
                    ctx.fillRect(x0, 0, x1 - x0, bounding.height);
                    if (x1 - x0 > 44) {
                        ctx.fillStyle = `rgba(${ses.rgb},0.8)`;
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
                let niveles;
                try {
                    niveles = nivelesPorDiaria(await diarias(simboloActual));
                } catch (_) {
                    return dataList.map(() => ({}));
                }
                return dataList.map((d) => diariaDe(niveles, d.timestamp) || {});
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
                NIVELES.forEach((n) => {
                    ctx.setLineDash(n.guiones);
                    ctx.strokeStyle = `rgba(${n.rgb},0.7)`;
                    ctx.lineWidth = 1;
                    let ultimo = null;
                    tramos(res, from, to, (r) => r[n.k], (valor, i, j) => {
                        const y = Math.round(yAxis.convertToPixel(valor)) + 0.5;
                        const x0 = xAxis.convertToPixel(i) - media, x1 = xAxis.convertToPixel(j) + media;
                        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
                        ultimo = { x0, x1, y };
                    });
                    if (ultimo) {
                        ctx.setLineDash([]);
                        ctx.fillStyle = `rgba(${n.rgb},0.9)`;
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
                zonasPorIndicador.set(indicator.id || indicator.name, calcularFVG(dataList));
                return dataList.map(() => ({}));
            },
            createTooltipDataSource: () => ({ ...vacio(), name: 'FVG básico' }),
            draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
                dibujarZonas(ctx, zonasPorIndicador.get(indicator.id || indicator.name) || [], chart.getVisibleRange(), xAxis, yAxis,
                    chart.getBarSpace().halfGapBar, bounding,
                    { alcista: '34,197,94', bajista: '239,68,68', alfa: 0.08, etiqueta: () => 'FVG' });
                return false;
            },
        });

        klinecharts.registerIndicator({
            name: 'NLT_FREE_ZONES',
            shortName: 'Free Zones',
            figures: [],
            calc: (dataList, indicator) => {
                zonasPorIndicador.set(indicator.id || indicator.name, calcularFreeZones(dataList));
                return dataList.map(() => ({}));
            },
            createTooltipDataSource: () => ({ ...vacio(), name: 'Free Zones' }),
            draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
                dibujarZonas(ctx, zonasPorIndicador.get(indicator.id || indicator.name) || [], chart.getVisibleRange(), xAxis, yAxis,
                    chart.getBarSpace().halfGapBar, bounding,
                    { alcista: '45,212,191', bajista: '251,146,60', alfa: 0.06, etiqueta: (z) => (z.dir === 1 ? 'Demanda' : 'Oferta') });
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
