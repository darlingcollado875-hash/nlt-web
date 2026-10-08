/* NLT Indicator AI -- cómo se ve un análisis: resumen corto (aviso del gráfico) y reporte completo.
 * Lo usan NLT Charts (aviso, panel y visor de reportes) y el panel NLT Indicator (lista de reportes), así que
 * los dos muestran EXACTAMENTE lo mismo. Solo lee el análisis que entrega el servidor; no calcula nada. */
(function () {
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

    // El servidor clasifica en 5 veredictos; aquí se traducen a lo que entiende cualquiera de un vistazo.
    const VEREDICTOS = {
        HIGH_QUALITY_SETUP: { clave: 'optima', titulo: 'Entrada óptima', color: '#22C55E', icono: 'ph-fill ph-seal-check' },
        VALID_SETUP: { clave: 'valida', titulo: 'Entrada válida', color: '#4ADE80', icono: 'ph-fill ph-check-circle' },
        MARGINAL: { clave: 'debil', titulo: 'Entrada débil', color: '#FBBF24', icono: 'ph-fill ph-warning' },
        DATA_INSUFFICIENT: { clave: 'datos', titulo: 'Datos insuficientes', color: '#9CA3AF', icono: 'ph-fill ph-question' },
        AVOID: { clave: 'no', titulo: 'Entrada no válida', color: '#F87171', icono: 'ph-fill ph-x-circle' },
    };
    function veredicto(a) {
        if (!a) return null;
        let k = String(a.verdict || '').toUpperCase();
        if (a.setup_valid === false && k !== 'DATA_INSUFFICIENT') k = 'AVOID';          // si el análisis dice que no es válida, manda eso
        return { ...(VEREDICTOS[k] || { clave: 'debil', titulo: 'En revisión', color: '#FBBF24', icono: 'ph-fill ph-hourglass-medium' }), codigo: k };
    }
    const texto1 = (x) => (typeof x === 'string' ? x : x && (x.text || x.detail || x.message)) || '';
    const recorta = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
    // Una sola frase que explica el veredicto: lo que invalida/advierte si no es buena; lo que suma si lo es.
    function motivo(a) {
        const v = veredicto(a); if (!v) return '';
        const lista = (xs) => (xs || []).map(texto1).filter(Boolean);
        const buena = v.clave === 'optima' || v.clave === 'valida';
        const fuente = buena ? [...lista(a.confluences), ...lista(a.confirmation_required)] : [...lista(a.invalidation), ...lista(a.warnings), ...lista(a.confirmation_required)];
        if (fuente.length) return recorta(fuente[0], 120);
        // Primera frase. (Sin lookbehind `(?<=…)`: Safari anterior a 16.4 no entiende esa sintaxis y descarta el archivo ENTERO.)
        const texto = String(a.explanation || ''), m = texto.match(/^[\s\S]*?[.!?](?=\s)/);
        return recorta(m ? m[0] : texto, 120);
    }
    function resumen(a) {
        const v = veredicto(a); if (!v) return null;
        const score = num(a.score != null ? a.score : (a.probability != null ? a.probability : a.final_ai_score));
        return { ...v, direccion: a.direction || null, calidad: a.quality || null, score: score == null ? null : Math.round(score), motivo: motivo(a), simbolo: a.symbol || null };
    }
    const dirHtml = (d) => (d ? `<b class="air-dir ${d === 'SHORT' ? 'short' : 'long'}">${esc(d)}</b>` : '');

    // ── reporte completo ──
    const barra = (l, v) => `<div class="air-bar"><span>${esc(l)}</span><i><u style="width:${Math.max(0, Math.min(100, num(v) || 0))}%"></u></i><b>${num(v) == null ? '—' : Math.round(v)}</b></div>`;
    const bloque = (titulo, xs, icono, cls) => {
        const l = (xs || []).map(texto1).filter(Boolean);
        return l.length ? `<div class="air-lista ${cls || ''}"><h5>${esc(titulo)}</h5><ul>${l.map((x) => `<li><i class="ph ${icono}"></i><span>${esc(x)}</span></li>`).join('')}</ul></div>` : '';
    };
    function html(a) {
        const v = veredicto(a), L = a.scores_layers || {}, S = a.claude_scores || {};
        const score = num(a.probability != null ? a.probability : (a.final_ai_score != null ? a.final_ai_score : a.score));
        const fecha = a.created_at ? new Date(a.created_at) : null;
        const cuando = fecha && !Number.isNaN(fecha.getTime()) ? fecha.toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
        return `<article class="air-rep" style="--air-c:${v.color}">
            <header class="air-hero">
                <span class="air-ico"><i class="${v.icono}"></i></span>
                <div class="air-hero-t"><h3>${esc(v.titulo)}</h3><p>${esc(a.symbol || '')}${a.timeframe ? ' · ' + esc(a.timeframe) : ''} ${dirHtml(a.direction)}${cuando ? ` <span class="air-fecha">${esc(cuando)}</span>` : ''}</p></div>
                <div class="air-score"><b>${score == null ? '—' : Math.round(score)}<small>%</small></b><span>${esc(a.quality || '—')}${a.category ? ' · ' + esc(a.category) : ''}</span></div>
            </header>
            ${a.explanation ? `<p class="air-expl">${esc(a.explanation)}</p>` : ''}
            <div class="air-cols">
                <section><h5>Capas del score</h5>${barra('V13 Score', L.v13_score)}${barra('NLT Quant', L.nlt_quant_score)}${barra('Claude', L.claude_ai_score)}${barra('NLT AI final', L.final_ai_score)}</section>
                <section><h5>Desglose</h5>${barra('Estructura', S.structure)}${barra('Liquidez', S.liquidity)}${barra('Ubicación', S.location)}${barra('Momentum', S.momentum)}${barra('Confluencia', S.confluence)}${barra('Historial', S.historical)}</section>
            </div>
            <div class="air-listas">${bloque('A favor', a.confluences, 'ph-check-circle', 'ok')}${bloque('Advertencias', a.warnings, 'ph-warning', 'aviso')}${bloque('Falta confirmar', a.confirmation_required, 'ph-arrow-right', '')}${bloque('Lo invalida', a.invalidation, 'ph-x-circle', 'mal')}</div>
            <footer>Riesgo ${esc(a.risk_level || '—')} · R/R ${esc(a.rr_quality || '—')}${a.data_gaps && a.data_gaps.length ? ' · Datos faltantes: ' + esc(a.data_gaps.join(', ')) : ''}<br>La probabilidad es una estimación de calidad del setup, no una garantía de resultado. Informativo: no es recomendación de inversión.</footer>
        </article>`;
    }
    // fila de la lista de reportes
    function fila(a) {
        const v = veredicto(a), score = num(a.probability != null ? a.probability : a.final_ai_score);
        const fecha = a.created_at ? new Date(a.created_at) : null;
        const cuando = fecha && !Number.isNaN(fecha.getTime()) ? fecha.toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
        return `<button type="button" class="air-fila" data-air-id="${esc(a.analysis_id)}" style="--air-c:${v.color}">
            <span class="air-ico sm"><i class="${v.icono}"></i></span>
            <span class="air-fila-t"><b>${esc(v.titulo)}</b><small>${esc(a.symbol || '—')}${a.timeframe ? ' · ' + esc(a.timeframe) : ''} · ${esc(a.direction || '—')}${cuando ? ' · ' + esc(cuando) : ''}</small></span>
            <span class="air-fila-s"><b>${score == null ? '—' : Math.round(score)}%</b><small>${esc(a.quality || '')}</small></span><i class="ph ph-caret-right"></i></button>`;
    }

    window.NLTAiReporte = { veredicto, resumen, motivo, html, fila, esc };
})();
